# 顧客向け呼び出し状況ページ デプロイ・検証手順

## 1. Supabase セットアップ
1. https://supabase.com で無料プロジェクトを作成する。
2. プロジェクトの **Settings → API** から `Project URL`（例 `https://xxxx.supabase.co`）と `anon public` キーを控える。
3. **SQL Editor** を開き、`docs/superpowers/supabase-setup.sql` の内容を貼り付ける。
4. `★ここに秘密キーを設定★` を任意の長い文字列（書き込み用の秘密キー）に置き換えて実行する。
5. **Table Editor** で `queue_status` に `id='main'` の行が1件あることを確認する。

## 2. GitHub Pages で公開
1. このリポジトリを GitHub に push する。
2. リポジトリの **Settings → Pages** で、Source を `main` ブランチのルートに設定して保存する。
3. 数分後、`https://<ユーザー名>.github.io/<リポジトリ名>/index.html`（店アプリ）と
   `https://<ユーザー名>.github.io/<リポジトリ名>/status.html`（客ページ）が HTTPS で開けることを確認する。

## 3. 客ページに Supabase 情報を埋め込む
`status.html` の先頭スクリプトの `SUPABASE_URL` と `SUPABASE_ANON_KEY` を、手順1で控えた値に書き換えて push する。
（anonキーは公開前提なので埋め込んで問題ない。秘密キーは絶対に書かない。）

## 4. 店アプリの設定
1. 公開した店アプリ（`index.html`）を開き、設定画面の「オンライン共有」で:
   - 「オンライン共有を有効にする」をチェック
   - Supabase URL・anonキー・秘密キー（手順1-4で設定したもの）を入力
   - 「オンライン共有設定を保存」
2. 発券・呼出してみて、Supabase の `queue_status` 行が更新されること（Table Editor で確認）。

## 5. 客ページの検証（別端末/スマホ推奨）
1. `status.html` を開く。
2. 店アプリで呼出した番号が5秒以内に「ただいまお呼び出し中」に反映されること。
3. 待機中の自分の番号を入力→「あと約N組（・約M分）」が出ること。
4. 待ち組数・直近の呼び出し履歴が反映されること。
5. リセットすると客ページが空状態（準備中・0組）になること。

## 6. QRと連携
店アプリの印刷設定で `QRリンク先URL` に客ページのURL
（`https://<ユーザー名>.github.io/<リポジトリ名>/status.html`）を設定し、
印刷したQRからそのページに到達できることを確認する。

## トラブルシューティング
- 店アプリで「オンライン共有エラー: HTTP 401/unauthorized」→ 秘密キーが Supabase 側と不一致。SQLの秘密キーと店アプリ入力を一致させる。
- 客ページが「再接続中…」のまま → `SUPABASE_URL`/`SUPABASE_ANON_KEY` の綴り、または `queue_status` の SELECT ポリシーを確認。
- CORS エラー → 店アプリ・客ページを GitHub Pages（HTTPS）から開く。`file://` では Supabase 通信が失敗する。
