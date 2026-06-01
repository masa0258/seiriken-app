function initialState() {
  return { lastIssued: 0, waiting: [], calling: [], done: [] };
}

function cloneState(state) {
  return {
    lastIssued: state.lastIssued,
    waiting: [...state.waiting],
    calling: [...state.calling],
    done: [...state.done],
  };
}

function issueTicket(state) {
  const next = state.lastIssued + 1;
  const s = cloneState(state);
  s.lastIssued = next;
  s.waiting = [...s.waiting, next];
  return s;
}

function callTicket(state, number) {
  if (!state.waiting.includes(number)) return cloneState(state);
  const s = cloneState(state);
  s.waiting = s.waiting.filter((n) => n !== number);
  s.calling = [...s.calling, number];
  return s;
}

function completeTicket(state, number) {
  if (!state.calling.includes(number)) return cloneState(state);
  const s = cloneState(state);
  s.calling = s.calling.filter((n) => n !== number);
  s.done = [...s.done, number];
  return s;
}

function backToWaiting(state, number) {
  if (!state.calling.includes(number)) return cloneState(state);
  const s = cloneState(state);
  s.calling = s.calling.filter((n) => n !== number);
  s.waiting = [...s.waiting, number].sort((a, b) => a - b);
  return s;
}

function recallTicket(state, number) {
  if (!state.done.includes(number)) return cloneState(state);
  const s = cloneState(state);
  s.done = s.done.filter((n) => n !== number);
  s.calling = [...s.calling, number];
  return s;
}

function resetState() {
  return initialState();
}
