# 整理券 印刷システム Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サーマルレシートプリンター（80mm）へ、店名・番号・人数・時刻・予想待ち時間・QR・メッセージを印字する機能を、サーバーなし単一HTML構成のまま追加する。

**Architecture:** ESC/POSバイト列を生成する純粋関数を新ファイル `printer.js` に分離してテスト可能にする。文字・レイアウトはブラウザの canvas に描画→ラスター印刷命令（GS v 0）で送り、日本語のエンコード問題を回避する。QRはネイティブQR命令（GS ( k）。USB（WebUSB）と Bluetooth（Web Bluetooth）の2トランスポートに対応。canvas描画と通信は実機手動検証。

**Tech Stack:** Vanilla JS, ESC/POS, WebUSB, Web Bluetooth, Canvas 2D, localStorage。ビルドツール・サーバー・外部ライブラリなし。DOM操作は `textContent`/`createElement`/`appendChild` のみ（`innerHTML` 禁止＝セキュリティフックでブロック）。

---

## File Structure

- **Create `printer.js`** — ESC/POSバイト列生成の純粋関数群（DOM非依存・テスト可能）。`escposInit` / `escposFeed` / `escposCut` / `escposQR` / `imageDataToMonoBitmap` / `escposRaster` / `buildTicketCommands` と内部ヘルパー `concatBytes`。
- **Create `printer.test.html`** — `printer.js` の純粋関数テスト（既存 `queue.test.html` と同じ `check()` 方式）。
- **Modify `index.html`** — 印刷設定モデル＋「設定」画面、`renderTicketCanvas` とプレビュー、トランスポート（USB/BT）と印刷パイプライン、発券時の自動印刷。canvas/通信は実機手動検証。

## テスト実行方法（Node ハーネス）

ブラウザ自動化が使えないため、純粋関数テストは Node の `vm` モジュールで `printer.test.html` の `<script>` を読み込んで検証する。**この同じコマンドを Task 1〜5 の各「テスト実行」ステップで使う**（作業ディレクトリは常に `/Users/hasemasahiro/Desktop/seiriken-app`）：

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && node -e '
const fs = require("fs");
const vm = require("vm");
const pjs = fs.readFileSync("printer.js", "utf8");
const html = fs.readFileSync("printer.test.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let pass = 0, fail = 0;
const sandbox = {
  TextEncoder: TextEncoder, Uint8Array: Uint8Array, Uint8ClampedArray: Uint8ClampedArray, console: console,
  document: {
    getElementById: function () { return { appendChild: function () {} }; },
    createElement: function () {
      let o = { style: {} };
      Object.defineProperty(o, "textContent", { set: function (v) { if (v.indexOf("PASS") === 0) pass++; else { fail++; console.log(v); } } });
      return o;
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(pjs, sandbox);
vm.runInContext(m[1], sandbox);
console.log("PASS=" + pass + " FAIL=" + fail);
'
```

正規表現 `/<script>([\s\S]*?)<\/script>/` は属性なしの `<script>`（=テスト本体）にマッチする。`<script src="printer.js">` は属性付きなのでマッチしない。`document` をスタブし、`check()` が生成する `textContent`（"PASS: ..." / "FAIL: ..."）を数えて集計する。

---

## Task 1: ESC/POS 基本命令（init / feed / cut）

**Files:**
- Create: `printer.js`
- Create: `printer.test.html`

- [ ] **Step 1: テストファイルの骨組みと最初の失敗テストを書く**

`printer.test.html` を新規作成：

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>printer.js tests</title></head>
<body>
<h1>printer.js テスト結果</h1>
<ul id="results"></ul>
<script src="printer.js"></script>
<script>
  const results = document.getElementById('results');
  function check(name, cond) {
    const li = document.createElement('li');
    li.textContent = (cond ? 'PASS: ' : 'FAIL: ') + name;
    li.style.color = cond ? 'green' : 'red';
    results.appendChild(li);
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function includesSeq(arr, sub) {
    for (let i = 0; i + sub.length <= arr.length; i++) {
      let ok = true;
      for (let j = 0; j < sub.length; j++) if (arr[i + j] !== sub[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  check('escposInit は ESC @', bytesEqual(escposInit(), new Uint8Array([0x1B, 0x40])));
  check('escposFeed(3) は ESC d 3', bytesEqual(escposFeed(3), new Uint8Array([0x1B, 0x64, 3])));
  check('escposCut は GS V 0', bytesEqual(escposCut(), new Uint8Array([0x1D, 0x56, 0x00])));
</script>
</body>
</html>
```

- [ ] **Step 2: テストを実行して失敗を確認**

上記「テスト実行方法」のコマンドを実行。
Expected: `printer.js` が存在しないため `ENOENT` エラー（ファイル未作成）。

- [ ] **Step 3: printer.js を作成し最小実装**

`printer.js` を新規作成：

```javascript
// ESC/POS バイト列生成（純粋関数・DOM非依存）

function concatBytes() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) total += arguments[i].length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < arguments.length; i++) {
    out.set(arguments[i], pos);
    pos += arguments[i].length;
  }
  return out;
}

function escposInit() {
  return new Uint8Array([0x1B, 0x40]); // ESC @
}

function escposFeed(n) {
  return new Uint8Array([0x1B, 0x64, n & 0xFF]); // ESC d n（n行送り）
}

function escposCut() {
  return new Uint8Array([0x1D, 0x56, 0x00]); // GS V 0（フルカット）
}
```

- [ ] **Step 4: テストを実行して成功を確認**

上記「テスト実行方法」のコマンドを実行。
Expected: `PASS=3 FAIL=0`

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add printer.js printer.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add ESC/POS init/feed/cut byte builders"
```

---

## Task 2: ネイティブQR命令（escposQR）

**Files:**
- Modify: `printer.js`
- Modify: `printer.test.html`

- [ ] **Step 1: 失敗テストを追加**

`printer.test.html` の `</script>` 直前（Task 1 の3つの check の後）に追記：

```javascript
  check('escposQR("AB") は GS ( k のモデル/サイズ/誤り訂正/格納/印字列', bytesEqual(
    escposQR('AB', { size: 6, ec: 'M' }),
    new Uint8Array([
      0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // モデル2
      0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06,       // セルサイズ6
      0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31,       // 誤り訂正M(49)
      0x1D, 0x28, 0x6B, 0x05, 0x00, 0x31, 0x50, 0x30, 0x41, 0x42, // 格納 "AB"
      0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30        // 印字
    ])
  ));
  check('escposQR の格納長は データ長+3', (() => {
    const bytes = escposQR('ABCD', {});            // 4バイト → 格納pL=7
    return includesSeq(Array.from(bytes), [0x1D, 0x28, 0x6B, 0x07, 0x00, 0x31, 0x50, 0x30, 0x41, 0x42, 0x43, 0x44]);
  })());
```

- [ ] **Step 2: テストを実行して失敗を確認**

「テスト実行方法」のコマンドを実行。
Expected: `escposQR is not defined` で `FAIL`（または ReferenceError）。

- [ ] **Step 3: escposQR を実装**

`printer.js` の末尾に追記：

```javascript
// ネイティブQR命令（GS ( k）。opts.size 既定6（1-16）、opts.ec 既定'M'（'L'|'M'|'Q'|'H'）
function escposQR(text, opts) {
  opts = opts || {};
  const size = opts.size || 6;
  const ecMap = { L: 48, M: 49, Q: 50, H: 51 };
  const ec = ecMap[opts.ec] || ecMap.M;
  const data = new TextEncoder().encode(text);

  const model = new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
  const cell = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size & 0xFF]);
  const level = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, ec]);

  const storeLen = data.length + 3;
  const storeHeader = new Uint8Array([0x1D, 0x28, 0x6B, storeLen & 0xFF, (storeLen >> 8) & 0xFF, 0x31, 0x50, 0x30]);
  const store = concatBytes(storeHeader, data);

  const print = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);

  return concatBytes(model, cell, level, store, print);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

「テスト実行方法」のコマンドを実行。
Expected: `PASS=5 FAIL=0`

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add printer.js printer.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add native QR command builder (escposQR)"
```

---

## Task 3: RGBA→1bppモノクロ変換（imageDataToMonoBitmap）

**Files:**
- Modify: `printer.js`
- Modify: `printer.test.html`

- [ ] **Step 1: 失敗テストを追加**

`printer.test.html` の `</script>` 直前に追記：

```javascript
  check('imageDataToMonoBitmap は黒=ビット1で1bpp化（8x1交互）', (() => {
    // 8px: 黒,白,黒,白,黒,白,黒,白 → 10101010 = 0xAA
    const data = new Uint8ClampedArray(8 * 4);
    for (let x = 0; x < 8; x++) {
      const v = (x % 2 === 0) ? 0 : 255; // 偶数=黒
      data[x * 4] = v; data[x * 4 + 1] = v; data[x * 4 + 2] = v; data[x * 4 + 3] = 255;
    }
    const mb = imageDataToMonoBitmap({ width: 8, height: 1, data: data }, 128);
    return mb.width === 8 && mb.height === 1 && mb.data.length === 1 && mb.data[0] === 0xAA;
  })());
  check('imageDataToMonoBitmap は行をバイト境界に詰める（2x2全黒）', (() => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) { data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; }
    const mb = imageDataToMonoBitmap({ width: 2, height: 2, data: data }, 128);
    // stride = ceil(2/8)=1, 各行 0b11000000 = 0xC0
    return mb.data.length === 2 && mb.data[0] === 0xC0 && mb.data[1] === 0xC0;
  })());
  check('imageDataToMonoBitmap は透明を白扱い', (() => {
    const data = new Uint8ClampedArray(8 * 4); // 全0（黒・alpha0）
    const mb = imageDataToMonoBitmap({ width: 8, height: 1, data: data }, 128);
    return mb.data[0] === 0x00; // alpha0 は白 → 全ビット0
  })());
```

- [ ] **Step 2: テストを実行して失敗を確認**

「テスト実行方法」のコマンドを実行。
Expected: `imageDataToMonoBitmap is not defined` で `FAIL`。

- [ ] **Step 3: imageDataToMonoBitmap を実装**

`printer.js` の末尾に追記：

```javascript
// RGBA画素（{width,height,data}）を1bppモノクロビットマップに変換する。
// 輝度 < threshold かつ alpha>=128 を黒（ビット1, MSB先頭）。行はバイト境界に詰める。
function imageDataToMonoBitmap(imageData, threshold) {
  if (threshold === undefined) threshold = 128;
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data;
  const stride = Math.ceil(width / 8);
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const black = a >= 128 && lum < threshold;
      if (black) {
        out[y * stride + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }
  return { width: width, height: height, data: out };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

「テスト実行方法」のコマンドを実行。
Expected: `PASS=8 FAIL=0`

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add printer.js printer.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add RGBA to 1bpp mono bitmap conversion"
```

---

## Task 4: ラスター印刷命令（escposRaster）

**Files:**
- Modify: `printer.js`
- Modify: `printer.test.html`

- [ ] **Step 1: 失敗テストを追加**

`printer.test.html` の `</script>` 直前に追記：

```javascript
  check('escposRaster は GS v 0 ヘッダ＋画素を返す', (() => {
    const mb = { width: 8, height: 1, data: new Uint8Array([0xAA]) };
    return bytesEqual(escposRaster(mb), new Uint8Array([0x1D, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xAA]));
  })());
  check('escposRaster のヘッダは横バイト数と縦ドット数を正しく持つ', (() => {
    // width=16 → stride=2, height=3
    const mb = { width: 16, height: 3, data: new Uint8Array(2 * 3) };
    const out = escposRaster(mb);
    // header: 1D 76 30 00 xL=2 xH=0 yL=3 yH=0
    return out[4] === 0x02 && out[5] === 0x00 && out[6] === 0x03 && out[7] === 0x00 && out.length === 8 + 6;
  })());
```

- [ ] **Step 2: テストを実行して失敗を確認**

「テスト実行方法」のコマンドを実行。
Expected: `escposRaster is not defined` で `FAIL`。

- [ ] **Step 3: escposRaster を実装**

`printer.js` の末尾に追記：

```javascript
// 1bppモノクロビットマップ（{width,height,data}）をラスター印刷命令（GS v 0, m=0）に変換する。
function escposRaster(monoBitmap) {
  const stride = Math.ceil(monoBitmap.width / 8);
  const height = monoBitmap.height;
  const header = new Uint8Array([
    0x1D, 0x76, 0x30, 0x00,
    stride & 0xFF, (stride >> 8) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF
  ]);
  return concatBytes(header, monoBitmap.data);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

「テスト実行方法」のコマンドを実行。
Expected: `PASS=10 FAIL=0`

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add printer.js printer.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add raster print command builder (escposRaster)"
```

---

## Task 5: チケット命令の組み立て（buildTicketCommands）

**Files:**
- Modify: `printer.js`
- Modify: `printer.test.html`

> **設計メモ:** 設計仕様では `buildTicketCommands({ rasterBitmap, qrText, settings })` だったが、`settings` は使わない（レイアウトは rasterBitmap に既に反映済み、QR文字列は qrText で明示的に渡す）。YAGNI に従い `settings` 引数は省く。

- [ ] **Step 1: 失敗テストを追加**

`printer.test.html` の `</script>` 直前に追記：

```javascript
  check('buildTicketCommands は init で始まり cut で終わる', (() => {
    const mb = { width: 8, height: 1, data: new Uint8Array([0xAA]) };
    const out = buildTicketCommands({ rasterBitmap: mb, qrText: 'AB' });
    return out[0] === 0x1B && out[1] === 0x40 &&
           out[out.length - 3] === 0x1D && out[out.length - 2] === 0x56 && out[out.length - 1] === 0x00;
  })());
  check('buildTicketCommands は qrText 有りでQRブロックを含む', (() => {
    const mb = { width: 8, height: 1, data: new Uint8Array([0xAA]) };
    const out = Array.from(buildTicketCommands({ rasterBitmap: mb, qrText: 'AB' }));
    return includesSeq(out, [0x1D, 0x28, 0x6B]) && includesSeq(out, [0x1B, 0x61, 0x01]); // QR命令＋中央寄せ
  })());
  check('buildTicketCommands は qrText 空でQRブロックを含まない', (() => {
    const mb = { width: 8, height: 1, data: new Uint8Array([0xAA]) };
    const out = Array.from(buildTicketCommands({ rasterBitmap: mb, qrText: '' }));
    return !includesSeq(out, [0x1D, 0x28, 0x6B]);
  })());
```

- [ ] **Step 2: テストを実行して失敗を確認**

「テスト実行方法」のコマンドを実行。
Expected: `buildTicketCommands is not defined` で `FAIL`。

- [ ] **Step 3: buildTicketCommands を実装**

`printer.js` の末尾に追記：

```javascript
// チケット印刷の完成バイト列を組み立てる。
// init → ラスター →（qrText有り: 中央寄せ＋QR＋左寄せ）→ 紙送り → カット
function buildTicketCommands(args) {
  const rasterBitmap = args.rasterBitmap;
  const qrText = args.qrText;
  const parts = [escposInit(), escposRaster(rasterBitmap)];
  if (qrText) {
    parts.push(new Uint8Array([0x1B, 0x61, 0x01])); // ESC a 1（中央寄せ）
    parts.push(escposQR(qrText, {}));
    parts.push(new Uint8Array([0x1B, 0x61, 0x00])); // ESC a 0（左寄せ）
  }
  parts.push(escposFeed(3));
  parts.push(escposCut());
  return concatBytes.apply(null, parts);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

「テスト実行方法」のコマンドを実行。
Expected: `PASS=13 FAIL=0`

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add printer.js printer.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: assemble full ticket ESC/POS commands (buildTicketCommands)"
```

---

## Task 6: 印刷設定モデルと「設定」画面

**Files:**
- Modify: `index.html`

> このタスク以降（6〜8）は DOM・canvas・通信が絡むため自動テストせず、**Chrome/Edge で `index.html` を開いて手動検証**する。`innerHTML` は使わず `textContent`/`createElement`/`appendChild` のみ。

- [ ] **Step 1: ナビゲーションに「設定」ボタンを追加**

`index.html` の `<nav>`（69-74行）の最後のボタンの後に追加：

```html
  <button data-screen="settings">設定 / Settings</button>
```

- [ ] **Step 2: 設定画面のセクションを追加**

`index.html` の `<section id="report" ...>...</section>`（128-147行）の閉じタグ直後に追加：

```html
<section id="settings" class="screen">
  <h2>印刷設定 / Print Settings</h2>
  <div class="settings-form">
    <label>店名 / Store name<br><input id="set-storeName" type="text" maxlength="40"></label>
    <label>ヘッダー文 / Header<br><input id="set-headerMessage" type="text" maxlength="40"></label>
    <label>フッター文 / Footer<br><input id="set-footerMessage" type="text" maxlength="40"></label>
    <label>QRリンク先URL / QR link<br><input id="set-qrUrl" type="text" maxlength="200" placeholder="空ならQRを印字しません"></label>
    <label class="checkbox"><input id="set-showWaitEstimate" type="checkbox"> 予想待ち時間を印字する</label>
    <button id="save-settings-btn" class="secondary">設定を保存</button>
  </div>

  <h3>プレビュー / Preview</h3>
  <div id="ticket-preview" class="ticket-preview"></div>

  <h3>プリンター / Printer</h3>
  <div class="printer-controls">
    <button id="connect-usb-btn" class="secondary">USB接続</button>
    <button id="connect-bt-btn" class="secondary">Bluetooth接続</button>
    <button id="test-print-btn" class="secondary">テスト印刷</button>
    <p id="printer-status">プリンター: 未接続</p>
  </div>
</section>
```

- [ ] **Step 3: 設定画面のCSSを追加**

`index.html` の `<style>` 内、`.csv-btn { ... }`（65行）の後に追加：

```css
  /* 設定画面 */
  .settings-form { display: inline-flex; flex-direction: column; gap: 12px; text-align: left; max-width: 420px; }
  .settings-form label { font-size: 14px; }
  .settings-form input[type="text"] { width: 100%; padding: 8px; font-size: 16px; box-sizing: border-box; }
  .settings-form label.checkbox { display: flex; align-items: center; gap: 8px; }
  .ticket-preview { display: inline-block; }
  .ticket-preview canvas { border: 1px solid #ccc; max-width: 100%; }
  .printer-controls { margin-top: 8px; }
  #printer-status { color: #666; font-size: 14px; }
```

- [ ] **Step 4: 設定モデルの読み書きを実装**

`index.html` の `<script>` 内、`const STORAGE_KEY = 'seiriken-state';`（151行）の直後に追加：

```javascript
  const PRINT_SETTINGS_KEY = 'seiriken-print-settings';
  const DEFAULT_PRINT_SETTINGS = { storeName: '', headerMessage: '', footerMessage: '', qrUrl: '', showWaitEstimate: true };

  function loadPrintSettings() {
    try {
      const raw = localStorage.getItem(PRINT_SETTINGS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_PRINT_SETTINGS);
      const s = JSON.parse(raw);
      return Object.assign({}, DEFAULT_PRINT_SETTINGS, s);
    } catch (e) {
      return Object.assign({}, DEFAULT_PRINT_SETTINGS);
    }
  }
  function savePrintSettings(s) {
    localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(s));
  }
  let printSettings = loadPrintSettings();
```

- [ ] **Step 5: フォームの初期化・保存ハンドラを実装**

`index.html` の `<script>` 内、`renderPartySize();`（381行）の直前に追加：

```javascript
  function fillSettingsForm() {
    document.getElementById('set-storeName').value = printSettings.storeName;
    document.getElementById('set-headerMessage').value = printSettings.headerMessage;
    document.getElementById('set-footerMessage').value = printSettings.footerMessage;
    document.getElementById('set-qrUrl').value = printSettings.qrUrl;
    document.getElementById('set-showWaitEstimate').checked = printSettings.showWaitEstimate;
  }
  document.getElementById('save-settings-btn').addEventListener('click', () => {
    printSettings = {
      storeName: document.getElementById('set-storeName').value,
      headerMessage: document.getElementById('set-headerMessage').value,
      footerMessage: document.getElementById('set-footerMessage').value,
      qrUrl: document.getElementById('set-qrUrl').value,
      showWaitEstimate: document.getElementById('set-showWaitEstimate').checked,
    };
    savePrintSettings(printSettings);
    renderPreview();
    alert('設定を保存しました');
  });
  fillSettingsForm();
```

> 注: `renderPreview` は Task 7 で定義する。Task 6 と Task 7 は連続して実装すること。Task 6 単体で動作確認する場合のみ、`renderPreview();`（保存ハンドラ内）を一時コメントアウトしてフォーム保存だけ確認し、Task 7 で戻す。

- [ ] **Step 6: 手動検証**

Chrome で `index.html` を開く。「設定 / Settings」タブを開き、各項目を入力して「設定を保存」→ アラート表示。ページ再読込後も入力値が保持される（localStorage `seiriken-print-settings` に保存）ことを確認。

- [ ] **Step 7: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add print settings model and settings screen"
```

---

## Task 7: チケット canvas 描画とプレビュー

**Files:**
- Modify: `index.html`

- [ ] **Step 1: printer.js を読み込む**

`index.html` の `<script src="queue.js"></script>`（149行）の直後に追加：

```html
<script src="printer.js"></script>
```

- [ ] **Step 2: renderTicketCanvas を実装**

`index.html` の `<script>` 内、`fillSettingsForm()` 関数定義（Task 6 Step 5 で追加したブロック）の直前に追加：

```javascript
  // ticketData = { number, partySize, issuedAt, waitMs }
  // 80mm幅（576px）の canvas にレイアウトを描画して返す。QRは描画しない（ネイティブ命令で印字）。
  function renderTicketCanvas(ticketData, settings) {
    const W = 576;
    const PAD = 16;
    const items = [];
    if (settings.storeName) items.push({ text: settings.storeName, font: 'bold 40px sans-serif', h: 52 });
    if (settings.headerMessage) items.push({ text: settings.headerMessage, font: '24px sans-serif', h: 32 });
    items.push({ divider: true, h: 20 });
    items.push({ text: '整理券 / TICKET', font: '24px sans-serif', h: 36 });
    items.push({ text: String(ticketData.number), font: 'bold 140px sans-serif', h: 150 });
    items.push({ text: ticketData.partySize + '名様', font: '32px sans-serif', h: 44 });
    const d = new Date(ticketData.issuedAt);
    const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    items.push({ text: '発券 ' + hhmm, font: '24px sans-serif', h: 34 });
    if (settings.showWaitEstimate && ticketData.waitMs !== null && ticketData.waitMs !== undefined) {
      const min = Math.max(1, Math.round(ticketData.waitMs / 60000));
      items.push({ text: '予想待ち 約' + min + '分', font: 'bold 28px sans-serif', h: 40 });
    }
    if (settings.footerMessage) {
      items.push({ divider: true, h: 20 });
      items.push({ text: settings.footerMessage, font: '22px sans-serif', h: 30 });
    }

    let total = PAD * 2;
    items.forEach((it) => { total += it.h; });

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = total;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, total);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    let y = PAD;
    items.forEach((it) => {
      if (it.divider) {
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(PAD, y + it.h / 2);
        ctx.lineTo(W - PAD, y + it.h / 2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.font = it.font;
        ctx.fillText(it.text, W / 2, y);
      }
      y += it.h;
    });
    return canvas;
  }
```

- [ ] **Step 3: プレビュー描画を実装**

`index.html` の `<script>` 内、`renderTicketCanvas` の直後に追加：

```javascript
  function sampleTicketData() {
    const next = (state.lastIssued | 0) + 1;
    return { number: next, partySize: 2, issuedAt: Date.now(), waitMs: estimatedWaitMsForNew(state) };
  }
  function renderPreview() {
    const box = document.getElementById('ticket-preview');
    clearChildren(box);
    const canvas = renderTicketCanvas(sampleTicketData(), printSettings);
    box.appendChild(canvas);
    if (printSettings.qrUrl) {
      const ph = document.createElement('div');
      ph.textContent = '［QR印字位置: ' + printSettings.qrUrl + '］';
      ph.style.cssText = 'font-size:12px;color:#666;border:1px dashed #999;padding:8px;margin-top:4px;width:576px;max-width:100%;box-sizing:border-box;text-align:center;';
      box.appendChild(ph);
    }
  }
```

- [ ] **Step 4: 初期プレビューを表示**

`index.html` の `<script>` 内、`fillSettingsForm();`（Task 6 Step 5 で追加した行）の直後に追加：

```javascript
  renderPreview();
```

- [ ] **Step 5: 手動検証**

Chrome で `index.html` を開き「設定」タブへ。店名・各メッセージ・QR URL を入力し「設定を保存」→ プレビューに整理券イメージ（番号・人数・発券時刻・予想待ち時間・QRプレースホルダ）が日本語で正しく描画される。「予想待ち時間を印字する」のON/OFFで予想待ち行が出/消することを確認。

- [ ] **Step 6: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: render ticket canvas and live print preview"
```

---

## Task 8: トランスポート（USB/BT）と印刷パイプライン・自動印刷

**Files:**
- Modify: `index.html`

- [ ] **Step 1: トランスポート状態と接続関数を実装**

`index.html` の `<script>` 内、`renderTicketCanvas` 関数定義（Task 7 Step 2 で追加）の直前に追加：

```javascript
  // ===== プリンター接続（実機・Chrome/Edge専用、手動検証） =====
  let transport = null;        // 'usb' | 'bt' | null
  let usbDevice = null, usbEpOut = 0;
  let btChar = null;
  const BT_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb'; // 汎用シリアルサービス（機種により要調整）
  const BT_CHAR = '00002af1-0000-1000-8000-00805f9b34fb';    // 書き込み特性（機種により要調整）

  function setPrinterStatus(text) {
    document.getElementById('printer-status').textContent = 'プリンター: ' + text;
  }

  async function connectUsb() {
    if (!navigator.usb) { alert('このブラウザはWebUSB非対応です（Chrome/Edgeをお使いください）'); return; }
    usbDevice = await navigator.usb.requestDevice({ filters: [] });
    await usbDevice.open();
    if (usbDevice.configuration === null) await usbDevice.selectConfiguration(1);
    const iface = usbDevice.configuration.interfaces.find((i) =>
      i.alternate.endpoints.some((e) => e.direction === 'out'));
    if (!iface) throw new Error('出力エンドポイントが見つかりません');
    await usbDevice.claimInterface(iface.interfaceNumber);
    usbEpOut = iface.alternate.endpoints.find((e) => e.direction === 'out').endpointNumber;
    transport = 'usb';
    setPrinterStatus('USB接続済み');
  }

  async function connectBluetooth() {
    if (!navigator.bluetooth) { alert('このブラウザはWeb Bluetooth非対応です（Chrome/Edgeをお使いください）'); return; }
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BT_SERVICE] }] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BT_SERVICE);
    btChar = await service.getCharacteristic(BT_CHAR);
    transport = 'bt';
    setPrinterStatus('Bluetooth接続済み');
  }

  async function sendBytes(bytes) {
    if (transport === 'usb') {
      await usbDevice.transferOut(usbEpOut, bytes);
    } else if (transport === 'bt') {
      for (let i = 0; i < bytes.length; i += 100) {
        await btChar.writeValueWithoutResponse(bytes.slice(i, i + 100));
      }
    } else {
      throw new Error('プリンター未接続');
    }
  }
```

- [ ] **Step 2: 印刷パイプライン（printTicket）を実装**

`index.html` の `<script>` 内、`sendBytes` 関数の直後に追加：

```javascript
  async function printTicket(ticketData) {
    const canvas = renderTicketCanvas(ticketData, printSettings);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const mono = imageDataToMonoBitmap({ width: imageData.width, height: imageData.height, data: imageData.data }, 128);
    const commands = buildTicketCommands({ rasterBitmap: mono, qrText: printSettings.qrUrl });
    await sendBytes(commands);
  }
```

- [ ] **Step 3: 接続・テスト印刷ボタンを配線**

`index.html` の `<script>` 内、`renderPreview();`（Task 7 Step 4 の行）の直後に追加：

```javascript
  document.getElementById('connect-usb-btn').addEventListener('click', () => {
    connectUsb().catch((e) => { setPrinterStatus('接続失敗'); alert('USB接続に失敗: ' + e.message); });
  });
  document.getElementById('connect-bt-btn').addEventListener('click', () => {
    connectBluetooth().catch((e) => { setPrinterStatus('接続失敗'); alert('Bluetooth接続に失敗: ' + e.message); });
  });
  document.getElementById('test-print-btn').addEventListener('click', () => {
    printTicket(sampleTicketData()).catch((e) => alert('印刷に失敗: ' + e.message));
  });
```

- [ ] **Step 4: 発券時の自動印刷を配線**

`index.html` の発券ハンドラ（335-344行）を次の形に変更（接続済みのときのみ印刷、印刷失敗は alert で通知し発券自体は止めない）：

```javascript
  document.getElementById('issue-btn').addEventListener('click', () => {
    const waitMs = estimatedWaitMsForNew(state);
    const issuedPartySize = partySize;
    update(issueTicket(state, partySize, Date.now()));
    document.getElementById('issued-label').textContent = 'あなたの番号は / Your number is';
    document.getElementById('issued-number').textContent = state.lastIssued + '（' + issuedPartySize + '名）';
    document.getElementById('reception-wait').textContent =
      'お待ち時間 / Wait: ' + fmtWait(waitMs);
    if (transport) {
      printTicket({ number: state.lastIssued, partySize: issuedPartySize, issuedAt: Date.now(), waitMs: waitMs })
        .catch((e) => alert('印刷に失敗: ' + e.message));
    }
    partySize = 1;
    renderPartySize();
  });
```

- [ ] **Step 5: 手動検証（実機なし）**

Chrome で `index.html` を開く。
- 「設定」→「USB接続」/「Bluetooth接続」を押すとデバイス選択ダイアログが出る（キャンセルしてもエラーで落ちない＝catchされる）。
- 未接続のまま「テスト印刷」→「印刷に失敗: プリンター未接続」アラート。
- 受付タブで未接続のまま発券 → 従来通り番号表示され、印刷は走らない（エラーも出ない）。

- [ ] **Step 6: 手動検証（実機あり・任意）**

実機サーマルプリンターがある場合：USBまたはBluetoothで接続 → テスト印刷で整理券が印字され、QR URL設定時はQRが読み取れること、未設定時はQRなしで印字されることを確認。Bluetoothで印字されない場合は `BT_SERVICE`/`BT_CHAR` をプリンターの仕様に合わせて調整。

- [ ] **Step 7: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add USB/Bluetooth transports and ticket print pipeline"
```

---

## 完了基準

- `printer.js` の純粋関数テストが `PASS=13 FAIL=0`（Node ハーネス）。
- 「設定」画面で印刷物の各項目を編集・保存でき、プレビューに日本語で正しく描画される。
- USB/Bluetooth の接続ダイアログが出て、未接続時の印刷は安全に失敗メッセージを出す。
- 発券時、プリンター接続済みなら自動印刷、未接続なら従来通り画面表示のみ。
- 既存の発券・呼び出し・集計・待ち時間機能と CSV 出力が回帰なく動作する。
