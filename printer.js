// ESC/POS バイト列生成（純粋関数・DOM非依存）

function concatBytes() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) total += arguments[i].length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < arguments.length; i++) {
    out.set(arguments[i], pos);
    pos += arguments[i].length;
  }
  return out;
}

function escposInit() {
  return new Uint8Array([0x1B, 0x40]); // ESC @
}

function escposFeed(n) {
  return new Uint8Array([0x1B, 0x64, n & 0xFF]); // ESC d n（n行送り）
}

function escposCut() {
  return new Uint8Array([0x1D, 0x56, 0x00]); // GS V 0（フルカット）
}
