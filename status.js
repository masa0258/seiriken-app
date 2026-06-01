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
