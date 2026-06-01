# 整理券アプリ（順番待ち発券機）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブラウザで開くだけで動く、順番待ち整理券システムのMVP（単体HTMLファイル）を作る。

**Architecture:** 1つの `index.html` に「受付・呼び出し管理・呼び出し表示」の3画面を持たせ、上部タブで切り替える。状態は localStorage に保存し、`storage` イベントで別タブと連動する。ロジックはテストしやすいよう純粋関数に分け、`queue.test.html`（ブラウザで開く簡易テストランナー）で検証する。

**Tech Stack:** HTML / CSS / Vanilla JavaScript / localStorage。ビルドツール・サーバー・外部ライブラリなし。DOM更新は `textContent` と DOM API のみ（`innerHTML` は使わない）。

---

## ファイル構成

- Create: `index.html` — アプリ本体（3画面 + UI + 状態読み書き）
- Create: `queue.js` — 状態を操作する純粋関数群（発券・呼び出し・リセット）。`index.html` とテストの両方から読み込む。
- Create: `queue.test.html` — `queue.js` の純粋関数をブラウザで実行する簡易テストランナー（結果をページに緑/赤で表示）。

`queue.js` はDOMやlocalStorageに触れず、状態オブジェクトを受け取って新しい状態を返すだけにする。これで純粋関数として単体検証できる。`index.html` 側がlocalStorageの読み書きと画面描画を担当する。

---

## 状態モデル

```js
// state の形
{ lastIssued: 0, nowCalling: 0, waiting: [] }
```

- 発券: `lastIssued += 1`、新番号を `waiting` 末尾に追加。
- 呼び出し: `waiting` 先頭を取り出し `nowCalling` に設定。空なら変化なし。
- リセット: `{ lastIssued: 0, nowCalling: 0, waiting: [] }` を返す。

---

### Task 1: 純粋関数 `queue.js` と初期状態

**Files:**
- Create: `queue.js`
- Test: `queue.test.html`

- [ ] **Step 1: テストランナーと最初の失敗するテストを書く**

Create `queue.test.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>queue.js tests</title></head>
<body>
<h1>queue.js テスト結果</h1>
<ul id="results"></ul>
<script src="queue.js"></script>
<script>
  const results = document.getElementById('results');
  function check(name, cond) {
    const li = document.createElement('li');
    li.textContent = (cond ? 'PASS: ' : 'FAIL: ') + name;
    li.style.color = cond ? 'green' : 'red';
    results.appendChild(li);
  }

  // Task 1
  check('initialState は 0,0,[]', (() => {
    const s = initialState();
    return s.lastIssued === 0 && s.nowCalling === 0 && Array.isArray(s.waiting) && s.waiting.length === 0;
  })());
</script>
</body>
</html>
```

- [ ] **Step 2: テストを開いて失敗を確認**

`queue.test.html` をブラウザで開く。
Expected: 「FAIL: initialState は 0,0,[]」(または `initialState is not defined` のエラー)。

- [ ] **Step 3: 最小実装**

Create `queue.js`:

```js
function initialState() {
  return { lastIssued: 0, nowCalling: 0, waiting: [] };
}
```

- [ ] **Step 4: テスト再実行**

`queue.test.html` をブラウザで再読み込み。
Expected: 「PASS: initialState は 0,0,[]」が緑で表示。

- [ ] **Step 5: コミット**

```bash
git add queue.js queue.test.html
git commit -m "feat: add queue initialState"
```

---

### Task 2: 発券 `issueTicket`

**Files:**
- Modify: `queue.js`
- Test: `queue.test.html`

- [ ] **Step 1: 失敗するテストを追加**

`queue.test.html` の `<script>` 内、Task 1 の check の下に追加:

```js
  // Task 2
  check('issueTicket は番号を1つ増やし待ちに追加', (() => {
    const s1 = issueTicket(initialState());
    const s2 = issueTicket(s1);
    return s2.lastIssued === 2 &&
           s2.waiting.length === 2 &&
           s2.waiting[0] === 1 && s2.waiting[1] === 2;
  })());
  check('issueTicket は元の state を変更しない', (() => {
    const s0 = initialState();
    issueTicket(s0);
    return s0.lastIssued === 0 && s0.waiting.length === 0;
  })());
```

- [ ] **Step 2: テストを開いて失敗を確認**

`queue.test.html` を再読み込み。
Expected: Task 2 の2件が FAIL（`issueTicket is not defined`）。

- [ ] **Step 3: 最小実装**

`queue.js` に追加:

```js
function issueTicket(state) {
  const next = state.lastIssued + 1;
  return {
    lastIssued: next,
    nowCalling: state.nowCalling,
    waiting: [...state.waiting, next],
  };
}
```

- [ ] **Step 4: テスト再実行**

`queue.test.html` を再読み込み。
Expected: Task 2 の2件が PASS。

- [ ] **Step 5: コミット**

```bash
git add queue.js queue.test.html
git commit -m "feat: add issueTicket"
```

---

### Task 3: 呼び出し `callNext`

**Files:**
- Modify: `queue.js`
- Test: `queue.test.html`

- [ ] **Step 1: 失敗するテストを追加**

`queue.test.html` に追加:

```js
  // Task 3
  check('callNext は待ち先頭を呼び出し番号にする', (() => {
    let s = issueTicket(issueTicket(initialState())); // waiting [1,2]
    s = callNext(s);
    return s.nowCalling === 1 && s.waiting.length === 1 && s.waiting[0] === 2;
  })());
  check('callNext は待ちが空なら変化しない', (() => {
    const s0 = { lastIssued: 5, nowCalling: 3, waiting: [] };
    const s1 = callNext(s0);
    return s1.nowCalling === 3 && s1.waiting.length === 0 && s1.lastIssued === 5;
  })());
```

- [ ] **Step 2: テストを開いて失敗を確認**

Expected: Task 3 の2件が FAIL（`callNext is not defined`）。

- [ ] **Step 3: 最小実装**

`queue.js` に追加:

```js
function callNext(state) {
  if (state.waiting.length === 0) {
    return { lastIssued: state.lastIssued, nowCalling: state.nowCalling, waiting: [...state.waiting] };
  }
  const [first, ...rest] = state.waiting;
  return { lastIssued: state.lastIssued, nowCalling: first, waiting: rest };
}
```

- [ ] **Step 4: テスト再実行**

Expected: Task 3 の2件が PASS。

- [ ] **Step 5: コミット**

```bash
git add queue.js queue.test.html
git commit -m "feat: add callNext"
```

---

### Task 4: リセット `resetState`

**Files:**
- Modify: `queue.js`
- Test: `queue.test.html`

- [ ] **Step 1: 失敗するテストを追加**

`queue.test.html` に追加:

```js
  // Task 4
  check('resetState は初期状態を返す', (() => {
    const s = resetState({ lastIssued: 9, nowCalling: 4, waiting: [5,6] });
    return s.lastIssued === 0 && s.nowCalling === 0 && s.waiting.length === 0;
  })());
```

- [ ] **Step 2: テストを開いて失敗を確認**

Expected: Task 4 が FAIL（`resetState is not defined`）。

- [ ] **Step 3: 最小実装**

`queue.js` に追加:

```js
function resetState() {
  return initialState();
}
```

- [ ] **Step 4: テスト再実行**

Expected: Task 4 が PASS。全テスト緑。

- [ ] **Step 5: コミット**

```bash
git add queue.js queue.test.html
git commit -m "feat: add resetState"
```

---

### Task 5: `index.html` の骨組みと localStorage 連携

**Files:**
- Create: `index.html`

- [ ] **Step 1: index.html を作成**

`queue.js` を読み込み、状態の永続化と3画面のタブ切り替え土台を作る。DOM更新は `textContent` と DOM API のみ使用する。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>整理券システム</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; text-align: center; }
  nav { display: flex; }
  nav button { flex: 1; padding: 12px; font-size: 16px; border: none; background: #eee; cursor: pointer; }
  nav button.active { background: #2563eb; color: #fff; }
  .screen { display: none; padding: 24px; }
  .screen.active { display: block; }
  .big-btn { font-size: 28px; padding: 24px 48px; margin: 24px; border: none; border-radius: 12px; background: #2563eb; color: #fff; cursor: pointer; }
  .number { font-size: 96px; font-weight: bold; color: #2563eb; }
  .display-number { font-size: 30vh; font-weight: bold; color: #2563eb; line-height: 1; }
  ul.waiting { list-style: none; padding: 0; font-size: 24px; }
  .secondary { font-size: 16px; padding: 10px 20px; margin: 8px; border: 1px solid #888; border-radius: 8px; background: #fff; cursor: pointer; }
</style>
</head>
<body>
<nav>
  <button data-screen="reception" class="active">受付</button>
  <button data-screen="admin">呼び出し管理</button>
  <button data-screen="display">呼び出し表示</button>
</nav>

<section id="reception" class="screen active">
  <h2>整理券受付</h2>
  <button id="issue-btn" class="big-btn">整理券を取る</button>
  <p id="issued-label"></p>
  <p class="number" id="issued-number"></p>
  <p>現在の待ち人数: <span id="waiting-count">0</span> 人</p>
</section>

<section id="admin" class="screen">
  <h2>呼び出し管理</h2>
  <p>現在の呼び出し番号: <span id="admin-now" class="number">---</span></p>
  <button id="call-btn" class="big-btn">次を呼ぶ</button>
  <p id="admin-msg"></p>
  <h3>待ち番号</h3>
  <ul id="waiting-list" class="waiting"></ul>
  <button id="reset-btn" class="secondary">リセット</button>
</section>

<section id="display" class="screen">
  <p>ただいまの呼び出し番号</p>
  <div id="display-now" class="display-number">---</div>
</section>

<script src="queue.js"></script>
<script>
  const STORAGE_KEY = 'seiriken-state';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return initialState();
      const s = JSON.parse(raw);
      return { lastIssued: s.lastIssued|0, nowCalling: s.nowCalling|0, waiting: Array.isArray(s.waiting) ? s.waiting : [] };
    } catch (e) {
      return initialState();
    }
  }
  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();

  function render() {
    document.getElementById('waiting-count').textContent = state.waiting.length;
    document.getElementById('admin-now').textContent = state.nowCalling === 0 ? '---' : state.nowCalling;
    document.getElementById('display-now').textContent = state.nowCalling === 0 ? '---' : state.nowCalling;
    const list = document.getElementById('waiting-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    state.waiting.forEach(n => {
      const li = document.createElement('li');
      li.textContent = n;
      list.appendChild(li);
    });
  }

  // タブ切り替え
  document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.screen).classList.add('active');
    });
  });

  render();
</script>
</body>
</html>
```

- [ ] **Step 2: ブラウザで開いて確認**

`index.html` をブラウザで開く。
Expected: 上部に3つのタブ。タブを押すと画面が切り替わる。待ち人数 0、呼び出し番号 ---。

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "feat: add index.html skeleton with tabs and storage"
```

---

### Task 6: 発券・呼び出し・リセットのボタン配線と別タブ連動

**Files:**
- Modify: `index.html`

- [ ] **Step 1: イベント配線を追加**

`index.html` の `render();` の直前に、以下のハンドラを追加する。番号表示は専用の要素へ `textContent` で書き込む:

```js
  function update(newState) {
    state = newState;
    saveState(state);
    render();
  }

  document.getElementById('issue-btn').addEventListener('click', () => {
    update(issueTicket(state));
    document.getElementById('issued-label').textContent = 'あなたの番号は';
    document.getElementById('issued-number').textContent = state.lastIssued;
  });

  document.getElementById('call-btn').addEventListener('click', () => {
    if (state.waiting.length === 0) {
      document.getElementById('admin-msg').textContent = '待っている番号はありません';
      return;
    }
    document.getElementById('admin-msg').textContent = '';
    update(callNext(state));
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('番号をすべてリセットします。よろしいですか？')) return;
    document.getElementById('issued-label').textContent = '';
    document.getElementById('issued-number').textContent = '';
    document.getElementById('admin-msg').textContent = '';
    update(resetState());
  });

  // 別タブ連動
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      state = loadState();
      render();
    }
  });
```

- [ ] **Step 2: ブラウザで動作確認（基本）**

`index.html` を再読み込みし、以下を確認:
- 受付で「整理券を取る」を数回押す → 番号が 1,2,3... と増え、待ち人数が増える。
- 呼び出し管理で「次を呼ぶ」→ 呼び出し番号が 1,2... と待ち順に進み、待ちリストから消える。
- 待ちが空で「次を呼ぶ」→「待っている番号はありません」と表示。
- 「リセット」→ 確認後すべて初期化。

Expected: すべて仕様通り。

- [ ] **Step 3: 別タブ連動を確認**

同じ `index.html` をもう1つのタブで開き「呼び出し表示」タブにする。元タブの管理画面で「次を呼ぶ」を押す。
Expected: 表示タブの大きな番号が自動更新される。

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "feat: wire up issue/call/reset and cross-tab sync"
```

---

## Self-Review 結果

- **Spec coverage:** 受付画面(Task5,6)、呼び出し管理(Task5,6)、呼び出し表示(Task5,6)、データモデル(Task1-4)、空待ち時の処理(Task3,6)、初回起動の初期化(Task5 loadState)、別タブ連動(Task6)、リセット(Task4,6) — 仕様の全項目に対応タスクあり。MVP対象外（スマホ通知・サーバー同期・印刷等）は計画にも含めず一致。
- **Placeholder scan:** プレースホルダなし。全コード記載済み。
- **Type consistency:** `initialState` / `issueTicket` / `callNext` / `resetState` の関数名と state の3プロパティ名（`lastIssued` / `nowCalling` / `waiting`）は全タスクで一貫。
- **Security:** DOM更新は `textContent` と DOM API のみ。`innerHTML` 不使用でXSSリスクなし。
