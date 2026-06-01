# 顧客向け 呼び出し状況ページ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 整理券のQRコードを読んだお客さんが、スマホで現在の呼び出し状況（呼び出し中の番号・待ち組数・直近履歴・自分の順番）をリアルタイムに近い形で確認できるようにする。

**Architecture:** 共有バックエンドに Supabase（無料BaaS）を使う。店アプリ（`index.html`）はキュー変化のたびに公開サマリを Supabase の SQL関数（RPC・秘密キー保護）へ送り、お客さんページ（`status.html`）は Supabase REST を5秒ごとにポーリングして表示する。公開状況の純粋ロジックは新ファイル `status.js` に分離し、店・客双方から読み込む。外部ライブラリは使わず `fetch` のみ。

**Tech Stack:** バニラ JavaScript（ビルド・サーバーなし）、localStorage、Supabase（PostgREST + SQL RPC）、GitHub Pages。テストは Node の `vm` モジュールで純粋関数を検証。

---

## 設計仕様

この計画は `docs/superpowers/specs/2026-06-01-customer-status-page-design.md` を実装する。実装中に判断が必要なときは仕様を参照すること。

## 既存コードベースの約束（必読）

- **DOM操作は `textContent` / `createElement` / `appendChild` のみ。`innerHTML` は使用禁止**（セキュリティフックでブロックされる）。
- **作業ディレクトリは常に `/Users/hasemasahiro/Desktop/seiriken-app`**。Bash 呼び出しごとに cwd がリセットされるため、各コマンドの先頭で `cd /Users/hasemasahiro/Desktop/seiriken-app &&` を付ける。
- **git コミットは設定を変更せずインラインで指定**：`git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit ...`。
- ブラウザ自動化は使えない。純粋関数は下記の Node `vm` ハーネスで検証する。Supabase 通信・客ページのDOM描画は手動検証（最終タスク）。
- 既存の純粋ロジックは `queue.js`、テストランナーは `*.test.html` の `check(name, condition)` 方式。これに合わせる。
- 既存 state の形： `{ lastIssued: number, tickets: [{ number, partySize, status, issuedAt, calledAt, completedAt }] }`。`status` は `'waiting' | 'calling' | 'done'`。呼び出すと `status='calling'` かつ `calledAt` がセットされる。完了すると `status='done'`。

## ファイル構成

- **作成 `status.js`** — 公開状況の純粋関数。`buildPublicStatus(state)`（店側）、`computeAhead(waitingNumbers, myNumber)` / `estimateWaitMsForNumber(ahead, avgServeMs)`（客側）。DOM非依存。
- **作成 `status.test.html`** — `status.js` のブラウザ用テストランナー（`check` 方式）。`queue.js` と `status.js` を読み込む（`buildPublicStatus` が `averageServeInterval` を使うため）。
- **作成 `status.html`** — お客さん用の単独ページ。Supabase REST を5秒ポーリングして描画。`status.js` を読み込む。
- **作成 `docs/superpowers/supabase-setup.sql`** — Supabase SQLエディタで一度実行するセットアップスクリプト（テーブル・RLS・秘密保管テーブル・RPC）。
- **作成 `docs/superpowers/deploy-customer-status.md`** — GitHub Pages 公開と手動検証の手順。
- **変更 `index.html`** — オンライン共有設定（`seiriken-sync-settings`）、`publishStatus`、`update()` へのフック、`status.js` の読み込みを追加。

## テストハーネス（Task 1〜3 で共通利用）

純粋関数テストは Node の `vm` で `status.test.html` の `<script>` を読み込んで検証する。**この同じコマンドを Task 1〜3 の各「テスト実行」ステップで使う**：

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && node -e '
const fs = require("fs");
const vm = require("vm");
const qjs = fs.readFileSync("queue.js", "utf8");
const sjs = fs.readFileSync("status.js", "utf8");
const html = fs.readFileSync("status.test.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let pass = 0, fail = 0;
const sandbox = {
  console: console, Date: Date, Array: Array, JSON: JSON,
  document: {
    getElementById: function () { return { appendChild: function () {} }; },
    createElement: function () {
      let o = { style: {} };
      Object.defineProperty(o, "textContent", { set: function (v) { if (String(v).indexOf("PASS") === 0) pass++; else { fail++; console.log(v); } } });
      return o;
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(qjs, sandbox);
vm.runInContext(sjs, sandbox);
vm.runInContext(m[1], sandbox);
console.log("PASS=" + pass + " FAIL=" + fail);
'
```

正規表現 `/<script>([\s\S]*?)<\/script>/` は属性なしの `<script>`（=テスト本体）にマッチする。`<script src="...">` は属性付きなのでマッチしない。`queue.js` を先に読み込むことで `averageServeInterval` が `buildPublicStatus` から参照できる。

---

## Task 1: `buildPublicStatus`（店側・公開サマリ生成）

**Files:**
- Create: `status.js`
- Create: `status.test.html`

`buildPublicStatus(state)` は店の `state` から客に見せる公開サマリを導出する。`calling_number` は status==='calling' の中で `calledAt` が最新の番号（無ければ null）。`recent_called` は `calledAt` が設定済み（calling か done）の番号を `calledAt` 降順・最大5件。`waiting_numbers` は status==='waiting' の番号の昇順配列。`avg_serve_ms` は既存 `averageServeInterval(state)`（無ければ null）を整数に丸めたもの。

- [ ] **Step 1: テストファイルを作成（失敗するテスト）**

Create `status.test.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>status.js tests</title></head>
<body>
<h1>status.js テスト結果</h1>
<ul id="results"></ul>
<script src="queue.js"></script>
<script src="status.js"></script>
<script>
  const results = document.getElementById('results');
  function check(name, cond) {
    const li = document.createElement('li');
    li.textContent = (cond ? 'PASS: ' : 'FAIL: ') + name;
    li.style.color = cond ? 'green' : 'red';
    results.appendChild(li);
  }
  function arrEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // 共通サンプル: 36,37 は完了、38 は呼び出し中、40,42,43 は待機
  function sampleState() {
    return {
      lastIssued: 43,
      tickets: [
        { number: 36, partySize: 2, status: 'done',    issuedAt: 1000, calledAt: 5000, completedAt: 6000 },
        { number: 37, partySize: 1, status: 'done',    issuedAt: 1100, calledAt: 6000, completedAt: 7000 },
        { number: 38, partySize: 3, status: 'calling', issuedAt: 1200, calledAt: 7000, completedAt: null },
        { number: 40, partySize: 1, status: 'waiting', issuedAt: 1300, calledAt: null, completedAt: null },
        { number: 42, partySize: 2, status: 'waiting', issuedAt: 1400, calledAt: null, completedAt: null },
        { number: 43, partySize: 1, status: 'waiting', issuedAt: 1500, calledAt: null, completedAt: null },
      ],
    };
  }

  (function () {
    const s = buildPublicStatus(sampleState());
    check('buildPublicStatus: calling_number は最後にcalledされた呼出中番号(38)', s.calling_number === 38);
    check('buildPublicStatus: recent_called は calledAt降順・最大5件', arrEqual(s.recent_called, [38, 37, 36]));
    check('buildPublicStatus: waiting_numbers は昇順', arrEqual(s.waiting_numbers, [40, 42, 43]));
    check('buildPublicStatus: waiting_count は待機件数(3)', s.waiting_count === 3);
    check('buildPublicStatus: last_issued は state.lastIssued(43)', s.last_issued === 43);
    // 案内間隔: calledAt [5000,6000,7000] → 間隔 [1000,1000] → 平均 1000
    check('buildPublicStatus: avg_serve_ms は averageServeInterval(=1000)', s.avg_serve_ms === 1000);
  })();

  (function () {
    const s = buildPublicStatus({ lastIssued: 0, tickets: [] });
    check('buildPublicStatus: 空stateで calling_number=null', s.calling_number === null);
    check('buildPublicStatus: 空stateで waiting_numbers=[]', arrEqual(s.waiting_numbers, []));
    check('buildPublicStatus: 空stateで avg_serve_ms=null', s.avg_serve_ms === null);
  })();

  (function () {
    // recent_called が6件以上でも最大5件
    const tickets = [];
    for (let i = 1; i <= 7; i++) {
      tickets.push({ number: i, partySize: 1, status: 'done', issuedAt: i, calledAt: i * 100, completedAt: i * 100 + 50 });
    }
    const s = buildPublicStatus({ lastIssued: 7, tickets: tickets });
    check('buildPublicStatus: recent_called は最大5件に制限', s.recent_called.length === 5 && arrEqual(s.recent_called, [7, 6, 5, 4, 3]));
  })();
</script>
</body>
</html>
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run（上の「テストハーネス」コマンド）。
Expected: `status.js` がまだ無いため `fs.readFileSync("status.js")` でエラー、または `buildPublicStatus is not defined` で FAIL。

- [ ] **Step 3: status.js に buildPublicStatus を実装**

Create `status.js`:

```js
// 公開状況の純粋ロジック（DOM非依存）。店アプリ・客ページ双方から読み込む。
// buildPublicStatus は averageServeInterval（queue.js）が読み込まれている前提（店側）。

function buildPublicStatus(state) {
  const tickets = (state && Array.isArray(state.tickets)) ? state.tickets : [];

  const calling = tickets.filter(function (t) { return t.status === 'calling'; });
  let callingNumber = null;
  if (calling.length > 0) {
    let latest = calling[0];
    for (let i = 1; i < calling.length; i++) {
      if ((calling[i].calledAt || 0) > (latest.calledAt || 0)) latest = calling[i];
    }
    callingNumber = latest.number;
  }

  const recentCalled = tickets
    .filter(function (t) { return t.calledAt !== null && t.calledAt !== undefined; })
    .slice()
    .sort(function (a, b) { return b.calledAt - a.calledAt; })
    .slice(0, 5)
    .map(function (t) { return t.number; });

  const waitingNumbers = tickets
    .filter(function (t) { return t.status === 'waiting'; })
    .map(function (t) { return t.number; })
    .sort(function (a, b) { return a - b; });

  let avg = null;
  if (typeof averageServeInterval === 'function') {
    const raw = averageServeInterval(state);
    avg = (raw === null || raw === undefined) ? null : Math.round(raw);
  }

  return {
    calling_number: callingNumber,
    recent_called: recentCalled,
    waiting_numbers: waitingNumbers,
    waiting_count: waitingNumbers.length,
    last_issued: (state && state.lastIssued) ? state.lastIssued : 0,
    avg_serve_ms: avg,
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run（テストハーネス）。
Expected: `buildPublicStatus` 系のテストが PASS、`FAIL=0`。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.js status.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: buildPublicStatus（公開状況サマリ生成）を追加"
```

---

## Task 2: `computeAhead`（客側・自分の前の組数）

**Files:**
- Modify: `status.js`
- Modify: `status.test.html`

`computeAhead(waitingNumbers, myNumber)` は、`myNumber` が `waitingNumbers`（昇順番号配列）に含まれれば `{ found: true, ahead: 自分より小さい番号の件数 }`、含まれなければ `{ found: false, ahead: 0 }` を返す。

- [ ] **Step 1: テストを追加（失敗するテスト）**

`status.test.html` の `<script>` 末尾（`</script>` の直前）に追記：

```javascript
  (function () {
    const w = [40, 42, 43, 45];
    const r1 = computeAhead(w, 43);
    check('computeAhead: 自分(43)の前は2組', r1.found === true && r1.ahead === 2);
    const r2 = computeAhead(w, 40);
    check('computeAhead: 先頭(40)の前は0組', r2.found === true && r2.ahead === 0);
    const r3 = computeAhead(w, 99);
    check('computeAhead: 不在番号は found:false, ahead:0', r3.found === false && r3.ahead === 0);
    const r4 = computeAhead([], 5);
    check('computeAhead: 空配列は found:false', r4.found === false && r4.ahead === 0);
  })();
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run（テストハーネス）。
Expected: `computeAhead is not defined` で該当テストが FAIL。

- [ ] **Step 3: status.js に computeAhead を実装**

`status.js` の `buildPublicStatus` 関数の後ろに追記：

```js
function computeAhead(waitingNumbers, myNumber) {
  const list = Array.isArray(waitingNumbers) ? waitingNumbers : [];
  if (list.indexOf(myNumber) === -1) {
    return { found: false, ahead: 0 };
  }
  let ahead = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] < myNumber) ahead++;
  }
  return { found: true, ahead: ahead };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run（テストハーネス）。
Expected: `computeAhead` 系が PASS、`FAIL=0`。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.js status.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: computeAhead（自分の前の待ち組数）を追加"
```

---

## Task 3: `estimateWaitMsForNumber` ＋ 非破壊テスト

**Files:**
- Modify: `status.js`
- Modify: `status.test.html`

`estimateWaitMsForNumber(ahead, avgServeMs)` は予想待ちミリ秒を返す。`avgServeMs` が null/undefined/0 のときは推定不可で null。基本は `ahead * avgServeMs`。あわせて、純粋関数が引数を破壊しないことを確認する。

- [ ] **Step 1: テストを追加（失敗するテスト）**

`status.test.html` の `<script>` 末尾に追記：

```javascript
  (function () {
    check('estimateWaitMsForNumber: 3組×1000ms=3000', estimateWaitMsForNumber(3, 1000) === 3000);
    check('estimateWaitMsForNumber: 0組は0', estimateWaitMsForNumber(0, 1000) === 0);
    check('estimateWaitMsForNumber: avg=null は null', estimateWaitMsForNumber(3, null) === null);
    check('estimateWaitMsForNumber: avg=0 は null', estimateWaitMsForNumber(3, 0) === null);
  })();

  (function () {
    // 非破壊チェック
    const state = sampleState();
    const before = JSON.stringify(state);
    buildPublicStatus(state);
    check('buildPublicStatus は state を破壊しない', JSON.stringify(state) === before);

    const w = [40, 42, 43];
    const wBefore = JSON.stringify(w);
    computeAhead(w, 42);
    check('computeAhead は引数配列を破壊しない', JSON.stringify(w) === wBefore);
  })();
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run（テストハーネス）。
Expected: `estimateWaitMsForNumber is not defined` で該当テストが FAIL。

- [ ] **Step 3: status.js に estimateWaitMsForNumber を実装**

`status.js` の `computeAhead` 関数の後ろに追記：

```js
function estimateWaitMsForNumber(ahead, avgServeMs) {
  if (avgServeMs === null || avgServeMs === undefined || avgServeMs === 0) return null;
  return ahead * avgServeMs;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run（テストハーネス）。
Expected: 全テスト PASS、`FAIL=0`。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.js status.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: estimateWaitMsForNumber と非破壊テストを追加"
```

---

## Task 4: Supabase セットアップ SQL

**Files:**
- Create: `docs/superpowers/supabase-setup.sql`

Supabase の SQLエディタで一度実行するスクリプト。`queue_status` テーブル（1行）、RLS（anonはSELECTのみ）、秘密キー保管テーブル（anon読取不可）、`publish_status` 関数（`SECURITY DEFINER`・秘密キー照合）を作る。コードを生成するだけで実行はしない（手動検証タスクで実行）。

- [ ] **Step 1: SQLスクリプトを作成**

Create `docs/superpowers/supabase-setup.sql`:

```sql
-- 顧客向け呼び出し状況ページ用 Supabase セットアップ
-- Supabase ダッシュボード → SQL Editor に貼り付けて一度実行する。
-- 実行前に下の '★ここに秘密キーを設定★' を任意の長い文字列に置き換えること。

-- 1. 状況テーブル（1行のみ）
create table if not exists public.queue_status (
  id              text primary key,
  calling_number  int,
  recent_called   jsonb  not null default '[]'::jsonb,
  waiting_numbers jsonb  not null default '[]'::jsonb,
  waiting_count   int    not null default 0,
  last_issued     int    not null default 0,
  avg_serve_ms    bigint,
  updated_at      timestamptz not null default now()
);

-- 初期行（id='main' 固定）
insert into public.queue_status (id) values ('main')
  on conflict (id) do nothing;

-- 2. 秘密キー保管テーブル（anon は読めない）
create table if not exists public.private_config (
  id     text primary key,
  secret text not null
);

insert into public.private_config (id, secret)
  values ('main', '★ここに秘密キーを設定★')
  on conflict (id) do update set secret = excluded.secret;

-- 3. RLS（行レベルセキュリティ）
alter table public.queue_status  enable row level security;
alter table public.private_config enable row level security;

-- anon は queue_status の SELECT のみ許可
drop policy if exists "anon read queue_status" on public.queue_status;
create policy "anon read queue_status" on public.queue_status
  for select to anon using (true);

-- private_config はポリシーを作らない（RLS有効＋ポリシー無し＝anonアクセス拒否）。
-- 念のためテーブル権限も剥奪（多層防御）。
revoke all on table public.private_config from anon, authenticated;

-- 4. publish_status RPC（SECURITY DEFINER で秘密キー照合）
create or replace function public.publish_status(
  p_secret  text,
  p_calling int,
  p_recent  jsonb,
  p_waiting jsonb,
  p_count   int,
  p_last    int,
  p_avg     bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.private_config where id = 'main';
  if v_secret is null or p_secret is distinct from v_secret then
    raise exception 'unauthorized';
  end if;
  update public.queue_status set
    calling_number  = p_calling,
    recent_called   = coalesce(p_recent,  '[]'::jsonb),
    waiting_numbers = coalesce(p_waiting, '[]'::jsonb),
    waiting_count   = coalesce(p_count, 0),
    last_issued     = coalesce(p_last, 0),
    avg_serve_ms    = p_avg,
    updated_at      = now()
  where id = 'main';
end;
$$;

-- anon に RPC の実行のみ許可（秘密キーが無ければ更新できない）
grant execute on function public.publish_status(text,int,jsonb,jsonb,int,int,bigint) to anon;
```

- [ ] **Step 2: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add docs/superpowers/supabase-setup.sql && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: Supabase セットアップSQL（テーブル・RLS・publish_status RPC）"
```

---

## Task 5: 店アプリのオンライン共有設定（モデル＋フォーム）

**Files:**
- Modify: `index.html`

オンライン共有の設定（`seiriken-sync-settings`）と設定画面のフォームを追加する。`{ enabled, supabaseUrl, anonKey, publishSecret }`。既定は全て空 / `enabled:false`。この時点では保存・表示のみ（通信は Task 6）。

参照する既存コード：
- 印刷設定の定数・load/save は `index.html:186-203`。
- 設定画面の section は `index.html:160-181`。
- 設定フォームの保存ハンドラと `fillSettingsForm` は `index.html:568-587`。

- [ ] **Step 1: 設定モデルの定数と load/save を追加**

`index.html:188`（`const DEFAULT_PRINT_SETTINGS = ...;` の行）の直後に追記：

```javascript
  const SYNC_SETTINGS_KEY = 'seiriken-sync-settings';
  const DEFAULT_SYNC_SETTINGS = { enabled: false, supabaseUrl: '', anonKey: '', publishSecret: '' };

  function loadSyncSettings() {
    try {
      const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_SYNC_SETTINGS);
      const s = JSON.parse(raw);
      return Object.assign({}, DEFAULT_SYNC_SETTINGS, s);
    } catch (e) {
      return Object.assign({}, DEFAULT_SYNC_SETTINGS);
    }
  }
  function saveSyncSettings(s) {
    localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(s));
  }
  let syncSettings = loadSyncSettings();
```

- [ ] **Step 2: 設定画面にオンライン共有フォームを追加**

`index.html:181`（設定 section の閉じ `</section>` の直前、`<p id="printer-status">...</p>` を含む `printer-controls` div の後ろ）に追記：

```html
  <h3>オンライン共有 / Online sharing</h3>
  <div class="settings-form">
    <label class="checkbox"><input id="sync-enabled" type="checkbox"> オンライン共有を有効にする</label>
    <label>Supabase URL<br><input id="sync-url" type="text" maxlength="200" placeholder="https://xxxx.supabase.co"></label>
    <label>anonキー（公開）<br><input id="sync-anon" type="text" maxlength="500" placeholder="公開anonキー"></label>
    <label>書き込み用 秘密キー<br><input id="sync-secret" type="password" maxlength="200" placeholder="お客さんには渡らない秘密キー"></label>
    <button id="save-sync-btn" class="secondary">オンライン共有設定を保存</button>
    <p id="sync-status">オンライン共有: オフ</p>
  </div>
```

- [ ] **Step 3: フォームの初期値反映と保存ハンドラを追加**

`index.html` の `fillSettingsForm` 内の最後（`document.getElementById('set-showWaitEstimate').checked = printSettings.showWaitEstimate;` の直後、関数の `}` の前）に追記：

```javascript
    document.getElementById('sync-enabled').checked = syncSettings.enabled;
    document.getElementById('sync-url').value = syncSettings.supabaseUrl;
    document.getElementById('sync-anon').value = syncSettings.anonKey;
    document.getElementById('sync-secret').value = syncSettings.publishSecret;
```

そして印刷設定の保存ハンドラ（`save-settings-btn` の `addEventListener` ブロック、`index.html:574-585`）の閉じ `});` の直後に、新しいハンドラと状態表示ヘルパーを追記：

```javascript
  function setSyncStatus(text) {
    document.getElementById('sync-status').textContent = text;
  }
  function refreshSyncStatusLabel() {
    setSyncStatus(syncSettings.enabled ? 'オンライン共有: オン' : 'オンライン共有: オフ');
  }
  document.getElementById('save-sync-btn').addEventListener('click', () => {
    syncSettings = {
      enabled: document.getElementById('sync-enabled').checked,
      supabaseUrl: document.getElementById('sync-url').value.trim(),
      anonKey: document.getElementById('sync-anon').value.trim(),
      publishSecret: document.getElementById('sync-secret').value,
    };
    saveSyncSettings(syncSettings);
    refreshSyncStatusLabel();
    alert('オンライン共有設定を保存しました');
  });
  refreshSyncStatusLabel();
```

- [ ] **Step 4: ブラウザで手動確認**

`index.html` をブラウザで開き、設定画面に「オンライン共有」フォームが表示されること、有効化チェック＋URL等を入力して保存→リロード後も値が残ること（localStorage `seiriken-sync-settings`）を確認する。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: 店アプリにオンライン共有設定フォームを追加"
```

---

## Task 6: 公開処理（publishStatus ＋ update フック）

**Files:**
- Modify: `index.html`

`status.js` を読み込み、`buildPublicStatus(state)` の結果を Supabase RPC へ POST する `publishStatus` を追加。`update(newState)` にフックし、共有ONかつ設定が揃っているときデバウンス（400ms）で送る。失敗は捕捉してメッセージ表示し、キュー操作・`seiriken-state` には影響させない。

参照：`update` 関数は `index.html:370-374`。`<script src="printer.js">` は `index.html:184`。

- [ ] **Step 1: status.js を読み込む**

`index.html:184`（`<script src="printer.js"></script>`）の直後に追記：

```html
<script src="status.js"></script>
```

- [ ] **Step 2: publishStatus と schedulePublish を追加**

`index.html` の `update` 関数（`index.html:370-374`）の直前に追記：

```javascript
  async function publishStatus(config, status) {
    const base = config.supabaseUrl.replace(/\/+$/, '');
    const res = await fetch(base + '/rest/v1/rpc/publish_status', {
      method: 'POST',
      headers: {
        'apikey': config.anonKey,
        'Authorization': 'Bearer ' + config.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_secret: config.publishSecret,
        p_calling: status.calling_number,
        p_recent: status.recent_called,
        p_waiting: status.waiting_numbers,
        p_count: status.waiting_count,
        p_last: status.last_issued,
        p_avg: status.avg_serve_ms,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + text);
    }
  }

  let publishTimer = null;
  function schedulePublish() {
    if (!syncSettings.enabled) return;
    if (!syncSettings.supabaseUrl || !syncSettings.anonKey || !syncSettings.publishSecret) return;
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = null;
      const status = buildPublicStatus(state);
      publishStatus(syncSettings, status)
        .then(() => { setSyncStatus('オンライン共有: 送信OK ' + new Date().toLocaleTimeString()); })
        .catch((e) => { setSyncStatus('オンライン共有エラー: ' + e.message); });
    }, 400);
  }
```

- [ ] **Step 3: update に schedulePublish フックを追加**

`index.html:370-374` の `update` 関数を次に置き換える：

```javascript
  function update(newState) {
    state = newState;
    saveState(state);
    render();
    schedulePublish();
  }
```

- [ ] **Step 4: ブラウザで手動確認（通信なしの回帰）**

`index.html` をブラウザで開き、オンライン共有が**オフ**の状態で発券・呼出・完了・リセットが従来通り動作し、エラーが出ないこと（通信ゼロ）を確認する。実際の Supabase 送信は Task 8 の手動検証で行う。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: キュー変化を Supabase へ公開する publishStatus を追加"
```

---

## Task 7: お客さんページ `status.html`

**Files:**
- Create: `status.html`

QRのリンク先になる単独ページ。Supabase URL・anonキー・行ID を埋め込み、5秒ごとに REST GET でポーリングして描画。`status.js` の `computeAhead` / `estimateWaitMsForNumber` で自分の順番・予想待ちを計算。DOM操作は `textContent` / `createElement` / `appendChild` のみ。

- [ ] **Step 1: status.html を作成**

Create `status.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>呼び出し状況</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f5; color: #222; }
    .wrap { max-width: 480px; margin: 0 auto; padding: 16px; }
    .card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .store-name { font-size: 18px; font-weight: bold; text-align: center; }
    .calling-label { text-align: center; color: #666; font-size: 14px; }
    .calling-number { text-align: center; font-size: 56px; font-weight: bold; color: #c0392b; margin: 4px 0; }
    .my-row { display: flex; gap: 8px; align-items: center; }
    .my-row input { flex: 1; font-size: 18px; padding: 8px; }
    .my-row button { font-size: 16px; padding: 8px 16px; }
    .my-result { margin-top: 10px; font-size: 18px; text-align: center; min-height: 24px; }
    .info { font-size: 16px; }
    .recent { font-size: 16px; }
    .meta { font-size: 12px; color: #888; text-align: center; }
    .err { color: #c0392b; }
  </style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div id="store-name" class="store-name"></div>
    <div class="calling-label">ただいまお呼び出し中</div>
    <div id="calling-number" class="calling-number">—</div>
  </div>

  <div class="card">
    <div class="my-row">
      <input id="my-number" type="number" inputmode="numeric" placeholder="あなたの番号">
      <button id="my-check">確認</button>
    </div>
    <div id="my-result" class="my-result"></div>
  </div>

  <div class="card info">
    <div id="waiting-count">—</div>
  </div>

  <div class="card recent">
    <div>直近の呼び出し</div>
    <div id="recent-called">—</div>
  </div>

  <div id="meta" class="meta"></div>
</div>

<script src="status.js"></script>
<script>
  // ▼ 店ごとに設定（anonキーは公開前提で安全。秘密キーはここには書かない）
  const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
  const ROW_ID = 'main';
  const POLL_MS = 5000;

  let lastRow = null;

  function setText(id, text) {
    document.getElementById(id).textContent = text;
  }

  function fmtMinutes(ms) {
    if (ms === null || ms === undefined) return null;
    const min = Math.max(1, Math.round(ms / 60000));
    return min;
  }

  function renderRow(row) {
    // 呼び出し中
    if (row.calling_number === null || row.calling_number === undefined) {
      setText('calling-number', '準備中です');
    } else {
      setText('calling-number', row.calling_number + '番');
    }
    // 待ち組数
    setText('waiting-count', '現在 ' + (row.waiting_count || 0) + '組お待ち');
    // 直近の呼び出し
    const recent = Array.isArray(row.recent_called) ? row.recent_called : [];
    setText('recent-called', recent.length ? recent.join('・') : '—');
    // 自分の番号の結果を再計算
    renderMyResult();
    // メタ
    let when = '';
    if (row.updated_at) {
      const d = new Date(row.updated_at);
      when = '最終更新 ' + d.toLocaleTimeString();
    }
    setText('meta', when + '（自動更新中）');
  }

  function renderMyResult() {
    const el = document.getElementById('my-result');
    el.classList.remove('err');
    const raw = document.getElementById('my-number').value;
    if (raw === '' || lastRow === null) { el.textContent = ''; return; }
    const myNumber = parseInt(raw, 10);
    if (isNaN(myNumber)) { el.textContent = ''; return; }
    const waiting = Array.isArray(lastRow.waiting_numbers) ? lastRow.waiting_numbers : [];
    const res = computeAhead(waiting, myNumber);
    if (!res.found) {
      el.textContent = '呼び出し済み、または完了の可能性があります';
      return;
    }
    const waitMs = estimateWaitMsForNumber(res.ahead, lastRow.avg_serve_ms);
    const min = fmtMinutes(waitMs);
    if (min === null) {
      el.textContent = 'あと約' + res.ahead + '組';
    } else {
      el.textContent = 'あと約' + res.ahead + '組・約' + min + '分';
    }
  }

  async function poll() {
    const base = SUPABASE_URL.replace(/\/+$/, '');
    const url = base + '/rest/v1/queue_status?id=eq.' + ROW_ID + '&select=*';
    try {
      const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      if (rows && rows.length > 0) {
        lastRow = rows[0];
        renderRow(lastRow);
      }
    } catch (e) {
      // 直前の値は保持し、状態だけ「再接続中」に
      const meta = document.getElementById('meta');
      meta.textContent = '再接続中…';
      meta.classList.add('err');
    }
  }

  document.getElementById('my-check').addEventListener('click', renderMyResult);
  document.getElementById('my-number').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renderMyResult();
  });

  poll();
  setInterval(poll, POLL_MS);
</script>
</body>
</html>
```

- [ ] **Step 2: ブラウザで構文・描画の手動確認**

`status.html` をブラウザで開く（Supabase 未設定なので「再接続中…」表示でよい）。レイアウトが崩れないこと、番号入力欄・確認ボタンが表示されることを確認する。実データ反映は Task 8 で検証。

- [ ] **Step 3: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add status.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: お客さん向け呼び出し状況ページ status.html を追加"
```

---

## Task 8: デプロイ手順ドキュメント＋手動検証

**Files:**
- Create: `docs/superpowers/deploy-customer-status.md`

Supabase セットアップ → GitHub Pages 公開 → 店アプリ設定 → 実機検証の手順をまとめ、その手順に沿って一度通しで動作確認する。

- [ ] **Step 1: デプロイ手順ドキュメントを作成**

Create `docs/superpowers/deploy-customer-status.md`:

```markdown
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
```

- [ ] **Step 2: ドキュメントに沿って通し検証**

`docs/superpowers/deploy-customer-status.md` の手順1〜6を実際に実行し、店の発券→客ページ反映→番号入力の順番表示まで通ることを確認する。問題があれば該当タスクのコードを修正して再コミットする。

- [ ] **Step 3: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add docs/superpowers/deploy-customer-status.md && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "docs: 顧客向け状況ページのデプロイ・検証手順を追加"
```

---

## 完了条件

- `status.js` の3関数が `status.test.html` の全テストで PASS（`FAIL=0`）。
- 店アプリがオンライン共有オフのとき従来通り（通信ゼロ・回帰なし）。
- 手順ドキュメントに沿って、店の発券・呼出が客ページに5秒以内で反映され、番号入力で順番が表示される。
- 秘密キーが客側に一切露出しない（客ページ・anonキー経由では `private_config` を読めない／秘密キー無しでは `publish_status` が `unauthorized`）。
