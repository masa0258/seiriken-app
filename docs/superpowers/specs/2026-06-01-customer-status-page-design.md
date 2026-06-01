# 顧客向け 呼び出し状況ページ 設計

作成日: 2026-06-01

## 目的

整理券の印刷物に載せたQRコードを、お客さんがスマホで読み込んだときに表示される「呼び出し状況ページ」を作る。お客さんは自分のスマホで、店がいま何番を呼び出しているか・待ち組数・直近の呼び出し履歴をリアルタイムに近い形で確認でき、自分の整理券番号を入力すると「あと約N組・約M分」が分かる。

これは印刷システム設計時に「共有バックエンドが必要」として将来へ送った「機能B（顧客側のリアルタイム状況表示）」にあたる。

## スコープ

### 今回やること
- お客さん用の単独ページ `status.html`（QRのリンク先）。
- 店アプリ（`index.html`）から現在のキュー状況をクラウドへ公開する仕組み。
- 共有データ置き場として Supabase（無料BaaS）を利用。
- 表示内容：現在呼び出し中の番号・自分の番号を入れて順番確認・待ち組数・直近の呼び出し履歴。
- 書き込み（店だけが更新）の秘密キー保護。

### 今回やらないこと（YAGNI）
- 複数店舗対応（1店舗・単一の共有行で固定）。
- 顧客アカウント／ログイン。
- プッシュ通知・「あなたの番です」通知（今回は能動的な状況表示まで）。
- `supabase-js` などの外部ライブラリ（プレーンな `fetch` のみで実装）。

## 確定した方針

- **共有バックエンド**: Supabase。サーバー運用不要・無料枠。
- **ライブラリ非依存**: 店・客とも `fetch` だけで通信。`supabase-js` は読み込まない。
- **客ページの更新方式**: Supabase REST を 5 秒ごとにポーリング（Realtime購読は使わない＝ライブラリ・複雑さ回避）。
- **書き込み保護**: Supabase の SQL関数（RPC・`SECURITY DEFINER`）内で秘密キーを照合し、一致時のみ更新。anon（公開）キーは読み取りとRPC実行のみ可能で、秘密キーが無いと書き込めない。Edge Function（Deno）・CLI・ビルドは不要で、Supabaseの管理画面でSQLを一度実行するだけ。
- **ホスティング**: GitHub Pages。店アプリと客ページを同一リポジトリから無料・HTTPSで公開し、店アプリもHTTPSで動かすことで Supabase との通信（CORS）を素直にする。QRは客ページの公開URL（例 `https://<user>.github.io/seiriken/status.html`）を指す。
- **公開する情報**: 番号と件数のみ。氏名・人数などの個人情報は送らない。
- **設定保存**: 店側の接続情報は localStorage の新キー `seiriken-sync-settings`。既存の `seiriken-state` / `seiriken-print-settings` とは別。

## アーキテクチャ

3要素で構成する。

### 1. Supabase（共有データ置き場）

**テーブル `queue_status`（1行のみ）**

```
id              text   primary key   -- 固定値 'main'
calling_number  int    null          -- 今呼んでいる番号（無ければ null）
recent_called   jsonb                -- 直近の呼び出し番号 [38,37,36,...]（最大5件、新しい順）
waiting_numbers jsonb                -- 待ち番号の昇順配列 [42,43,44]（番号のみ）
waiting_count   int                  -- 待ち組数
last_issued     int                  -- 最後に発券した番号
avg_serve_ms    bigint null          -- 1組あたり平均案内間隔（ミリ秒、未算出は null）
updated_at      timestamptz          -- 更新時刻
```

**RLS（行レベルセキュリティ）**
- anon ロールは `queue_status` への `SELECT` のみ許可。
- `INSERT` / `UPDATE` は anon に直接許可しない。

**RPC `publish_status`（`SECURITY DEFINER`）**
- 引数: `p_secret text, p_calling int, p_recent jsonb, p_waiting jsonb, p_count int, p_last int, p_avg bigint`。
- 本体: `p_secret` を保管した秘密値と照合し、不一致なら例外（unauthorized）。一致時のみ `queue_status`（id='main'）を upsert し `updated_at = now()`。
- 秘密値の保管: 専用の非公開テーブル（anonはSELECT不可）に1行で保持し、関数内（DEFINER権限）で参照する。anonはこの関数を `EXECUTE` できるが秘密値は読めない。

すべて Supabase の SQL エディタで一度実行するスクリプトとして用意する（実装計画にSQL全文を載せる）。

### 2. 店アプリ（`index.html` 拡張）

- **オンライン共有設定**（localStorage `seiriken-sync-settings`）:
  ```
  {
    enabled: boolean,     // オンライン共有を使うか
    supabaseUrl: string,  // 例 https://xxxx.supabase.co
    anonKey: string,      // 公開anonキー
    publishSecret: string // 書き込み用の秘密キー
  }
  ```
  既定値は全て空 / `enabled:false`。設定画面に入力フォームと有効化トグルを追加する。
- **公開処理**: 既存の `update(newState)`（状態を保存して再描画する中心関数）にフックし、共有ONかつ設定が揃っているとき、`buildPublicStatus(state)` の結果を `publishStatus(config, status)` で送る。連続更新に備えて軽いデバウンス（例 400ms）でまとめて送る。
- `publishStatus(config, status)`: `POST {supabaseUrl}/rest/v1/rpc/publish_status` に `apikey`/`Authorization: Bearer {anonKey}` ヘッダ＋ JSON ボディ（秘密キー＋各フィールド）を送る。副作用・ネットワーク依存のため手動検証扱い。失敗は捕捉してメッセージ表示し、キュー操作と `seiriken-state` には影響させない。

### 3. お客さんページ（`status.html` 新規・単独ファイル）

- ページ内に Supabase URL・anonキー・行ID（'main'）を埋め込む（anonキーは公開前提で安全）。
- 読み込み時と以後 5 秒間隔で `GET {supabaseUrl}/rest/v1/queue_status?id=eq.main&select=*`（`apikey` ヘッダ付き）を `fetch` し、最新行を取得して描画。
- `status.js`（純粋モジュール）を読み込み、自分の番号入力時に順番・予想待ちを計算。
- DOM操作は `textContent`/`createElement`/`appendChild` のみ（`innerHTML` 不使用）。

### 純粋モジュール `status.js`（DOM非依存・テスト可能）

- `buildPublicStatus(state)` → 上記公開サマリのオブジェクト。`state`（`seiriken-state`：`{ lastIssued, tickets:[{number,partySize,status,issuedAt,calledAt,completedAt}], ... }`）から導出する。
  - `calling_number`: 最後に `called` 状態になった番号（無ければ null）。
  - `recent_called`: `called`/`done` を呼び出し時刻 `calledAt` の新しい順に最大5件、その番号配列。
  - `waiting_numbers`: `waiting` 状態の番号を昇順にした配列。
  - `waiting_count`: `waiting` 件数。
  - `last_issued`: `state.lastIssued`。
  - `avg_serve_ms`: 既存 `averageServeInterval(state)`（無ければ null）。
- `computeAhead(waitingNumbers, myNumber)` → `{ found, ahead }`。`myNumber` が `waitingNumbers` にあれば `found:true`、`ahead` は自分より前（小さい番号）の待ち件数。無ければ `found:false, ahead:0`。
- `estimateWaitMsForNumber(ahead, avgServeMs)` → 予想待ちミリ秒。`avgServeMs` が null/0 のときは null（推定不可）。基本は `ahead * avgServeMs`。

`buildPublicStatus` は店側、`computeAhead`/`estimateWaitMsForNumber` は客側で使うが、いずれも「公開状況」に関する純粋ロジックとして1ファイルにまとめ、店ページ・客ページ双方から読み込む。

## データフロー

1. 店：オンライン共有を有効化し、Supabase URL・anonキー・秘密キーを入力（localStorage保存）。
2. 店：キュー変化（発券／呼出／完了／リセット）のたびに `buildPublicStatus(state)` → `publishStatus` で RPC `publish_status` をPOST。
3. Supabase：RPC内で秘密キー照合 → 一致時のみ `queue_status` を更新。
4. 客：QRから `status.html` を開く → 5秒ごとに REST GET で行を取得。
5. 客：現在呼び出し中・待ち組数・直近履歴を表示。自分の番号入力で `computeAhead`＋`estimateWaitMsForNumber` から「あと約N組・約M分」。

## お客さんページのUI（スマホ前提・縦1カラム）

- 店名（任意・設定があれば）。
- 大きく「ただいま **38番** をお呼び出し中」。`calling_number` が null なら「準備中です」。
- 「あなたの番号」数値入力＋確認ボタン → 「あと約3組・約12分」。`found:false` のときは「呼び出し済み、または完了の可能性があります」。`avg_serve_ms` が null のときは組数のみ表示。
- 「現在 5組お待ち」。
- 「直近の呼び出し：38・37・36 …」。
- 最終更新時刻と「自動更新中」表示。

## エラー・端の処理

- 共有OFF／未設定 → 店アプリは従来通り（通信ゼロ、回帰なし）。
- publish失敗（ネット切断・秘密キー誤り）→ 店に小さな警告を表示。キュー操作は止めず、`seiriken-state` も変更しない。
- 客ページの通信失敗 → 「再接続中…」を表示。直前に取得した値を保持し、次のポーリングで自動回復。
- `avg_serve_ms` 未算出（案内実績が無い）→ 分の予想は隠し、組数のみ表示。
- リセット → 空状態（calling_number=null, waiting_numbers=[], count=0 等）をpublishして客ページもクリアされる。
- 客が入力した番号が待ち行列に無い → 「呼び出し済み/完了の可能性」を案内。
- 既存データの移行不要（共有設定は別キーの新規データ）。

## テスト（status.test.html）

既存 `queue.test.html` / `printer.test.html` と同じ `check(name, condition)` 方式＋ Node `vm` ハーネスで `status.js` の純粋関数を検証する。

- `buildPublicStatus`: サンプル `state` から `calling_number`（最後にcalledされた番号）・`recent_called`（calledAt新しい順・最大5件）・`waiting_numbers`（昇順）・`waiting_count`・`last_issued`・`avg_serve_ms` が正しい。
- `computeAhead`: 自分の前の組数を正しく数える。未発見時 `found:false, ahead:0`。
- `estimateWaitMsForNumber`: `ahead * avgServeMs`。`avgServeMs` が null/0 のとき null。
- 純粋関数が引数（`state`・配列）を破壊しないこと。

Supabase（テーブル・RLS・RPC）、店からの publish 通信、客ページのポーリング・DOM描画はクラウド/ブラウザ依存のため手動検証とする。

## デプロイ・手動検証手順（実装計画で詳細化）

1. Supabase プロジェクト作成 → SQLエディタで `queue_status` テーブル・RLS・秘密保管テーブル・`publish_status` 関数を作成。秘密キーを設定。
2. リポジトリを GitHub Pages で公開（店アプリ `index.html`・客ページ `status.html` を同一オリジンで配信）。
3. 店アプリ設定画面で URL・anonキー・秘密キーを入力し有効化。発券・呼出してみて Supabase の行が更新されることを確認。
4. 客ページ（`status.html`）を別端末/スマホで開き、呼び出し中番号・待ち組数・履歴が5秒以内に反映されること、自分の番号入力で順番が出ることを確認。
5. 印刷設定の `qrUrl` に客ページURLを設定し、印刷したQRから到達できることを確認。

## MVPに含めないもの（将来の拡張）

- プッシュ通知／「あなたの番です」通知。
- 複数店舗・複数キュー（セッションID分離）。
- Realtime購読（WebSocket）による即時更新（現状はポーリング）。
- 客ページの多言語切り替え（必要なら後日）。
