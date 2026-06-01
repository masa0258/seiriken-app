# 運用向け 役割別モード＋設定クラウド同期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `index.html` を URL パラメータ `?mode=` で役割別（受付／呼び出し表示／スタッフ）に固定し、店舗内容設定＋PINをSupabase経由でクラウド同期し、設定を長押し＋PINの奥に隠す。

**Architecture:** 1ファイル構成を維持。役割判定・設定マージは純粋関数 `modes.js`（vmハーネスでテスト）に切り出す。`index.html` は `modes.js` を読み込み、起動時に `?mode=` で表示画面を絞り、店舗設定をクラウドから取得。書き込みは秘密キー必須の新RPC `publish_config`、読み取りはanonキーで `app_config` テーブルをSELECT。接続URL＋anonキー（公開安全）はファイルに既定値として埋め込み、秘密キーはスタッフ設定でのみ入力。

**Tech Stack:** バニラJS（外部ライブラリ無し）、localStorage、Supabase PostgREST（plain fetch）、Node `vm` モジュールによるテストハーネス。

**重要な制約（厳守）:**
- DOM操作は `textContent`/`createElement`/`appendChild`/`createTextNode` のみ。`innerHTML` 禁止（セキュリティフックでブロック）。
- queue.js / printer.js / status.js は変更しない。既存テストはPASSのまま。
- 秘密キーは受付・モニター端末に露出させない（スタッフ設定のみ）。
- Supabase URL `https://gfnpoamqcwydgxiwrcbj.supabase.co` と anonキー `sb_publishable_o-b8b8jo0BYqNXm2I-bLXQ_F4nKUm_k` は公開安全。埋め込み可。
- 各コミットは `git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit ...` を使う。`--no-verify` 禁止。
- `grep -c innerHTML` は0件時に非ゼロ終了するので `&&` で連結せず単独実行する。

---

## File Structure

- **Create `modes.js`** — 役割判定とクラウド設定マージの純粋関数（`resolveMode`, `applyRemoteConfig`）。DOM非依存。index.html と modes.test.html から読み込む。
- **Create `modes.test.html`** — `modes.js` のテスト（既存 *.test.html と同じ `check()` パターン）。
- **Modify `docs/superpowers/supabase-setup.sql`** — `app_config` テーブル＋anon読み取りポリシー＋`publish_config` RPC を追記。
- **Modify `index.html`** — `modes.js` 読み込み、役割別表示、隠し設定＋PIN、設定クラウド同期、既定接続埋め込み。

---

## Task 1: modes.js 純粋関数（resolveMode / applyRemoteConfig）

**Files:**
- Create: `modes.js`
- Test: `modes.test.html`

- [ ] **Step 1: テストファイルを作成（失敗する状態）**

Create `modes.test.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>modes.js tests</title></head>
<body>
<h1>modes.js テスト結果</h1>
<ul id="results"></ul>
<script src="modes.js"></script>
<script>
  const results = document.getElementById('results');
  function check(name, cond) {
    const li = document.createElement('li');
    li.textContent = (cond ? 'PASS: ' : 'FAIL: ') + name;
    li.style.color = cond ? 'green' : 'red';
    results.appendChild(li);
  }

  // resolveMode
  check('resolveMode: ?mode=staff → staff', resolveMode('?mode=staff') === 'staff');
  check('resolveMode: ?mode=display → display', resolveMode('?mode=display') === 'display');
  check('resolveMode: ?mode=reception → reception', resolveMode('?mode=reception') === 'reception');
  check('resolveMode: 空文字 → reception', resolveMode('') === 'reception');
  check('resolveMode: 不明値 → reception', resolveMode('?mode=admin') === 'reception');
  check('resolveMode: 他パラメータ混在 → display', resolveMode('?foo=1&mode=display') === 'display');
  check('resolveMode: undefined → reception', resolveMode(undefined) === 'reception');

  // applyRemoteConfig
  const defaults = { storeName: 'ローカル店', headerMessage: 'h', footerMessage: 'f', qrUrl: 'q', showWaitEstimate: true, pin: '1234' };
  const none = applyRemoteConfig(defaults, null);
  check('applyRemoteConfig: remote=null は defaults を返す（storeName）', none.storeName === 'ローカル店');
  check('applyRemoteConfig: remote=null は defaults を返す（pin）', none.pin === '1234');

  const row = { store_name: 'クラウド店', header_message: 'H', footer_message: 'F', qr_url: 'Q', show_wait_estimate: false, pin: '9999' };
  const merged = applyRemoteConfig(defaults, row);
  check('applyRemoteConfig: remote の store_name を採用', merged.storeName === 'クラウド店');
  check('applyRemoteConfig: remote の show_wait_estimate=false を採用', merged.showWaitEstimate === false);
  check('applyRemoteConfig: remote の pin を採用', merged.pin === '9999');

  const partial = { store_name: 'クラウド店', header_message: null, footer_message: null, qr_url: null, show_wait_estimate: null, pin: null };
  const mergedPartial = applyRemoteConfig(defaults, partial);
  check('applyRemoteConfig: remote の null フィールドは defaults にフォールバック（header）', mergedPartial.headerMessage === 'h');
  check('applyRemoteConfig: remote の null pin は defaults にフォールバック', mergedPartial.pin === '1234');
  check('applyRemoteConfig: remote の null show_wait は defaults(true)', mergedPartial.showWaitEstimate === true);

  const emptyDefaults = applyRemoteConfig({}, null);
  check('applyRemoteConfig: defaults 欠落時 pin は 0000', emptyDefaults.pin === '0000');
  check('applyRemoteConfig: defaults 欠落時 showWaitEstimate は true', emptyDefaults.showWaitEstimate === true);
</script>
</body>
</html>
```

- [ ] **Step 2: テストが失敗することを確認**

Run（`modes.js` 未作成なので `resolveMode is not defined` で全FAIL）:

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && node <<'EOF'
const fs = require('fs'); const vm = require('vm');
function inlineScript(html){ const ms=[...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)]; return ms.length ? ms[ms.length-1][1] : ''; }
const out=[];
const doc={ createElement:()=>({ style:{}, set textContent(v){this._t=v;}, get textContent(){return this._t;} }), getElementById:()=>({ appendChild:(el)=>out.push(el) }) };
const ctx={ document:doc, console }; vm.createContext(ctx);
try { vm.runInContext(fs.readFileSync('modes.js','utf8'), ctx, {filename:'modes.js'}); } catch(e){ console.log('LOAD ERROR: '+e.message); }
try { vm.runInContext(inlineScript(fs.readFileSync('modes.test.html','utf8')), ctx, {filename:'modes.test.html'}); } catch(e){ console.log('RUN ERROR: '+e.message); }
const pass=out.filter(r=>/^PASS/.test(r.textContent)).length, fail=out.filter(r=>/^FAIL/.test(r.textContent)).length;
out.filter(r=>/^FAIL/.test(r.textContent)).forEach(r=>console.log(r.textContent));
console.log('PASS='+pass+' FAIL='+fail);
EOF
```

Expected: `LOAD ERROR` または `PASS=0 FAIL>=1`（関数未定義で失敗）。

- [ ] **Step 3: modes.js を実装**

Create `modes.js`:

```js
// 役割モードの解決と、クラウド設定のマージを行う純粋関数（DOM非依存）。
// index.html と modes.test.html の両方から読み込む。

// URLのsearch文字列（例 '?mode=staff'）から役割モードを決定する。
// 既知の値は 'reception' | 'display' | 'staff'。未指定・不明値は安全側で 'reception'。
function resolveMode(search) {
  const m = String(search || '').match(/[?&]mode=([^&]*)/);
  const v = m ? decodeURIComponent(m[1]) : '';
  if (v === 'display' || v === 'staff' || v === 'reception') return v;
  return 'reception';
}

// クラウドの設定行（remote）を、画面で使う設定オブジェクトに正規化する。
// remote が無い／壊れている場合や、個別フィールドが null/undefined の場合は defaults にフォールバック。
function applyRemoteConfig(defaults, remote) {
  const d = defaults || {};
  const base = {
    storeName: d.storeName || '',
    headerMessage: d.headerMessage || '',
    footerMessage: d.footerMessage || '',
    qrUrl: d.qrUrl || '',
    showWaitEstimate: d.showWaitEstimate !== false,
    pin: d.pin || '0000',
  };
  if (!remote || typeof remote !== 'object') return base;
  function pick(remoteVal, fallback) {
    return (remoteVal === null || remoteVal === undefined) ? fallback : remoteVal;
  }
  return {
    storeName: pick(remote.store_name, base.storeName),
    headerMessage: pick(remote.header_message, base.headerMessage),
    footerMessage: pick(remote.footer_message, base.footerMessage),
    qrUrl: pick(remote.qr_url, base.qrUrl),
    showWaitEstimate: pick(remote.show_wait_estimate, base.showWaitEstimate),
    pin: pick(remote.pin, base.pin),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run（Step 2 と同じコマンド）。Expected: `PASS=15 FAIL=0`。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add modes.js modes.test.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add modes.js pure helpers (resolveMode, applyRemoteConfig) with tests"
```

---

## Task 2: Supabase SQL — app_config テーブル＋publish_config RPC

**Files:**
- Modify: `docs/superpowers/supabase-setup.sql`（末尾に追記）

このタスクは自動テストなし（DB側）。実機での適用は手動検証。SQL を追記してコミットするまでが範囲。

- [ ] **Step 1: supabase-setup.sql の末尾に app_config 定義を追記**

`docs/superpowers/supabase-setup.sql` の最終行（`grant execute on function public.publish_status...` の後）に以下を追記:

```sql

-- 5. 設定テーブル（店舗内容設定＋PIN、1行のみ）
--    店名等は秘密情報ではないため anon に SELECT を許可。書き込みは秘密キー必須。
create table if not exists public.app_config (
  id                 text primary key,
  store_name         text    not null default '',
  header_message     text    not null default '',
  footer_message     text    not null default '',
  qr_url             text    not null default '',
  show_wait_estimate boolean not null default true,
  pin                text    not null default '0000',
  updated_at         timestamptz not null default now()
);

insert into public.app_config (id) values ('main')
  on conflict (id) do nothing;

alter table public.app_config enable row level security;

drop policy if exists "anon read app_config" on public.app_config;
create policy "anon read app_config" on public.app_config
  for select to anon using (true);

-- 6. publish_config RPC（SECURITY DEFINER で秘密キー照合）
create or replace function public.publish_config(
  p_secret     text,
  p_store_name text,
  p_header     text,
  p_footer     text,
  p_qr         text,
  p_show_wait  boolean,
  p_pin        text
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
  insert into public.app_config as c (
    id, store_name, header_message, footer_message,
    qr_url, show_wait_estimate, pin, updated_at
  ) values (
    'main', coalesce(p_store_name, ''), coalesce(p_header, ''), coalesce(p_footer, ''),
    coalesce(p_qr, ''), coalesce(p_show_wait, true), coalesce(p_pin, '0000'), now()
  )
  on conflict (id) do update set
    store_name         = excluded.store_name,
    header_message     = excluded.header_message,
    footer_message     = excluded.footer_message,
    qr_url             = excluded.qr_url,
    show_wait_estimate = excluded.show_wait_estimate,
    pin                = excluded.pin,
    updated_at         = now();
end;
$$;

grant execute on function public.publish_config(text,text,text,text,text,boolean,text) to anon;
```

- [ ] **Step 2: SQL の追記を目視確認**

Run:

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && grep -n "publish_config\|app_config" docs/superpowers/supabase-setup.sql
```

Expected: `app_config` と `publish_config` の定義行が表示される。

- [ ] **Step 3: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add docs/superpowers/supabase-setup.sql && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add app_config table and publish_config RPC for settings sync"
```

**手動検証（実装時はスキップ可、運用前に実施）:** Supabase SQL Editor にこのファイル全体を貼り付けて実行 → `app_config` 行が作成され、anonキーで `GET /rest/v1/app_config?id=eq.main&select=*` が200で返ることを確認。

---

## Task 3: index.html — 役割別モード表示＋既定接続埋め込み

**Files:**
- Modify: `index.html`

このタスクは DOM 中心のため自動テストはブラウザ無しでは不可。検証は (a) `innerHTML` が0、(b) 既存 status テストがPASS（status.js を壊していないことの確認）、(c) 手動。スタッフモードでは暫定的に「設定」タブを残す（Task 4 で隠す）。

- [ ] **Step 1: modes.js を読み込む**

`index.html` の `<script src="status.js"></script>`（195行目付近）の直後に追記:

```html
<script src="modes.js"></script>
```

変更後の並び:
```html
<script src="queue.js"></script>
<script src="printer.js"></script>
<script src="status.js"></script>
<script src="modes.js"></script>
<script>
```

- [ ] **Step 2: 既定のSupabase接続を埋め込む**

`index.html` の `SYNC_SETTINGS_KEY` と `DEFAULT_SYNC_SETTINGS` の2行（200〜201行目付近）を、以下の4行に置換:

```js
  const DEFAULT_SUPABASE_URL = 'https://gfnpoamqcwydgxiwrcbj.supabase.co';
  const DEFAULT_SUPABASE_ANON = 'sb_publishable_o-b8b8jo0BYqNXm2I-bLXQ_F4nKUm_k';
  const SYNC_SETTINGS_KEY = 'seiriken-sync-settings';
  const DEFAULT_SYNC_SETTINGS = { enabled: false, supabaseUrl: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_SUPABASE_ANON, publishSecret: '' };
```

- [ ] **Step 3: 役割モード適用関数を追加し、ナビ click ハンドラの直後で呼ぶ**

`index.html` のナビ click ハンドラ（388〜396行目付近の `document.querySelectorAll('nav button').forEach(...)` ブロック）の直後に、以下の関数定義と呼び出しを追加:

```js
  const MODE = resolveMode(location.search);
  // 役割ごとに表示する画面。staff は Task4 で settings を隠すまで暫定的に含める。
  const MODE_SCREENS = {
    reception: ['reception'],
    display: ['display'],
    staff: ['admin', 'report', 'settings'],
  };
  function applyMode(mode) {
    const allowed = MODE_SCREENS[mode] || MODE_SCREENS.reception;
    // 許可されていないナビボタンを取り除く
    document.querySelectorAll('nav button').forEach((b) => {
      if (allowed.indexOf(b.dataset.screen) === -1) b.remove();
    });
    // 単一画面モードはナビ自体を隠す
    const nav = document.querySelector('nav');
    if (nav) nav.style.display = allowed.length <= 1 ? 'none' : '';
    // 最初の許可画面だけを active にする
    document.querySelectorAll('.screen').forEach((s) => {
      s.classList.toggle('active', s.id === allowed[0]);
    });
    document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
    const firstBtn = document.querySelector('nav button');
    if (firstBtn) firstBtn.classList.add('active');
  }
  applyMode(MODE);
```

- [ ] **Step 4: innerHTML が0であることを確認**

Run（単独実行・`&&` で連結しない）:

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && grep -c innerHTML index.html
```

Expected: `0`

- [ ] **Step 5: 既存 status テストがPASSすることを確認（回帰確認）**

Run:

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && node <<'EOF'
const fs = require('fs'); const vm = require('vm');
function inlineScript(html){ const ms=[...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)]; return ms.length ? ms[ms.length-1][1] : ''; }
const out=[];
const doc={ createElement:()=>({ style:{}, set textContent(v){this._t=v;}, get textContent(){return this._t;} }), getElementById:()=>({ appendChild:(el)=>out.push(el) }) };
const ctx={ document:doc, console }; vm.createContext(ctx);
['queue.js','status.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f}));
vm.runInContext(inlineScript(fs.readFileSync('status.test.html','utf8')), ctx, {filename:'status.test.html'});
const pass=out.filter(r=>/^PASS/.test(r.textContent)).length, fail=out.filter(r=>/^FAIL/.test(r.textContent)).length;
out.filter(r=>/^FAIL/.test(r.textContent)).forEach(r=>console.log(r.textContent));
console.log('PASS='+pass+' FAIL='+fail);
EOF
```

Expected: `PASS=31 FAIL=0`（status.test.html の check 件数）。

- [ ] **Step 6: 手動確認（任意・実装時の目視）**

ローカルで `index.html?mode=reception` / `?mode=display` / `?mode=staff` / パラメータ無し を開き、それぞれ受付のみ／表示のみ／管理+記録+設定タブ／受付のみ、になることを確認（ブラウザがあれば）。

- [ ] **Step 7: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: role-based view via ?mode= and embedded default Supabase config"
```

---

## Task 4: index.html — 隠し設定＋PIN動線

**Files:**
- Modify: `index.html`

スタッフナビから「設定」を外し、管理タイトルの2秒長押し＋PINで設定を開く。PINは印刷設定オブジェクトに含めてローカル保存（クラウド同期は Task 5）。

- [ ] **Step 1: スタッフモードから settings タブを外す**

`index.html` の `MODE_SCREENS`（Task 3 で追加）の `staff` を変更:

```js
  const MODE_SCREENS = {
    reception: ['reception'],
    display: ['display'],
    staff: ['admin', 'report'],
  };
```

- [ ] **Step 2: 管理見出しに id を付与し、設定セクションに閉じるボタンを追加**

`index.html` の `<h2>呼び出し管理</h2>`（104行目付近）を変更:

```html
  <h2 id="admin-title">呼び出し管理</h2>
```

`index.html` の設定セクション見出し `<h2>印刷設定 / Print Settings</h2>`（161行目付近）の直前に、閉じるボタンを追加:

```html
  <button id="settings-close" class="secondary">← 設定を閉じる</button>
  <h2>印刷設定 / Print Settings</h2>
```

- [ ] **Step 3: PIN入力欄を設定フォームに追加**

`index.html` の印刷設定フォーム内、`save-settings-btn` ボタンの直前（167〜168行目付近の `<label class="checkbox">...予想待ち時間を印字する</label>` の次）に追加:

```html
    <label>設定PIN（4桁）<br><input id="set-pin" type="text" inputmode="numeric" maxlength="4" placeholder="0000"></label>
```

- [ ] **Step 4: DEFAULT_PRINT_SETTINGS に pin を追加**

`index.html` の `DEFAULT_PRINT_SETTINGS`（199行目付近）を変更:

```js
  const DEFAULT_PRINT_SETTINGS = { storeName: '', headerMessage: '', footerMessage: '', qrUrl: '', showWaitEstimate: true, pin: '0000' };
```

- [ ] **Step 5: fillSettingsForm に PIN を反映**

`index.html` の `fillSettingsForm`（635行目付近）の `set-showWaitEstimate` を設定している行の直後に追加:

```js
    document.getElementById('set-pin').value = printSettings.pin || '0000';
```

- [ ] **Step 6: save-settings ハンドラで pin も保存**

`index.html` の `save-settings-btn` の click ハンドラ（646〜657行目付近）内の `printSettings = {...}` 代入を以下に置換（pin を追加）:

```js
    printSettings = {
      storeName: document.getElementById('set-storeName').value,
      headerMessage: document.getElementById('set-headerMessage').value,
      footerMessage: document.getElementById('set-footerMessage').value,
      qrUrl: document.getElementById('set-qrUrl').value,
      showWaitEstimate: document.getElementById('set-showWaitEstimate').checked,
      pin: document.getElementById('set-pin').value || '0000',
    };
```

- [ ] **Step 7: 隠し動線（長押し＋PIN）と設定開閉を実装**

`index.html` の `applyMode(MODE);`（Task 3 で追加した呼び出し）の直後に追加:

```js
  function openSettings() {
    const nav = document.querySelector('nav');
    if (nav) nav.style.display = 'none';
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'settings'));
    fillSettingsForm();
    renderPreview();
  }
  function closeSettings() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'admin'));
    const nav = document.querySelector('nav');
    if (nav) nav.style.display = '';
  }
  function askPin() {
    const input = prompt('設定PINを入力してください');
    if (input === null) return;
    if (input === (printSettings.pin || '0000')) openSettings();
    else alert('PINが違います');
  }
  (function attachHiddenSettings() {
    const title = document.getElementById('admin-title');
    if (!title) return;
    let timer = null;
    const start = () => { if (timer) clearTimeout(timer); timer = setTimeout(askPin, 2000); };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    title.addEventListener('mousedown', start);
    title.addEventListener('touchstart', start, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel', 'touchmove'].forEach((ev) => title.addEventListener(ev, cancel));
    const closeBtn = document.getElementById('settings-close');
    if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  })();
```

- [ ] **Step 8: innerHTML が0であることを確認**

Run（単独実行）:

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && grep -c innerHTML index.html
```

Expected: `0`

- [ ] **Step 9: status テストがPASSすることを確認（回帰）**

Run（Task 3 Step 5 と同じコマンド）。Expected: `PASS=31 FAIL=0`。

- [ ] **Step 10: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: hide settings behind long-press + PIN on staff title"
```

**手動確認（任意）:** `?mode=staff` でナビに設定が無いこと、管理見出しを2秒長押し→PIN `0000` で設定が開くこと、「設定を閉じる」で管理に戻ることを確認。

---

## Task 5: index.html — 設定クラウド同期（fetch / publish_config）

**Files:**
- Modify: `index.html`

起動時とインターバルでクラウド設定を取得・適用。保存時に秘密キーがあれば `publish_config` で書き込み。

- [ ] **Step 1: fetchConfig / publishConfig / fetchAndApplyConfig を追加**

`index.html` の `publishStatus` 関数定義（398行目付近の `async function publishStatus(config, status) {`）の直前に追加:

```js
  function isSettingsOpen() {
    const el = document.getElementById('settings');
    return !!(el && el.classList.contains('active'));
  }
  async function fetchConfig(config) {
    const base = config.supabaseUrl.replace(/\/+$/, '');
    const url = base + '/rest/v1/app_config?id=eq.main&select=*';
    const res = await fetch(url, { headers: { apikey: config.anonKey, 'Authorization': 'Bearer ' + config.anonKey } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    return (Array.isArray(rows) && rows.length) ? rows[0] : null;
  }
  async function publishConfig(config, settings) {
    const base = config.supabaseUrl.replace(/\/+$/, '');
    const res = await fetch(base + '/rest/v1/rpc/publish_config', {
      method: 'POST',
      headers: { apikey: config.anonKey, 'Authorization': 'Bearer ' + config.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_secret: config.publishSecret,
        p_store_name: settings.storeName,
        p_header: settings.headerMessage,
        p_footer: settings.footerMessage,
        p_qr: settings.qrUrl,
        p_show_wait: settings.showWaitEstimate,
        p_pin: settings.pin,
      }),
    });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error('HTTP ' + res.status + ' ' + t); }
  }
  async function fetchAndApplyConfig() {
    if (!syncSettings.supabaseUrl || !syncSettings.anonKey) return;
    const remote = await fetchConfig(syncSettings);
    if (!remote) return;
    printSettings = applyRemoteConfig(printSettings, remote);
    savePrintSettings(printSettings);
    if (!isSettingsOpen()) renderPreview();
  }
```

- [ ] **Step 2: save-settings ハンドラでクラウド書き込みを行う**

`index.html` の `save-settings-btn` click ハンドラ（Task 4 で pin を加えたブロック全体 `document.getElementById('save-settings-btn').addEventListener('click', () => { ... });`）を以下に置換:

```js
  document.getElementById('save-settings-btn').addEventListener('click', () => {
    printSettings = {
      storeName: document.getElementById('set-storeName').value,
      headerMessage: document.getElementById('set-headerMessage').value,
      footerMessage: document.getElementById('set-footerMessage').value,
      qrUrl: document.getElementById('set-qrUrl').value,
      showWaitEstimate: document.getElementById('set-showWaitEstimate').checked,
      pin: document.getElementById('set-pin').value || '0000',
    };
    savePrintSettings(printSettings);
    renderPreview();
    if (syncSettings.supabaseUrl && syncSettings.anonKey && syncSettings.publishSecret) {
      publishConfig(syncSettings, printSettings)
        .then(() => alert('設定を保存しました（クラウド同期OK）'))
        .catch((e) => alert('設定を保存しました（クラウド同期失敗: ' + e.message + '）'));
    } else {
      alert('設定を保存しました（この端末のみ。クラウド同期には書き込み秘密キーが必要です）');
    }
  });
```

- [ ] **Step 3: 起動時と定期取得を配線**

`index.html` の最終行 `render();`（688行目付近、`</script>` の直前）の直後に追加:

```js
  fetchAndApplyConfig().catch(() => {});
  setInterval(() => { fetchAndApplyConfig().catch(() => {}); }, 30000);
```

- [ ] **Step 4: innerHTML が0であることを確認**

Run（単独実行）:

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && grep -c innerHTML index.html
```

Expected: `0`

- [ ] **Step 5: status テストがPASSすることを確認（回帰）**

Run（Task 3 Step 5 と同じコマンド）。Expected: `PASS=31 FAIL=0`。

- [ ] **Step 6: modes テストがPASSのままか確認**

Run（Task 1 Step 2 と同じコマンド）。Expected: `PASS=15 FAIL=0`。

- [ ] **Step 7: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app && git add index.html && git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: cloud-sync store settings and PIN via publish_config"
```

**手動検証（運用前）:**
1. Task 2 の SQL を Supabase に適用済みにする。
2. スタッフ端末（`?mode=staff`）で設定を開き、オンライン共有の Supabase URL/anon/秘密キーを入力・保存。
3. 店名を変更して「設定を保存」→「クラウド同期OK」。
4. 別端末（`?mode=reception` 等）を再読込 or 30秒待ち、店名（印刷プレビュー等）が反映される。
5. PINを変更・保存 → 別スタッフ端末でも新PINで設定が開く。
6. 受付・モニター端末の画面に秘密キー入力欄が一切出ないことを確認。

---

## 完了後

全タスク完了後、`superpowers:finishing-a-development-branch` で開発を締める（テスト確認 → マージ/PR/保持/破棄の選択）。デプロイは GitHub Pages（main push で自動反映）。

## Self-Review メモ（プラン作成者チェック済み）

- **Spec coverage:** 役割モード（Task3）／フォールバック=reception（Task3 MODE_SCREENS既定）／隠し設定+PIN（Task4）／クラウド同期 店舗設定+PIN（Task2 SQL + Task5）／既定接続埋め込み（Task3 Step2）／innerHTML 0・既存テストPASS（各Task検証ステップ）。全項目に対応タスクあり。
- **Type consistency:** `applyRemoteConfig(defaults, remote)`／`resolveMode(search)`／`fetchConfig(config)`／`publishConfig(config, settings)`／`fetchAndApplyConfig()`／`applyMode(mode)`／`openSettings()`/`closeSettings()`/`askPin()` の名称・引数は全タスクで一貫。`printSettings` は pin を含む統一形（Task4でDEFAULTとフォーム、Task5でクラウド適用）。
- **Placeholder scan:** TBD/TODO/「適切に処理」等なし。各コード手順に実コードあり。
