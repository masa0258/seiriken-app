# 待ち時間予測機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 処理ペース×待ち人数で予想待ち時間を算出し、受付・呼び出し表示・呼び出し管理の3画面に「約N分」を表示する。

**Architecture:** queue.js に読み取り専用の純粋関数（averageServeInterval / estimatedWaitMs / estimatedWaitMsForNew）を追加し、ブラウザ用テスト（queue.test.html）で検証する。index.html は表示側でこれらを呼び、既存の textContent ベースのレンダリングと storage イベント連動に組み込む。

**Tech Stack:** 単体HTMLファイル（HTML + CSS + Vanilla JS）、localStorage、ブラウザ用 assert テストランナー。サーバー・外部ライブラリ・ビルドツールなし。

**重要な制約:**
- DOM 更新は `textContent` と `createElement`/`removeChild` のみ。`innerHTML` は禁止（セキュリティフックでブロックされる）。
- queue.js の関数は state を変更しない純粋関数（既存パターンに合わせる）。
- 既存の localStorage キー `seiriken-state` のデータモデル（`{lastIssued, tickets:[]}`、ticket = `{number, partySize, status, issuedAt, calledAt, completedAt}`）は変更しない。
- ブラウザでの検証は `cd /Users/hasemasahiro/Desktop/seiriken-app && python3 -m http.server 8765` を起動し `http://localhost:8765/...` で行う（file:// は不可）。
- git commit はリポジトリ root（`/Users/hasemasahiro/Desktop/seiriken-app`）で `git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit ...` を使う。

---

## File Structure

- `queue.js`（変更）: 既存の純粋関数群の末尾に予測関数3つを追加。
- `queue.test.html`（変更）: 既存テストの末尾に予測関数のテストを追加。
- `index.html`（変更）: 受付・呼び出し表示・呼び出し管理の各画面に予測表示を追加。

---

### Task 1: averageServeInterval（処理ペース）を追加

**Files:**
- Modify: `queue.js`（末尾、`hourlySummary` 関数の後に追加）
- Test: `queue.test.html`（末尾の `</script>` 直前に追加）

予測の土台。案内済みチケットの `calledAt` を昇順に並べ、連続する間隔の直近 `sampleSize` 件（既定5）の平均ミリ秒を返す。間隔が取れない（案内0〜1件）なら `null`。

- [ ] **Step 1: 失敗するテストを書く**

`queue.test.html` の最後の `check(...)` 呼び出し（`resetState は初期状態を返す`）の後、`</script>` の前に以下を追加する。先頭のコメント行も含めて貼り付けること。

```javascript
  // --- 待ち時間予測 ---
  const C1 = new Date('2026-06-01T12:00:00').getTime();
  const C2 = new Date('2026-06-01T12:05:00').getTime(); // C1 + 5分
  const C3 = new Date('2026-06-01T12:11:00').getTime(); // C2 + 6分

  check('averageServeInterval は案内0件なら null', (() => {
    return averageServeInterval(issueTicket(initialState(), 2, C1)) === null;
  })());

  check('averageServeInterval は案内1件のみなら null', (() => {
    let s = issueTicket(initialState(), 2, C1);
    s = callTicket(s, 1, C2);
    return averageServeInterval(s) === null;
  })());

  check('averageServeInterval は連続案内の間隔平均を返す', (() => {
    let s = issueTicket(issueTicket(issueTicket(initialState(), 1, C1), 1, C1), 1, C1);
    s = callTicket(s, 1, C1); // 12:00
    s = callTicket(s, 2, C2); // 12:05 (間隔5分)
    s = callTicket(s, 3, C3); // 12:11 (間隔6分)
    // 平均 = (5分 + 6分) / 2 = 5.5分
    return averageServeInterval(s) === 5.5 * 60000;
  })());
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/hasemasahiro/Desktop/seiriken-app && python3 -m http.server 8765` を起動し、ブラウザ（または Playwright MCP）で `http://localhost:8765/queue.test.html` を開く。
Expected: 追加した3件が FAIL（`averageServeInterval is not defined` により赤表示）。

- [ ] **Step 3: 最小実装を書く**

`queue.js` の末尾（`hourlySummary` 関数の閉じ括弧の後）に以下を追加する。

```javascript
function averageServeInterval(state, sampleSize = 5) {
  const times = state.tickets
    .filter((t) => t.calledAt !== null)
    .map((t) => t.calledAt)
    .sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < times.length; i++) {
    intervals.push(times[i] - times[i - 1]);
  }
  if (intervals.length === 0) return null;
  const recent = intervals.slice(-sampleSize);
  const sum = recent.reduce((acc, v) => acc + v, 0);
  return sum / recent.length;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: ブラウザで `http://localhost:8765/queue.test.html` を再読み込み。
Expected: 追加3件を含む全テストが PASS（緑）。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app
git add queue.js queue.test.html
git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add averageServeInterval for serve-pace calculation"
```

---

### Task 2: estimatedWaitMs（番号別の予想待ち時間）を追加

**Files:**
- Modify: `queue.js`（`averageServeInterval` の後に追加）
- Test: `queue.test.html`（Task 1 で追加したブロックの後に追加）

特定の待機番号の予想待ち時間。`averageServeInterval` が `null` なら `null`。そうでなければ、その番号より前にいる待機組数 `ahead` を数え、`interval × (ahead + 1)` を返す。

- [ ] **Step 1: 失敗するテストを書く**

`queue.test.html` の Task 1 で追加したブロックの直後（`</script>` の前）に以下を追加する。

```javascript
  check('estimatedWaitMs は案内実績なしなら null', (() => {
    const s = issueTicket(issueTicket(initialState(), 1, C1), 1, C1);
    return estimatedWaitMs(s, 2) === null;
  })());

  check('estimatedWaitMs は前の待機組が多いほど長い', (() => {
    // 番号1,2,3を発券。1を案内→完了、2を案内 で間隔の実績を作る
    let s = issueTicket(issueTicket(issueTicket(issueTicket(initialState(), 1, C1), 1, C1), 1, C1), 1, C1);
    s = callTicket(s, 1, C1); // 12:00
    s = callTicket(s, 2, C2); // 12:05 → interval平均 5分
    // 待機は 3,4。3の前の待機組は0 → 5分×(0+1)=5分。4の前は1組(3) → 5分×(1+1)=10分
    return estimatedWaitMs(s, 3) === 5 * 60000 && estimatedWaitMs(s, 4) === 10 * 60000;
  })());
```

- [ ] **Step 2: テストが失敗することを確認**

Run: ブラウザで `http://localhost:8765/queue.test.html` を再読み込み。
Expected: 追加2件が FAIL（`estimatedWaitMs is not defined`）。

- [ ] **Step 3: 最小実装を書く**

`queue.js` の `averageServeInterval` 関数の後に以下を追加する。

```javascript
function estimatedWaitMs(state, number, sampleSize = 5) {
  const interval = averageServeInterval(state, sampleSize);
  if (interval === null) return null;
  const ahead = state.tickets.filter(
    (t) => t.status === 'waiting' && t.number < number
  ).length;
  return interval * (ahead + 1);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: ブラウザで `http://localhost:8765/queue.test.html` を再読み込み。
Expected: 全テスト PASS（緑）。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app
git add queue.js queue.test.html
git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add estimatedWaitMs for per-ticket wait estimate"
```

---

### Task 3: estimatedWaitMsForNew（新規来店者向け）を追加

**Files:**
- Modify: `queue.js`（`estimatedWaitMs` の後に追加）
- Test: `queue.test.html`（Task 2 で追加したブロックの後に追加）

これから発券する人／店頭ディスプレイ用。`averageServeInterval` が `null` なら `null`。そうでなければ現在の待機組数 `waitingCount` を数え、`interval × (waitingCount + 1)` を返す。

- [ ] **Step 1: 失敗するテストを書く**

`queue.test.html` の Task 2 で追加したブロックの直後（`</script>` の前）に以下を追加する。

```javascript
  check('estimatedWaitMsForNew は案内実績なしなら null', (() => {
    const s = issueTicket(initialState(), 1, C1);
    return estimatedWaitMsForNew(s) === null;
  })());

  check('estimatedWaitMsForNew は待機組数+1で計算', (() => {
    let s = issueTicket(issueTicket(issueTicket(initialState(), 1, C1), 1, C1), 1, C1);
    s = callTicket(s, 1, C1); // 12:00
    s = callTicket(s, 2, C2); // 12:05 → interval 5分
    // 待機は 3 のみ（1組）→ 5分×(1+1)=10分
    return estimatedWaitMsForNew(s) === 10 * 60000;
  })());

  check('予測関数は元の state を変更しない', (() => {
    let s = issueTicket(issueTicket(initialState(), 1, C1), 1, C1);
    s = callTicket(s, 1, C1);
    s = callTicket(s, 2, C2);
    const before = JSON.stringify(s);
    averageServeInterval(s);
    estimatedWaitMs(s, 2);
    estimatedWaitMsForNew(s);
    return JSON.stringify(s) === before;
  })());
```

- [ ] **Step 2: テストが失敗することを確認**

Run: ブラウザで `http://localhost:8765/queue.test.html` を再読み込み。
Expected: `estimatedWaitMsForNew` の2件が FAIL（`estimatedWaitMsForNew is not defined`）。`予測関数は元の state を変更しない` も同関数未定義で FAIL。

- [ ] **Step 3: 最小実装を書く**

`queue.js` の `estimatedWaitMs` 関数の後に以下を追加する。

```javascript
function estimatedWaitMsForNew(state, sampleSize = 5) {
  const interval = averageServeInterval(state, sampleSize);
  if (interval === null) return null;
  const waitingCount = state.tickets.filter((t) => t.status === 'waiting').length;
  return interval * (waitingCount + 1);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: ブラウザで `http://localhost:8765/queue.test.html` を再読み込み。
Expected: 全テスト PASS（緑）。合計で予測関数のテスト8件が緑。

- [ ] **Step 5: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app
git add queue.js queue.test.html
git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add estimatedWaitMsForNew for new-arrival wait estimate"
```

---

### Task 4: 表示用フォーマッタ fmtWait を index.html に追加

**Files:**
- Modify: `index.html`（既存のヘルパー関数 `fmtTime`/`fmtFull` の近くに追加）

ミリ秒（または `null`）を「約N分」/「計測中」のバイリンガル文字列に変換する小さなヘルパー。各画面から再利用する（DRY）。

- [ ] **Step 1: 実装を追加**

`index.html` の `<script>` 内、既存の `fmtFull` 関数定義の直後に以下を追加する（`fmtFull` を検索して位置を特定する）。

```javascript
    // ミリ秒 → 「約N分」/ null → 「計測中」のバイリンガル文字列
    function fmtWait(ms) {
      if (ms === null) return '計測中 / Calculating';
      const min = Math.max(1, Math.round(ms / 60000));
      return '約 ' + min + ' 分 / Approx. ' + min + ' min';
    }
```

- [ ] **Step 2: 構文エラーが無いことを確認**

Run: `cd /Users/hasemasahiro/Desktop/seiriken-app && node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/g);console.log('script blocks:', m.length)"`
Expected: `script blocks:` が 1 以上で表示され、エラーが出ない（HTML が壊れていない簡易確認）。

- [ ] **Step 3: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app
git add index.html
git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: add fmtWait helper for bilingual wait-time labels"
```

---

### Task 5: 受付画面に予想待ち時間を表示

**Files:**
- Modify: `index.html`（受付画面のHTML、および発券ボタンのクリックハンドラ）

発券直後の番号表示の下に「あと約N分 / Approx. N min」を出す。`estimatedWaitMsForNew(state)` を発券後の state で評価する。

- [ ] **Step 1: 表示用の段落要素を追加**

`index.html` の受付画面で、発券結果を表示している段落（番号を入れている要素。`あなたの番号は` を検索して直後の番号表示段落 `id="issued-number"` 付近を特定する）の下に、待ち時間表示用の段落を1つ追加する。受付画面コンテナ内の番号表示段落の直後に以下を挿入する。

```html
    <p id="reception-wait"></p>
```

注: 受付画面の番号表示段落の正確な id 名が異なる場合は、その段落の直後に上記 `<p id="reception-wait"></p>` を置くこと。

- [ ] **Step 2: 発券ハンドラで待ち時間を表示**

発券ボタンのクリックハンドラ（`issueTicket(state, partySize, Date.now())` を `update(...)` に渡している箇所）を探す。`update(...)` で state を保存した後、新しい state から待ち時間を求めて表示する。該当ハンドラ内、番号を表示している行（`= state.lastIssued + '（' + partySize + '名）'` のような行）の後に以下を追加する。

```javascript
        document.getElementById('reception-wait').textContent =
          'お待ち時間 / Wait: ' + fmtWait(estimatedWaitMsForNew(state));
```

注: ここで参照する `state` は `update()` 適用後の最新 state であること。既存ハンドラが `update()` 後にローカル変数 `state` を更新していない場合は、`loadState()` で取得した最新 state を使うか、`update()` の戻り値/グローバル `state` を参照する既存パターンに合わせる。

- [ ] **Step 3: ブラウザで確認**

Run: `cd /Users/hasemasahiro/Desktop/seiriken-app && python3 -m http.server 8765` を起動し `http://localhost:8765/index.html` を開く。コンソールで `localStorage.removeItem('seiriken-state'); location.reload();` を実行して初期化。受付で発券を1回。
Expected: 番号の下に「お待ち時間 / Wait: 計測中 / Calculating」と表示される（案内実績がまだ無いため計測中）。

- [ ] **Step 4: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app
git add index.html
git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: show estimated wait on reception screen after issuing"
```

---

### Task 6: 呼び出し管理画面の各待機番号に予想待ち時間を表示

**Files:**
- Modify: `index.html`（待機列を描画する `renderAdminColumn` / `ticketLine` 付近）

待機ステータスの番号行に「(予想 約N分)」を追記する。待機列のみ。呼び出し中・完了列には付けない。

- [ ] **Step 1: 待機行に予想待ち時間テキストを追加**

`index.html` で待機列を描画している関数（`renderAdminColumn(elId, status)` と各行を作る `ticketLine(t)` を検索）を特定する。待機列（`status === 'waiting'`）の行を作る箇所で、番号テキストを入れている要素の後に予想待ち時間を表す要素を追加する。`ticketLine` が呼ばれている、または行 `<li>` を組み立てているループ内で、`status === 'waiting'` のときのみ以下のように span を追加する。

```javascript
          if (status === 'waiting') {
            const waitSpan = document.createElement('span');
            waitSpan.className = 'admin-wait';
            const ms = estimatedWaitMs(state, t.number);
            waitSpan.textContent =
              ms === null ? '（計測中）' : '（予想 約' + Math.max(1, Math.round(ms / 60000)) + '分）';
            li.appendChild(waitSpan);
          }
```

注: 行要素の変数名（上記 `li`）と番号要素の追加方法は既存 `renderAdminColumn`/`ticketLine` の実装に合わせる。番号テキスト要素 → 予想待ち時間 span → 操作ボタンの順に並ぶよう挿入位置を調整する。`state` は描画時点でアクセスできる最新 state を使う。

- [ ] **Step 2: ブラウザで確認**

Run: `http://localhost:8765/index.html` を開く。コンソールで `localStorage.removeItem('seiriken-state'); location.reload();`。受付で3回発券。呼び出し管理で番号1を「呼ぶ」→「完了」、番号2を「呼ぶ」。これで案内間隔の実績ができる。
Expected: 呼び出し管理の待機列（番号3）の横に「（予想 約N分）」が表示される。実績がまだ無い段階（誰も呼んでいない）では「（計測中）」。

- [ ] **Step 3: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app
git add index.html
git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: show per-ticket wait estimate in admin waiting list"
```

---

### Task 7: 呼び出し表示画面に目安待ち時間ボックスを追加

**Files:**
- Modify: `index.html`（呼び出し表示画面のHTML、および表示画面を描画する関数）

店頭ディスプレイに「目安待ち時間 / Estimated wait: 約N分」のボックスを追加。`estimatedWaitMsForNew(state)` を使い、storage イベント連動で自動更新する（既存の再描画フローに乗せる）。

- [ ] **Step 1: 表示用ボックスのHTMLを追加**

`index.html` の呼び出し表示画面コンテナ（`呼び出し表示` / `Display` の画面。`data-screen="display"` に対応するコンテナを検索）の中、既存の「呼び出し中／お待ちの番号」ボックスの上または下に以下を追加する。

```html
    <div id="display-wait-box" style="border:2px solid #333; border-radius:8px; padding:12px; margin:12px 0; text-align:center;">
      <div style="font-size:1.1rem;">目安待ち時間 / Estimated wait</div>
      <div id="display-wait" style="font-size:2rem; font-weight:bold;"></div>
    </div>
```

注: 既存の枠ボックスの style 付け方に合わせて調整してよい。重要なのは `id="display-wait"` の要素が存在すること。

- [ ] **Step 2: 表示画面の描画関数で待ち時間を更新**

`index.html` で呼び出し表示画面を描画している関数（待機・呼び出し中の番号リストを描いている関数。`data-screen="display"` 用の render 関数を検索）の中に、待ち時間を更新する行を追加する。その関数の末尾付近に以下を追加する。

```javascript
      const dw = document.getElementById('display-wait');
      if (dw) {
        const ms = estimatedWaitMsForNew(state);
        dw.textContent = ms === null ? '計測中 / Calculating' : '約 ' + Math.max(1, Math.round(ms / 60000)) + ' 分';
      }
```

注: `state` はその描画関数がアクセスしている最新 state を使う。storage イベントで全画面が再描画される既存フローにこの関数が含まれていれば、別タブ更新でも自動反映される。含まれていなければ、storage イベントハンドラがこの描画関数を呼ぶことを確認する。

- [ ] **Step 3: ブラウザで確認（別タブ連動含む）**

Run: `http://localhost:8765/index.html` を開く。コンソールで `localStorage.removeItem('seiriken-state'); location.reload();`。受付で3回発券、管理で番号1を呼ぶ→完了、番号2を呼ぶ（実績作成）。呼び出し表示画面に切り替える。
Expected: 「目安待ち時間 / Estimated wait」ボックスに「約 N 分」が表示される。別タブで表示画面を開き、もう一方のタブの管理画面で発券・呼び出しすると、表示画面の待ち時間が自動更新される。実績前は「計測中 / Calculating」。

- [ ] **Step 4: コミット**

```bash
cd /Users/hasemasahiro/Desktop/seiriken-app
git add index.html
git -c user.name="hasemasahiro" -c user.email="info@pathlyconsult.jp" commit -m "feat: show estimated wait box on display screen with live sync"
```

---

### Task 8: 全画面の総合動作確認

**Files:**
- 変更なし（検証のみ）

3画面すべてで予測待ち時間が正しく出ること、実績不足時に「計測中」になることを通しで確認する。

- [ ] **Step 1: テストランナーで純粋関数を再確認**

Run: `http://localhost:8765/queue.test.html` を開く。
Expected: 既存＋予測関数を含む全テストが PASS（緑のみ、赤なし）。

- [ ] **Step 2: 通し動作確認**

Run: `http://localhost:8765/index.html` を開き、コンソールで `localStorage.removeItem('seiriken-state'); location.reload();`。
手順: 受付で2名→発券、3名→発券、1名→発券（番号1〜3）。管理で番号1を「呼ぶ」→数秒後「完了」、番号2を「呼ぶ」。
Expected:
- 受付で次に発券すると「お待ち時間 / Wait: 約N分」が出る（計測中でなくなる）。
- 管理の待機列（番号3）に「（予想 約N分）」。
- 表示画面に「目安待ち時間 約N分」。

- [ ] **Step 3: 後片付け**

Run: ブラウザのコンソールで `localStorage.removeItem('seiriken-state');` を実行して検証データを消す。`python3 -m http.server 8765` を停止（`pkill -f "http.server 8765"`）。Playwright が生成した一時ファイル（`.playwright-mcp`、Desktop直下の `*.png`）があれば削除する。
Expected: 検証データ削除、サーバー停止完了。

- [ ] **Step 4: 確認のみのため追加コミットは不要**

このタスクはコード変更を含まないため、コミットは作成しない。
