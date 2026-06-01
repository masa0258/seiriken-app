# status.html リデザイン（温かみ・テラコッタ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顧客向け `status.html` の見た目を、温かみ・テラコッタ基調の洗練されたデザインに刷新する（機能・ロジックは不変）。

**Architecture:** `status.html` 単一ファイルのみ変更。(1) `<style>` ブロックを全面刷新、(2) `<body>` のマークアップを再構成（要素IDは全維持）、(3) 既存JSの描画3箇所を更新（`recent-called` をチップ表示、`waiting-count` の数字を強調、`showOverlay` に段階クラス付与）。すべて `createElement`/`textContent`/`appendChild`/`createTextNode` で行い `innerHTML` は使わない。

**Tech Stack:** 素のHTML/CSS/JS（ビルド・外部ライブラリ・外部フォントなし）。端末標準の日本語フォント。

**検証方針:** CSS/マークアップは自動テスト不可・ブラウザ自動操作も不可のため、(a) 既存 `status.js` テスト30件のPASS継続を「ロジック無変更」のリグレッションガードとし、(b) `grep -c innerHTML status.html` が 0 であることを静的に確認し、(c) スマホ実機の目視チェックリストで仕上がりを確認する。`renderRow`/`showOverlay` は `status.html` 内にあり、テストハーネス（`queue.js`+`status.js`+テストスクリプトのみ読み込み）では実行されないため、これらのJS変更はテスト結果に影響しない。

---

## 設計参照

- 設計仕様: `docs/superpowers/specs/2026-06-01-status-page-redesign-design.md`
- カラーパレット・レイアウト・制約はすべて仕様書に準拠。

## 維持必須の要素ID（壊すとJSが動かない）

`store-name`, `calling-number`, `my-number`, `my-check`, `my-result`, `notify-btn`, `notify-status`, `waiting-count`, `recent-called`, `meta`。

## テスト実行コマンド（status.js リグレッション）

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && node -e '
const fs = require("fs"); const vm = require("vm");
const qjs = fs.readFileSync("queue.js", "utf8");
const sjs = fs.readFileSync("status.js", "utf8");
const html = fs.readFileSync("status.test.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let pass = 0, fail = 0;
const sandbox = { console, Date, Array, JSON,
  document: { getElementById: () => ({ appendChild(){} }),
    createElement: () => { let o={style:{}}; Object.defineProperty(o,"textContent",{set(v){if(String(v).indexOf("PASS")===0)pass++;else{fail++;console.log(v);}}}); return o; } } };
vm.createContext(sandbox); vm.runInContext(qjs,sandbox); vm.runInContext(sjs,sandbox); vm.runInContext(m[1],sandbox);
console.log("PASS="+pass+" FAIL="+fail);'
```

Expected: `PASS=30 FAIL=0`

---

### Task 1: `<style>` ブロックと `<body>` マークアップの刷新

**Files:**
- Modify: `status.html`（`<style>...</style>` 全体、および `<div class="wrap">...</div>` の中身）

このタスクは静的な見た目のみ。JS（`<script>` 内）は一切変更しない。

- [ ] **Step 1: 着手前にリグレッションテストが緑であることを確認**

Run: 上記「テスト実行コマンド」
Expected: `PASS=30 FAIL=0`

- [ ] **Step 2: `<style>` ブロックを全面置換**

`status.html` の `<style>` 開始タグから `</style>` 終了タグまで（現状の body/.wrap/.card/... 〜 .overlay-close の全CSS）を、以下で完全に置き換える:

```html
  <style>
    :root {
      --bg: #fbf4ec;
      --card: #ffffff;
      --ink: #4a3b2e;
      --ink-soft: #9b8a78;
      --ink-faint: #a89684;
      --store: #9a6b3f;
      --accent: #ef6c47;
      --accent-strong: #c2410c;
      --notify-bg: #fff3e8;
      --chip-bg: #fde7da;
      --input-border: #ecd9c5;
      --placeholder: #b08968;
      --shadow-card: 0 2px 8px rgba(154,107,63,.10);
      --shadow-hero: 0 6px 16px rgba(239,108,71,.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--ink);
      font-family: 'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',system-ui,sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 480px; margin: 0 auto; padding: 18px 16px 28px; }

    .store-name { text-align: center; font-size: 15px; font-weight: 700; color: var(--store); margin: 4px 0 12px; }

    .hero {
      background: linear-gradient(160deg, #ff8a5b, var(--accent));
      border-radius: 22px; padding: 26px 18px; text-align: center; color: #fff;
      box-shadow: var(--shadow-hero); margin-bottom: 14px;
    }
    .hero-label { font-size: 13px; opacity: .92; letter-spacing: .02em; }
    .hero-number { font-size: 64px; font-weight: 800; line-height: 1.05; margin-top: 6px; }

    .card {
      background: var(--card); border-radius: 16px; padding: 16px;
      box-shadow: var(--shadow-card); margin-bottom: 12px;
    }

    .my-row { display: flex; gap: 10px; align-items: center; }
    .my-row input {
      flex: 1; font-size: 16px; padding: 12px; border: 1.5px solid var(--input-border);
      border-radius: 12px; background: #fff; color: var(--ink); min-width: 0;
    }
    .my-row input::placeholder { color: var(--placeholder); }
    .my-row button {
      font-size: 15px; font-weight: 700; padding: 12px 18px; border: none;
      border-radius: 12px; background: var(--accent); color: #fff;
    }
    .my-result { margin-top: 12px; font-size: 16px; text-align: center; min-height: 22px; color: var(--ink); }
    .my-result.err { color: var(--accent-strong); }

    .notify-card { background: var(--notify-bg); }
    .notify-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .notify-row button {
      font-size: 15px; font-weight: 700; padding: 11px 18px; border: none;
      border-radius: 12px; background: var(--accent); color: #fff;
    }
    .notify-status { font-size: 14px; font-weight: 700; color: var(--accent-strong); }

    .waiting-count { text-align: center; font-size: 16px; color: var(--ink); }
    .waiting-count .n { font-size: 22px; font-weight: 800; color: var(--accent); }

    .recent-label { font-size: 12px; color: var(--ink-soft); margin-bottom: 8px; }
    .chips { display: flex; gap: 7px; flex-wrap: wrap; }
    .chip {
      background: var(--chip-bg); color: var(--accent-strong); border-radius: 999px;
      padding: 4px 13px; font-size: 15px; font-weight: 700;
    }

    .meta { font-size: 12px; color: var(--ink-faint); text-align: center; margin-top: 6px; }
    .meta.err { color: var(--accent-strong); }
    .keep-open { font-size: 12px; color: var(--ink-faint); text-align: center; margin-top: 10px; }

    .overlay { position: fixed; inset: 0; background: rgba(40,25,15,.55); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 24px; }
    .overlay-box { background: #fff; border-radius: 22px; padding: 34px 26px; text-align: center; max-width: 92%; box-shadow: 0 18px 50px rgba(0,0,0,.3); }
    .overlay-title { font-size: 26px; font-weight: 800; color: var(--accent); }
    .overlay-box.turn .overlay-title { color: var(--accent-strong); }
    .overlay-sub { font-size: 52px; font-weight: 800; color: var(--ink); margin: 14px 0 22px; }
    .overlay-close { font-size: 17px; font-weight: 700; padding: 13px 34px; border: none; border-radius: 14px; background: var(--accent); color: #fff; }
  </style>
```

- [ ] **Step 3: `<body>` の `<div class="wrap">...</div>` を置換**

現状の `<div class="wrap">` 開始から、それに対応する `</div>`（`<script src="status.js"></script>` の直前）までを、以下で完全に置き換える。要素IDはすべて維持していること:

```html
<div class="wrap">
  <div id="store-name" class="store-name"></div>

  <div class="hero">
    <div class="hero-label">ただいまお呼び出し中</div>
    <div id="calling-number" class="hero-number">—</div>
  </div>

  <div class="card">
    <div class="my-row">
      <input id="my-number" type="number" inputmode="numeric" placeholder="あなたの番号">
      <button id="my-check">確認</button>
    </div>
    <div id="my-result" class="my-result"></div>
  </div>

  <div class="card notify-card">
    <div class="notify-row">
      <button id="notify-btn">🔔 通知を受け取る</button>
      <span id="notify-status" class="notify-status"></span>
    </div>
  </div>

  <div class="card">
    <div id="waiting-count" class="waiting-count">—</div>
  </div>

  <div class="card">
    <div class="recent-label">直近の呼び出し</div>
    <div id="recent-called" class="chips">—</div>
  </div>

  <div id="meta" class="meta"></div>
  <div class="keep-open">※通知のため、この画面を開いたままにしてください</div>
</div>
```

- [ ] **Step 4: `innerHTML` を使っていないことを確認**

Run: `cd /Users/hasemasahiro/Desktop/seiriken-app && grep -c innerHTML status.html`
Expected: `0`（grep は0件時に終了コード1を返すので、`&&` で他コマンドを連結しないこと）

- [ ] **Step 5: リグレッションテストが引き続き緑であることを確認**

Run: 上記「テスト実行コマンド」
Expected: `PASS=30 FAIL=0`（status.js は未変更なので不変のはず）

- [ ] **Step 6: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "$(cat <<'EOF'
style: status.html を温かみ・テラコッタ基調にリデザイン（CSS/マークアップ）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 描画JSの更新（直近呼び出しチップ・お待ち数字強調・オーバーレイ段階クラス）

**Files:**
- Modify: `status.html`（`<script src="status.js"></script>` の後の `<script>` 内 `renderRow` 関数と `showOverlay` 関数）

このタスクは表示方法のみ変更。表示する**データ**（何を出すか）は不変。すべて `createElement`/`textContent`/`createTextNode`/`appendChild` で行い `innerHTML` は使わない。

- [ ] **Step 1: `renderRow` 内の「待ち組数」描画を、数字を強調する形に変更**

`renderRow` 内の現在の待ち組数の行:

```js
    // 待ち組数
    setText('waiting-count', '現在 ' + (row.waiting_count || 0) + '組お待ち');
```

を、以下で置き換える:

```js
    // 待ち組数（数字だけ強調）
    const waitEl = document.getElementById('waiting-count');
    while (waitEl.firstChild) waitEl.removeChild(waitEl.firstChild);
    const waitN = document.createElement('span');
    waitN.className = 'n';
    waitN.textContent = (row.waiting_count || 0);
    waitEl.appendChild(document.createTextNode('現在 '));
    waitEl.appendChild(waitN);
    waitEl.appendChild(document.createTextNode(' 組お待ち'));
```

- [ ] **Step 2: `renderRow` 内の「直近の呼び出し」描画を、チップ表示に変更**

`renderRow` 内の現在の直近呼び出しの行:

```js
    // 直近の呼び出し
    const recent = Array.isArray(row.recent_called) ? row.recent_called : [];
    setText('recent-called', recent.length ? recent.join('・') : '—');
```

を、以下で置き換える:

```js
    // 直近の呼び出し（チップ表示）
    const recent = Array.isArray(row.recent_called) ? row.recent_called : [];
    const recentEl = document.getElementById('recent-called');
    while (recentEl.firstChild) recentEl.removeChild(recentEl.firstChild);
    if (recent.length) {
      for (let i = 0; i < recent.length; i++) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = recent[i];
        recentEl.appendChild(chip);
      }
    } else {
      recentEl.textContent = '—';
    }
```

- [ ] **Step 3: `showOverlay` で box に段階クラス（turn/soon）を付与**

`showOverlay` 関数内の現在のボックス生成:

```js
    const box = document.createElement('div');
    box.className = 'overlay-box';
```

を、以下で置き換える:

```js
    const box = document.createElement('div');
    box.className = 'overlay-box ' + (stage === 'turn' ? 'turn' : 'soon');
```

- [ ] **Step 4: `innerHTML` を使っていないことを確認**

Run: `cd /Users/hasemasahiro/Desktop/seiriken-app && grep -c innerHTML status.html`
Expected: `0`

- [ ] **Step 5: リグレッションテストが引き続き緑であることを確認**

Run: 上記「テスト実行コマンド」
Expected: `PASS=30 FAIL=0`

- [ ] **Step 6: 構文の健全性を確認（Nodeでパースのみ・実行しない）**

`vm.Script` はコードをコンパイル（構文チェック）するが実行はしない。インラインスクリプトがJSとして妥当かを確認する:

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && node -e '
const fs=require("fs");const vm=require("vm");
const html=fs.readFileSync("status.html","utf8");
const m=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code=m.map(x=>x[1]).join("\n;\n");
new vm.Script(code); console.log("syntax OK");'
```
Expected: `syntax OK`

- [ ] **Step 7: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "$(cat <<'EOF'
style: 直近呼び出しをチップ表示・待ち数字を強調・通知オーバーレイに段階色

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 手動検証チェックリスト（実装後・スマホ実機）

ローカル（`file://` でも可）または公開URLで `status.html` を開き、以下を目視確認する:

- [ ] クリーム地に白カードが浮き、テラコッタのヒーローカードに番号が大きく表示される。
- [ ] 番号未確定時、ヒーロー内に「準備中です」が（赤ではなく）白文字で表示される。
- [ ] 「あなたの番号」入力＋「確認」が押せ、結果テキストが下に出る。レイアウトが崩れない。
- [ ] 通知ボタンが淡いオレンジのカードに乗り、登録すると「🔔 通知ON（◯番）」＋「解除」になる。
- [ ] 「現在 N 組お待ち」の N がアクセント色で大きい。
- [ ] 直近の呼び出しが丸いチップで横並び表示される。空なら「—」。
- [ ] 店アプリで番号を進め、「まもなくお呼び出しです」(soon) と「あなたの番です！」(turn) のオーバーレイがテラコッタ基調で表示され、turn のタイトル色が soon より濃い。
- [ ] 通信を切ると「再接続中…」がメタに控えめな警告色で出る。
- [ ] iPhone（Safari）と Android（Chrome）の両方でフォント・余白が自然。
