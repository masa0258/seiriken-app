function initialState() {
  return { lastIssued: 0, nowCalling: 0, waiting: [] };
}

function issueTicket(state) {
  const next = state.lastIssued + 1;
  return {
    lastIssued: next,
    nowCalling: state.nowCalling,
    waiting: [...state.waiting, next],
  };
}

function callNext(state) {
  if (state.waiting.length === 0) {
    return { lastIssued: state.lastIssued, nowCalling: state.nowCalling, waiting: [...state.waiting] };
  }
  const [first, ...rest] = state.waiting;
  return { lastIssued: state.lastIssued, nowCalling: first, waiting: rest };
}

function resetState() {
  return initialState();
}
