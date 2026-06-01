function pad2(n) {
  return String(n).padStart(2, '0');
}

function initialState() {
  return { lastIssued: 0, tickets: [] };
}

function cloneState(state) {
  return { lastIssued: state.lastIssued, tickets: state.tickets.map((t) => ({ ...t })) };
}

function findTicket(state, number) {
  return state.tickets.find((t) => t.number === number);
}

function patchTicket(state, number, changes) {
  return {
    lastIssued: state.lastIssued,
    tickets: state.tickets.map((t) => (t.number === number ? { ...t, ...changes } : { ...t })),
  };
}

function issueTicket(state, partySize, now) {
  const next = state.lastIssued + 1;
  const ticket = {
    number: next,
    partySize: partySize,
    status: 'waiting',
    issuedAt: now,
    calledAt: null,
    completedAt: null,
  };
  return { lastIssued: next, tickets: [...state.tickets.map((t) => ({ ...t })), ticket] };
}

function callTicket(state, number, now) {
  const t = findTicket(state, number);
  if (!t || t.status !== 'waiting') return cloneState(state);
  return patchTicket(state, number, { status: 'calling', calledAt: now });
}

function completeTicket(state, number, now) {
  const t = findTicket(state, number);
  if (!t || t.status !== 'calling') return cloneState(state);
  return patchTicket(state, number, { status: 'done', completedAt: now });
}

function backToWaiting(state, number) {
  const t = findTicket(state, number);
  if (!t || t.status !== 'calling') return cloneState(state);
  return patchTicket(state, number, { status: 'waiting', calledAt: null });
}

function recallTicket(state, number) {
  const t = findTicket(state, number);
  if (!t || t.status !== 'done') return cloneState(state);
  return patchTicket(state, number, { status: 'calling', completedAt: null });
}

function resetState() {
  return initialState();
}

function ticketsByStatus(state, status) {
  return state.tickets.filter((t) => t.status === status).sort((a, b) => a.number - b.number);
}

function hourlySummary(state) {
  const buckets = {};
  state.tickets.forEach((t) => {
    const d = new Date(t.issuedAt);
    const key = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '-' + pad2(d.getHours());
    if (!buckets[key]) {
      buckets[key] = {
        key: key,
        label: (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + '時台',
        groups: 0,
        guests: 0,
      };
    }
    buckets[key].groups += 1;
    buckets[key].guests += t.partySize;
  });
  return Object.values(buckets).sort((a, b) => (a.key < b.key ? -1 : 1));
}

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

function estimatedWaitMs(state, number, sampleSize = 5) {
  const interval = averageServeInterval(state, sampleSize);
  if (interval === null) return null;
  const ahead = state.tickets.filter(
    (t) => t.status === 'waiting' && t.number < number
  ).length;
  return interval * (ahead + 1);
}

function estimatedWaitMsForNew(state, sampleSize = 5) {
  const interval = averageServeInterval(state, sampleSize);
  if (interval === null) return null;
  const waitingCount = state.tickets.filter((t) => t.status === 'waiting').length;
  return interval * (waitingCount + 1);
}
