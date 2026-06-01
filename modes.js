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
