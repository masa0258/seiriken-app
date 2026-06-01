# お客さん「あなたの番です」通知 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客が `status.html` を開いて整理券番号を登録しておくと、店がその番号に近づいた／呼び出した瞬間に、音・バイブ・全画面表示で「もうすぐ」「あなたの番です」を各1回知らせる。

**Architecture:** 判定は `status.js` の純粋関数 `evaluateNotify` に追加（vmハーネスでテスト）、音・バイブ・全画面表示などの副作用は `status.html` に追加する。Supabase・店アプリ（`index.html`）・送信処理は一切変更しない。個人情報は扱わず、整理券番号のみ localStorage に保持する。

**Tech Stack:** バニラ JS（ビルド・ライブラリなし）、Web Audio API（ビープ生成）、`navigator.vibrate`、localStorage、既存の5秒ポーリング。DOM操作は `textContent`/`createElement`/`appendChild` のみ（`innerHTML` 禁止）。

---

## 前提知識（実装者向け）

- このリポジトリは `/Users/hasemasahiro/Desktop/seiriken-app`。bash は毎回 `cd /Users/hasemasahiro/Desktop/seiriken-app &&` を先頭に付ける（作業ディレクトリがリセットされるため）。
- git コミットは識別子をインラインで指定する: `git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit ...`。フックのスキップ（`--no-verify`）や署名無効化はしない。
- **`innerHTML` は使用禁止**（セキュリティフックでブロックされる）。DOM は `textContent`/`createElement`/`appendChild` で組む。
- ブラウザ自動化は使えない。純粋関数は下記の Node `vm` ハーネスで検証し、音・バイブ・表示・iPhone挙動は手動検証扱い。
- `status.js` には既に `buildPublicStatus`・`computeAhead`・`estimateWaitMsForNumber` がある。`evaluateNotify` は `computeAhead` を内部で使う。
- `status.html` は既に5秒ごとに `poll()` で Supabase の行を取得し、`renderRow(row)` で描画している。`row` は `{ id, calling_number, recent_called, waiting_numbers, waiting_count, last_issued, avg_serve_ms, updated_at }`。

### 共通テストハーネス（status.js の純粋関数を Node で検証）

`status.test.html` の `<script>` を `queue.js`＋`status.js` と一緒に Node の `vm` で走らせ、PASS/FAIL を数える。`document` はスタブする。

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

注意: `status.test.html` には複数の `<script>` があるが、テストは最後の `<script>`（テスト本体）に書く。上のハーネスは最初の `<script>` にマッチするが、`status.test.html` のテスト本体は `<script src=...>`（中身なし）の後の `<script>...</script>` に入っているため、正規表現 `/<script>([\s\S]*?)<\/script>/` は最初の「中身あり」スクリプト（=テスト本体。`src` 付きは `<script src=...>` で `>` の前に属性があるため `<script>` と完全一致しない）にマッチする。つまりテスト本体が実行される。実行して `PASS=n FAIL=0` を確認すること。

---

## ファイル構成

| ファイル | 変更 | 責務 |
|---|---|---|
| `status.js` | 修正（関数追加） | `evaluateNotify` 純粋関数を追加（鳴らすべき段階を判定） |
| `status.test.html` | 修正（テスト追加） | `evaluateNotify` のテストを追加 |
| `status.html` | 修正（UI＋副作用追加） | 通知登録UI・音・バイブ・全画面表示・poll へのフック |

---

## Task 1: `evaluateNotify` 純粋関数とテスト

**Files:**
- Modify: `status.js`（末尾に関数追加）
- Test: `status.test.html`（テスト本体スクリプトの末尾に追加）

`row`（取得した行）・`myNumber`・`threshold`・`fired`（鳴らし済みラッチ）から、今鳴らすべき段階（`'soon'`/`'turn'`/`null`）と更新後の `fired` を返す純粋関数。`computeAhead` を内部利用する。

- [ ] **Step 1: 失敗するテストを書く**

`status.test.html` の最後の `<script>` 内、既存の非破壊チェックの IIFE（`check('computeAhead は引数配列を破壊しない', ...)` を含むブロック）の **後ろ**、`</script>` の直前に以下を追加する:

```javascript
  (function () {
    const empty = { soon: false, turn: false };
    // calling_number=38, recent=[38,37,36], waiting=[40,42,43]
    const row = { calling_number: 38, recent_called: [38, 37, 36], waiting_numbers: [40, 42, 43] };

    // 43番は ahead=2 > threshold(1)、呼ばれてもいない → null
    const a = evaluateNotify(row, 43, 1, empty);
    check('evaluateNotify: ahead>閾値かつ未呼出は stage:null', a.stage === null);

    // 42番は ahead=1 <= threshold(1)、soon未通知 → soon
    const b = evaluateNotify(row, 42, 1, empty);
    check('evaluateNotify: ahead<=閾値で soon を返す', b.stage === 'soon' && b.fired.soon === true && b.fired.turn === false);

    // 42番、soon通知済み → null
    const c = evaluateNotify(row, 42, 1, { soon: true, turn: false });
    check('evaluateNotify: soon通知済みなら再通知しない', c.stage === null);

    // 38番は calling_number と一致 → turn
    const d = evaluateNotify(row, 38, 1, empty);
    check('evaluateNotify: 呼出中番号は turn を返す', d.stage === 'turn' && d.fired.turn === true);
    check('evaluateNotify: turn通知時は soon ラッチも立てる', d.fired.soon === true);

    // 38番、turn通知済み → null
    const e = evaluateNotify(row, 38, 1, { soon: true, turn: true });
    check('evaluateNotify: turn通知済みなら再通知しない', e.stage === null);

    // recent_called に含まれる番号（waitingにもcallingにも無い）→ turn
    const row2 = { calling_number: 39, recent_called: [39, 38], waiting_numbers: [40, 42, 43] };
    const f = evaluateNotify(row2, 38, 1, empty);
    check('evaluateNotify: recent_called に含まれる番号は turn', f.stage === 'turn');

    // 待機にも呼出にも該当しない番号 → null
    const g = evaluateNotify(row, 99, 1, empty);
    check('evaluateNotify: 待機にも呼出にも無い番号は null', g.stage === null);

    // 非破壊: row と fired を壊さない
    const rowBefore = JSON.stringify(row);
    const firedArg = { soon: false, turn: false };
    const firedBefore = JSON.stringify(firedArg);
    evaluateNotify(row, 42, 1, firedArg);
    check('evaluateNotify: row を破壊しない', JSON.stringify(row) === rowBefore);
    check('evaluateNotify: fired 引数を破壊しない', JSON.stringify(firedArg) === firedBefore);
  })();
```

- [ ] **Step 2: テストを実行して失敗を確認**

前掲の「共通テストハーネス」コマンドを実行する。
Expected: `evaluateNotify is not defined` 系のエラー、または `FAIL` が出る（`evaluateNotify` 未実装のため）。

- [ ] **Step 3: 最小実装を書く**

`status.js` の末尾（`estimateWaitMsForNumber` 関数の後ろ）に追加する:

```javascript
// 通知判定: row と自分の番号・閾値・鳴らし済みラッチ fired から、
// 今鳴らすべき段階 ('soon'|'turn'|null) と更新後の fired を返す。純粋・非破壊。
function evaluateNotify(row, myNumber, threshold, fired) {
  const safe = {
    soon: !!(fired && fired.soon),
    turn: !!(fired && fired.turn),
  };
  const r = row || {};
  const waiting = Array.isArray(r.waiting_numbers) ? r.waiting_numbers : [];
  const recent = Array.isArray(r.recent_called) ? r.recent_called : [];
  const ahead = computeAhead(waiting, myNumber);
  const isCalled = (r.calling_number === myNumber) || (recent.indexOf(myNumber) !== -1);

  if (isCalled && !safe.turn) {
    return { stage: 'turn', fired: { soon: true, turn: true } };
  }
  if (ahead.found && ahead.ahead <= threshold && !safe.soon) {
    return { stage: 'soon', fired: { soon: true, turn: safe.turn } };
  }
  return { stage: null, fired: { soon: safe.soon, turn: safe.turn } };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

前掲の「共通テストハーネス」コマンドを実行する。
Expected: `PASS=30 FAIL=0`（既存20＋今回10）。少なくとも `FAIL=0` であること。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.js status.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: evaluateNotify（呼び出し通知の段階判定）を追加"
```

---

## Task 2: `status.html` に通知UI・音・バイブ・全画面表示を追加

**Files:**
- Modify: `status.html`

整理券番号を登録する「🔔 通知を受け取る」ボタン、Web Audio によるビープ、`navigator.vibrate`、全画面オーバーレイ、localStorage 永続化を追加し、既存 `poll()` から `evaluateNotify` を呼んで各1回通知する。ブラウザ依存のため手動検証。

このタスクは1ファイル（`status.html`）への複数箇所の編集。現在の `status.html` の構造（参考）:
- `<style>` 内に各クラスのCSS。
- `<body>` に `.wrap` > 複数の `.card`。「あなたの番号」入力は2つ目の `.card`（`my-row` と `my-result`）。
- 末尾に `<script src="status.js"></script>` と本体 `<script>`。本体スクリプトの定数は `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`ROW_ID`/`POLL_MS`、状態は `let lastRow = null;`、関数 `setText`/`fmtMinutes`/`renderRow`/`renderMyResult`/`poll`、最後にイベント登録と `poll(); setInterval(poll, POLL_MS);`。

- [ ] **Step 1: CSS を追加**

`status.html` の `<style>` 内、`.err { color: #c0392b; }` の **後ろ**に追加する:

```css
    .notify-row { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
    .notify-row button { font-size: 16px; padding: 8px 16px; }
    .notify-status { font-size: 14px; color: #2e7d32; }
    .keep-open { font-size: 12px; color: #888; text-align: center; margin-top: 8px; }
    .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.75); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .overlay-box { background: #fff; border-radius: 16px; padding: 32px 24px; text-align: center; max-width: 90%; }
    .overlay-title { font-size: 28px; font-weight: bold; color: #c0392b; }
    .overlay-sub { font-size: 48px; font-weight: bold; margin: 12px 0 20px; }
    .overlay-close { font-size: 18px; padding: 12px 32px; }
```

- [ ] **Step 2: 通知UIのHTMLを追加**

`status.html` の `<body>` 内、「あなたの番号」入力がある2つ目の `.card`（`<div id="my-result" class="my-result"></div>` を含む）の中で、`<div id="my-result" class="my-result"></div>` の **直後**に追加する:

```html
    <div class="notify-row">
      <button id="notify-btn">🔔 通知を受け取る</button>
      <span id="notify-status" class="notify-status"></span>
    </div>
```

さらに、`<div id="meta" class="meta"></div>` の **直後**（`.wrap` を閉じる `</div>` の手前）に追加する:

```html
  <div class="keep-open">※通知のため、この画面を開いたままにしてください</div>
```

- [ ] **Step 3: 通知の状態・定数・localStorage を追加**

本体 `<script>` 内、`const POLL_MS = 5000;` の **後ろ**に追加する:

```javascript
  const THRESHOLD = 1;                 // あと何組以下で「もうすぐ」
  const NOTIFY_KEY = 'seiriken-notify';
  let notifyNumber = null;             // 通知対象の整理券番号（未登録は null）
  let notifyFired = { soon: false, turn: false };
  let audioCtx = null;

  function loadNotify() {
    try {
      const raw = localStorage.getItem(NOTIFY_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj.number === 'number') {
        notifyNumber = obj.number;
        notifyFired = { soon: !!(obj.fired && obj.fired.soon), turn: !!(obj.fired && obj.fired.turn) };
      }
    } catch (e) { /* 壊れていたら無視 */ }
  }

  function saveNotify() {
    if (notifyNumber === null) { localStorage.removeItem(NOTIFY_KEY); return; }
    localStorage.setItem(NOTIFY_KEY, JSON.stringify({ number: notifyNumber, fired: notifyFired }));
  }
```

- [ ] **Step 4: 音・バイブ・全画面表示の関数を追加**

本体 `<script>` 内、Step 3 で追加したコードの **後ろ**に追加する:

```javascript
  function ensureAudio() {
    if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { audioCtx = new AC(); if (audioCtx.state === 'suspended') audioCtx.resume(); }
    } catch (e) { audioCtx = null; }
  }

  function beep(times) {
    if (!audioCtx) return;
    let t = audioCtx.currentTime;
    for (let i = 0; i < times; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.25);
      t += 0.4;
    }
  }

  function showOverlay(stage) {
    const old = document.getElementById('overlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay';

    const box = document.createElement('div');
    box.className = 'overlay-box';

    const title = document.createElement('div');
    title.className = 'overlay-title';
    title.textContent = (stage === 'turn') ? 'あなたの番です！' : 'まもなくお呼び出しです';

    const sub = document.createElement('div');
    sub.className = 'overlay-sub';
    sub.textContent = notifyNumber + '番';

    const btn = document.createElement('button');
    btn.className = 'overlay-close';
    btn.textContent = '閉じる';
    btn.addEventListener('click', function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });

    box.appendChild(title);
    box.appendChild(sub);
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function fireAlert(stage) {
    beep(stage === 'turn' ? 3 : 1);
    if (navigator.vibrate) {
      navigator.vibrate(stage === 'turn' ? [400, 150, 400] : [200]);
    }
    showOverlay(stage);
  }
```

- [ ] **Step 5: 登録UIの配線と poll フックを追加**

本体 `<script>` 内、Step 4 で追加したコードの **後ろ**に追加する:

```javascript
  function refreshNotifyStatus() {
    const status = document.getElementById('notify-status');
    const btn = document.getElementById('notify-btn');
    if (notifyNumber === null) {
      status.textContent = '';
      btn.textContent = '🔔 通知を受け取る';
    } else {
      status.textContent = '🔔 通知ON（' + notifyNumber + '番）';
      btn.textContent = '解除';
    }
  }

  function maybeNotify(row) {
    if (notifyNumber === null) return;
    const res = evaluateNotify(row, notifyNumber, THRESHOLD, notifyFired);
    if (res.stage) {
      notifyFired = res.fired;
      saveNotify();
      fireAlert(res.stage);
    }
  }

  document.getElementById('notify-btn').addEventListener('click', function () {
    if (notifyNumber !== null) {        // 解除
      notifyNumber = null;
      notifyFired = { soon: false, turn: false };
      saveNotify();
      refreshNotifyStatus();
      return;
    }
    const raw = document.getElementById('my-number').value;
    const n = parseInt(raw, 10);
    if (raw === '' || isNaN(n)) {
      document.getElementById('notify-status').textContent = '番号を入力してください';
      return;
    }
    ensureAudio();                      // ユーザー操作で音を解錠
    notifyNumber = n;
    notifyFired = { soon: false, turn: false };
    saveNotify();
    refreshNotifyStatus();
  });
```

- [ ] **Step 6: poll() に通知判定を差し込む & 初期化**

本体 `<script>` 内の `poll` 関数で、`lastRow = rows[0];` と `renderRow(lastRow);` の行を探し、`renderRow(lastRow);` の **直後**に1行追加する:

```javascript
        lastRow = rows[0];
        renderRow(lastRow);
        maybeNotify(lastRow);
```

さらに、本体 `<script>` の末尾、`poll();` の行の **直前**に2行追加する:

```javascript
  loadNotify();
  refreshNotifyStatus();
  poll();
  setInterval(poll, POLL_MS);
```

- [ ] **Step 7: innerHTML 不使用と構文を確認**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && grep -c "innerHTML" status.html; node --check status.html 2>&1 | head -1 || echo "（node --check はHTML非対応のため無視可）"
```
Expected: `grep -c "innerHTML"` の出力が `0`。（`node --check` はHTML全体には使えないので、エラーが出ても無視してよい。重要なのは innerHTML が 0 件であること。）

- [ ] **Step 8: ブラウザで手動確認**

`status.html` をブラウザで開き、以下を確認する（Supabase 接続済みの公開URLが望ましいが、レイアウト確認はローカルでも可）:
- 「🔔 通知を受け取る」ボタンと注意書きが表示される。
- 番号を入れずにボタンを押すと「番号を入力してください」と出る。
- 番号を入れてボタンを押すと「🔔 通知ON（◯番）」に変わり、ボタンが「解除」になる。
- 「解除」を押すと未登録表示に戻る。
- ページを再読み込みしても通知ONが保持される。
実データでの「もうすぐ」「あなたの番です」発火は Task 完了後のデプロイ済みURL＋店アプリ操作で確認する（手動）。

- [ ] **Step 9: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: 客ページに『あなたの番です』通知（音・バイブ・全画面）を追加"
```

---

## 完了条件

- `status.test.html` の全テストが `FAIL=0`（`evaluateNotify` の10件を含む）。
- `status.html` に通知登録UI・音・バイブ・全画面表示があり、`innerHTML` を使っていない。
- 登録番号が localStorage に保持され、「もうすぐ」「あなたの番です」がそれぞれ1回だけ発火する（`evaluateNotify` のラッチで担保）。
- Supabase・`index.html`・送信処理は無変更（回帰なし）。
- 個人情報を一切扱わない（番号のみ）。

## 手動検証（デプロイ後）

1. `status.html` の変更を push（GitHub Pages 反映）。
2. スマホで公開URLの `status.html` を開く。
3. 番号を入力し「🔔 通知を受け取る」をタップ（音解錠）。
4. 店アプリでその番号の手前まで進める → あと1組で「まもなく」通知。
5. その番号を呼び出す → 「あなたの番です！」通知（音・バイブ・全画面）。
6. 再読み込みしても二重に鳴らず、登録が保持されること。「解除」で停止できること。
