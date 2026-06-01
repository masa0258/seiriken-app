# 整理券 印刷システム 設計

作成日: 2026-06-01

## 目的

整理券アプリに「サーマルレシートプリンターへの印刷」機能を追加する。発券した整理券を物理的に印刷し、店名・番号・人数・発券時刻・予想待ち時間・QRコード・案内メッセージを印字する。印字内容は店が編集できるようにする。サーバーは追加せず、現在の単一HTMLファイル構成を維持する。

## スコープ

### 今回やること（印刷サブシステム）
- サーマルレシートプリンターとの接続（WebUSB / Web Serial と Web Bluetooth の両対応）
- 印刷物（整理券）のレイアウト：店名・ヘッダー文・「整理券/TICKET」・番号・人数・発券時刻・予想待ち時間・QR・フッター文
- 印刷物の編集（店名・ヘッダー文・フッター文・QRリンク先URL・予想待ち時間の表示ON/OFF）
- QRコードの印字（プリンターのネイティブQR命令）

### 今回やらないこと（将来別プロジェクト）
- 顧客スマホでのリアルタイム呼び出し状況表示・通知（共有バックエンドが必要なため別プロジェクト）

## 確定した方針

- **プリンター**: サーマルレシートプリンター。USB（WebUSB / Web Serial）と Bluetooth（Web Bluetooth）の両方に対応する。
- **用紙幅**: 80mm（印字幅 576 dot を前提）。
- **印字方式**: 文字・レイアウト部分はブラウザの canvas に描画し、それを ESC/POS のラスター印刷命令（GS v 0）として送る。これにより日本語の Shift-JIS エンコード問題を回避し、画面プレビューと印刷結果を一致させる。
- **QR**: ESC/POS のネイティブQR命令（GS ( k）で印字する。ラスター画像ブロックの後に続けて出力する。
- **レイアウト**: フル構成（店名・ヘッダー文・番号・人数・発券時刻・予想待ち時間・QR・フッター文）。
- **設定保存**: localStorage。既存の `seiriken-state` とは別キー `seiriken-print-settings`。
- **発券時の印刷UX**: プリンター接続済みなら発券時に自動印刷。未接続なら画面表示のみ。

## アーキテクチャ

既存構成（`index.html` が UI・永続化・描画、`queue.js` が純粋ロジック、`queue.test.html` がテスト）を踏襲する。印刷ロジックのうち純粋に計算できる部分を新ファイル `printer.js` に分離し、テスト可能にする。canvas 描画と通信はハードウェア依存のため `index.html` に置き、実機での手動検証とする。

### printer.js（純粋関数・DOM非依存・テスト可能）

- `escposInit()` → `Uint8Array`: プリンター初期化（ESC @）。
- `escposFeed(n)` → `Uint8Array`: n ドット／行ぶん紙送り。
- `escposCut()` → `Uint8Array`: 用紙カット命令。
- `escposQR(text, opts)` → `Uint8Array`: ネイティブQR命令（GS ( k）。モデル2、セルサイズ・誤り訂正レベルを `opts` で指定。`text` を格納→印字するコマンド列を返す。
- `imageDataToMonoBitmap(imageData, threshold)` → `{ width, height, data }`:
  RGBA 画素配列（`{ width, height, data: Uint8ClampedArray }` 形）を、1bpp（1ピクセル1ビット、行単位でバイト境界に詰める）モノクロビットマップに変換する。輝度が `threshold` 未満を黒（ビット1）とする。`threshold` 既定 128。
- `escposRaster(monoBitmap)` → `Uint8Array`: `{ width, height, data }` をラスター印刷命令（GS v 0、ノーマルモード）に変換する。命令ヘッダに横バイト数・縦ドット数を正しく埋める。
- `buildTicketCommands({ rasterBitmap, qrText, settings })` → `Uint8Array`:
  `escposInit()` → `escposRaster(rasterBitmap)` →（`qrText` が空でなければ中央寄せ＋`escposQR(qrText)`）→ `escposFeed` → `escposCut()` を連結した完成バイト列を返す。`qrText` が空・null のときはQRブロックを含めない。

### index.html（DOM・canvas・通信。実機手動検証）

- `renderTicketCanvas(ticketData, settings)` → `HTMLCanvasElement`:
  幅 576px の canvas にレイアウトを描画する。店名（ヘッダー文）、「整理券 / TICKET」、大きな番号、人数、発券時刻、（`settings.showWaitEstimate` が真なら）予想待ち時間、フッター文を日本語フォントで描画する。QRは描画しない（ネイティブ命令で別途印字）。`ticketData = { number, partySize, issuedAt, waitMs }`。
- プレビュー表示: 設定画面で `renderTicketCanvas` の結果を画面に表示し、QR位置にはプレースホルダ（「QR印字位置」）を出す。
- トランスポート:
  - `connectUsb()`: WebUSB（または Web Serial）でプリンターを選択・接続する。
  - `connectBluetooth()`: Web Bluetooth でプリンターを選択・接続する。
  - `sendBytes(bytes)`: 接続中のトランスポートへ `Uint8Array` を送信する。
- 印刷実行: `ticketData` と `settings` から `renderTicketCanvas` → `ImageData` 取得 → `imageDataToMonoBitmap` → `escposRaster` → `buildTicketCommands`（`qrText = settings.qrUrl`）→ `sendBytes`。
- 設定画面（新規）: 印刷物の編集フォーム＋「プリンター接続（USB / Bluetooth）」＋「テスト印刷」ボタン。

### 印刷設定モデル（localStorage `seiriken-print-settings`）

```
{
  storeName: string,        // 店名
  headerMessage: string,    // 店名下の挨拶（空なら非印字）
  footerMessage: string,    // 末尾の案内文（空なら非印字）
  qrUrl: string,            // QRリンク先。空ならQR非印字
  showWaitEstimate: boolean // 予想待ち時間を印字するか
}
```

未保存時は既定値（店名は空、`showWaitEstimate: true`、その他空文字）を使う。

## データフロー

1. 設定を localStorage から読む（無ければ既定値）。
2. 発券（または設定画面のテスト印刷）で `ticketData` を組み立てる。予想待ち時間は既存の `estimatedWaitMsForNew` / `estimatedWaitMs` から取得。
3. `renderTicketCanvas(ticketData, settings)` で canvas を描画。
4. canvas の `ImageData` を取り出し `imageDataToMonoBitmap` で 1bpp 化。
5. `escposRaster` でラスター命令化、`buildTicketCommands` で QR（`settings.qrUrl`）とカットを含めて組み立て。
6. `sendBytes` で接続中プリンターへ送信。
7. プレビューは同じ canvas を画面表示。

## エラー・端の処理

- プリンター未接続のまま印刷 → 送信せず「プリンター未接続」を案内。
- WebUSB / Web Bluetooth 非対応ブラウザ（Chrome / Edge 以外）→ 接続不可を案内。プレビュー表示は動作する。
- `qrUrl` が空 → QRブロックを印字しない。
- 設定が未保存 → 既定値を使う。
- 送信失敗（切断等）→ 例外を捕捉してメッセージ表示。状態（`seiriken-state`）は変更しない。
- 既存データの移行不要（印刷設定は別キーの新規データ）。

## テスト（printer.test.html）

既存 `queue.test.html` と同じ `check(name, condition)` 方式。`printer.js` の純粋関数を検証する：

- `escposInit` / `escposCut` / `escposFeed`: 既知のバイト列を返す。
- `escposQR`: 既知文字列に対し、ストア命令＋印字命令の正しいバイト列を返す。`text` 長に応じた長さフィールドが正しい。
- `imageDataToMonoBitmap`: 既知の小さな RGBA 画素に対し、閾値で黒/白が正しく 1bpp 化され、行がバイト境界に詰められる。
- `escposRaster`: 指定寸法に対しヘッダの横バイト数・縦ドット数が正しい。
- `buildTicketCommands`: `qrText` 有りでQRブロックを含み、空でQRブロックを含まない。先頭が init、末尾が cut。
- 純粋関数が引数を破壊しないこと。

canvas 描画（`renderTicketCanvas`）と通信（`connectUsb` / `connectBluetooth` / `sendBytes`）は実機での手動検証とする（ハードウェア依存・ブラウザAPI依存のため自動テスト対象外）。

## MVPに含めないもの（将来の拡張）

- 顧客スマホ向けのリアルタイム状況表示・通知（機能B、別プロジェクト）。
- 用紙幅 58mm 切り替え（今回は 80mm 固定）。
- ロゴ画像のアップロード印字。
- 複数プリンタープロファイルの保存。
