# お客さん「あなたの番です」通知 設計

作成日: 2026-06-01

## 目的

顧客向け呼び出し状況ページ（`status.html`）を開いている客が、自分の整理券番号を登録しておくと、店がその番号に近づいた／呼び出した瞬間に、スマホで音・バイブ・全画面表示の通知を受け取れるようにする。客が画面を見続けなくても呼び出しに気づける。

これは元の顧客向けページ設計で YAGNI として将来送りにした「プッシュ通知・『あなたの番です』通知」のうち、**ページを開いている間だけ動く軽量版**にあたる。

## スコープ

### 今回やること
- `status.html` に「通知を受け取る」登録UIを追加。客が自分の整理券番号を登録できる。
- 5秒ごとの既存ポーリングのたびに、登録番号が「もうすぐ呼ばれる／呼ばれた」状態かを判定。
- 「もうすぐ」（事前予告）と「あなたの番です」（本通知）の2段階を、それぞれ1回だけ鳴らす。
- 通知手段: 音（Web Audio API のビープ）＋バイブ（`navigator.vibrate`）＋全画面オーバーレイ表示。
- 判定ロジックは `status.js` に純粋関数として追加し、`vm` ハーネスでテストする。

### 今回やらないこと（YAGNI）
- 個人情報（氏名・電話番号・人数）の入力・送信・保存。番号のみ扱う。
- ページを閉じている／スマホがロック中でも届く真のプッシュ通知（Web Push・PWA・Edge Function）。
- LINE / SMS / メール連携。
- Supabase・店アプリ（`index.html`）・送信処理（publish）の変更。バックエンドは一切触らない。
- 通知音の種類選択・音量設定・多言語化。

## 確定した方針

- **方向**: 客に「あなたの番です」を届ける（店への通知ではない）。
- **到達範囲**: 客が `status.html` を開いている間だけ。サーバー不要・無料・iPhone/Android両対応・個人情報ゼロ。
- **タイミング**: 2段階。「もうすぐ」（あと `threshold` 組以下）＋「あなたの番です」（呼び出し時）。
- **個人情報**: 一切扱わない。整理券番号だけを localStorage に保持。
- **実装分離（アプローチA）**: 判定は `status.js` の純粋関数、副作用（音・バイブ・表示）は `status.html`。既存の「純粋ロジックはモジュール、副作用はHTML」パターンを踏襲。
- **影響範囲**: `status.html` と `status.js` のみ。

## アーキテクチャ

### 純粋関数 `status.js`（追加）

```
evaluateNotify(row, myNumber, threshold, fired) → { stage, fired }
```

- **入力**:
  - `row`: 取得した行。参照するのは `calling_number`(int|null)、`recent_called`(配列)、`waiting_numbers`(昇順配列)。
  - `myNumber`: 客が登録した整理券番号（int）。
  - `threshold`: 「あと何組以下で『もうすぐ』を出すか」（int、既定 1）。
  - `fired`: これまでに鳴らした段階のラッチ `{ soon: boolean, turn: boolean }`。
- **判定**:
  - `computeAhead(row.waiting_numbers, myNumber)` で `{ found, ahead }` を得る。
  - `isCalled` = `row.calling_number === myNumber` または `row.recent_called` が `myNumber` を含む。
  - 優先順位で1つだけ決める:
    1. `isCalled && !fired.turn` → `stage:'turn'`。返す `fired` は `{ soon:true, turn:true }`（turn後はsoonを出さない）。
    2. それ以外で `found && ahead <= threshold && !fired.soon` → `stage:'soon'`。返す `fired` は `{ soon:true, turn:fired.turn }`。
    3. それ以外 → `stage:null`。`fired` は変更なし（同じ内容の新オブジェクト）。
- **純粋性**: 引数 `row`・`fired` を破壊しない。新しい `fired` オブジェクトを返す。
- **端ケース**:
  - 番号が待機にも `recent_called` にも `calling_number` にも無い（完了済み等）→ どちらも鳴らさない（`null`）。
  - `ahead === 0`（自分が先頭で待機中）→ `ahead <= threshold` を満たし「もうすぐ」が出る。
  - `myNumber` 未登録の扱いは呼び出し側の責務（未登録なら関数を呼ばない）。

### 副作用 `status.html`（追加）

- **登録UI**: 既存の「あなたの番号」入力欄・確認ボタンはそのまま残す。新たに「🔔 通知を受け取る」ボタンを追加。タップで:
  1. 入力中の番号を通知対象として登録（`localStorage` キー `seiriken-notify` に `{ number, fired }` を保存）。
  2. Web Audio の `AudioContext` を生成/`resume()` して音を解錠（ブラウザのユーザー操作要件を満たす）。
  - 登録中は「🔔 通知ON（◯番）」と「解除」ボタンを表示。解除でラッチごとクリア。別番号で登録し直したら `fired` を初期化。
- **判定呼び出し**: 既存 `poll()` が行を取得するたび、登録番号があれば `evaluateNotify(row, number, THRESHOLD, fired)` を呼ぶ。`stage` が `'soon'`/`'turn'` なら通知を実行し、返ってきた `fired` を保存（localStorageにも反映）。
- **通知の実行 `fireAlert(stage)`**:
  - 音: 解錠済み `AudioContext` で `OscillatorNode` を鳴らす（外部ファイル不要）。未解錠なら無音でスキップ。
  - バイブ: `navigator.vibrate` があれば実行（`'turn'` は長め、`'soon'` は短め）。
  - 表示: `createElement`/`textContent`/`appendChild` のみで全画面オーバーレイを生成。`'soon'`→「まもなくお呼び出しです」、`'turn'`→「あなたの番です！」＋「閉じる」ボタン。`innerHTML` は使わない。
- **1回だけ**: `fired` 変数＋ localStorage 永続化で、ページ更新後も二重に鳴らさない／登録が消えない。
- **注意書き**: 「通知のため、この画面を開いたままにしてください」を常時表示。

### 設定値

- `THRESHOLD = 1`（あと1組以下で「もうすぐ」）。`status.html` の先頭定数に置く。

## データフロー

1. 客が番号を入力して「🔔 通知を受け取る」をタップ → 番号と空ラッチを localStorage 保存、音を解錠。
2. `poll()` が5秒ごとに Supabase から行を取得（既存処理）。
3. 登録番号があれば `evaluateNotify(row, number, 1, fired)` を呼ぶ。
4. `stage` が出たら `fireAlert(stage)` で音・バイブ・全画面表示。`fired` を更新・保存。
5. 「もうすぐ」「あなたの番です」はそれぞれ1回だけ鳴る。

## エラー・端の処理

- 音が未解錠（登録前）→ 無音。表示・バイブは可能なら出す。
- `navigator.vibrate` 非対応（iPhone等）→ バイブはスキップ、音＋表示でカバー。
- ページ更新 → localStorage から番号と `fired` を復元、二重通知しない。
- 店がリセット → 番号がどこにも無くなるが、既に鳴らした `fired` はそのまま（再通知しない）。客は「解除」で手動クリア可能。
- 番号未登録 → `evaluateNotify` を呼ばない（従来どおりの表示のみ）。
- 通信失敗 → 既存どおり「再接続中…」、前回値保持。通知判定は次の成功ポーリングで再開。

## UI（status.html 追加分・スマホ前提）

- 既存の「あなたの番号」入力＋「確認」の下に「🔔 通知を受け取る」ボタン。
- 登録中: 「🔔 通知ON（38番）」＋「解除」。
- 全画面オーバーレイ: 中央に大きな文言（まもなく／あなたの番です）、下に「閉じる」。
- 画面下に常時「※通知のため、この画面を開いたままにしてください」。

## テスト（status.test.html に追加）

`vm` ハーネスで `evaluateNotify` を検証する:

- 待機中で `ahead > threshold`、`fired` 空 → `stage:null`。
- 待機中で `ahead <= threshold`、soon未通知 → `stage:'soon'`、返り `fired.soon === true`。
- soon通知済み（`fired.soon:true`）で同条件 → `stage:null`。
- 呼ばれた（`calling_number === myNumber`）、turn未通知 → `stage:'turn'`、返り `fired.turn === true`。
- 呼ばれた状態で `fired.turn:true` → `stage:null`。
- turn通知時に `fired.soon` も `true` になる（turn後にsoonが出ない）。
- `recent_called` に自分の番号が含まれる → `isCalled` 扱いで `'turn'`。
- 待機にも呼び出しにも該当しない → `stage:null`。
- 引数 `row`・`fired` を破壊しないこと。

音・バイブ・全画面表示・iPhoneでの実挙動はブラウザ依存のため手動検証とする。

## 手動検証

1. `status.html`（公開URL）をスマホで開く。
2. 番号を入力し「🔔 通知を受け取る」をタップ（音解錠）。
3. 店アプリで、その番号の手前まで進める → あと1組で「まもなく」通知（音・表示）。
4. その番号を呼び出す → 「あなたの番です！」通知（音・バイブ・全画面）。
5. ページを更新しても二重に鳴らないこと、登録が保持されること。
6. 「解除」で通知が止まり、別番号で再登録するとラッチがリセットされること。

## 将来の拡張（今回外）

- Web Push / PWA による画面を閉じても届く通知。
- LINE / SMS / メール通知。
- 通知音・バイブパターンのカスタマイズ。
