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

// ネイティブQR命令（GS ( k）。opts.size 既定6（1-16）、opts.ec 既定'M'（'L'|'M'|'Q'|'H'）
function escposQR(text, opts) {
  opts = opts || {};
  const size = opts.size || 6;
  const ecMap = { L: 48, M: 49, Q: 50, H: 51 };
  const ec = ecMap[opts.ec] || ecMap.M;
  const data = new TextEncoder().encode(text);

  const model = new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
  const cell = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size & 0xFF]);
  const level = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, ec]);

  const storeLen = data.length + 3;
  const storeHeader = new Uint8Array([0x1D, 0x28, 0x6B, storeLen & 0xFF, (storeLen >> 8) & 0xFF, 0x31, 0x50, 0x30]);
  const store = concatBytes(storeHeader, data);

  const print = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);

  return concatBytes(model, cell, level, store, print);
}

// RGBA画素（{width,height,data}）を1bppモノクロビットマップに変換する。
// 輝度 < threshold かつ alpha>=128 を黒（ビット1, MSB先頭）。行はバイト境界に詰める。
function imageDataToMonoBitmap(imageData, threshold) {
  if (threshold === undefined) threshold = 128;
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data;
  const stride = Math.ceil(width / 8);
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const black = a >= 128 && lum < threshold;
      if (black) {
        out[y * stride + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }
  return { width: width, height: height, data: out };
}
