/**
 * Baseline JPEG encoder, 4:2:0, standard Annex K tables.
 *
 * Counterpart to the decoder in `jpeg.mjs`, and here for a concrete reason:
 * Chrome places `theme_ntp_background` at its natural size and never scales it,
 * so oversized source art has to be resampled, and re-encoding a starfield as
 * PNG costs several megabytes where JPEG costs a few hundred kilobytes.
 */
import { ZIGZAG, COS } from './jpeg.mjs';

const STD_Q_LUMA = new Int32Array([
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
]);

const STD_Q_CHROMA = new Int32Array([
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
]);

const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

function buildEncTable(bits, vals) {
  const codes = new Int32Array(256);
  const lens = new Int32Array(256);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < bits[l - 1]; i++) {
      codes[vals[k]] = code;
      lens[vals[k]] = l;
      code++;
      k++;
    }
    code <<= 1;
  }
  return { codes, lens };
}

/** libjpeg's quality scaling. */
function scaleQuant(base, quality) {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  const out = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    out[i] = Math.max(1, Math.min(255, Math.floor((base[i] * scale + 50) / 100)));
  }
  return out;
}

const category = (v) => {
  let a = v < 0 ? -v : v;
  let n = 0;
  while (a) {
    n++;
    a >>= 1;
  }
  return n;
};

/**
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} rgb  w*h*3
 * @param {number} [quality] 1-100, default 90
 * @returns {Buffer}
 */
export function encodeJpeg(w, h, rgb, quality = 90) {
  const qLuma = scaleQuant(STD_Q_LUMA, quality);
  const qChroma = scaleQuant(STD_Q_CHROMA, quality);
  const dcLuma = buildEncTable(DC_LUMA_BITS, DC_VALS);
  const dcChroma = buildEncTable(DC_CHROMA_BITS, DC_VALS);
  const acLuma = buildEncTable(AC_LUMA_BITS, AC_LUMA_VALS);
  const acChroma = buildEncTable(AC_CHROMA_BITS, AC_CHROMA_VALS);

  // Full-resolution luma, box-averaged half-resolution chroma (4:2:0).
  const cw = (w + 1) >> 1;
  const chh = (h + 1) >> 1;
  const Y = new Float32Array(w * h);
  const Cb = new Float32Array(cw * chh);
  const Cr = new Float32Array(cw * chh);
  const cCount = new Uint16Array(cw * chh);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      Y[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      const ci = (y >> 1) * cw + (x >> 1);
      Cb[ci] += -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
      Cr[ci] += 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
      cCount[ci]++;
    }
  }
  for (let i = 0; i < Cb.length; i++) {
    const n = cCount[i] || 1;
    Cb[i] /= n;
    Cr[i] /= n;
  }

  // --- output buffer and bit writer (with 0xFF byte stuffing) ---
  let out = Buffer.alloc(1 << 20);
  let len = 0;
  const push = (b) => {
    if (len + 2 > out.length) {
      const bigger = Buffer.alloc(out.length * 2);
      out.copy(bigger, 0, 0, len);
      out = bigger;
    }
    out[len++] = b;
  };
  const pushBytes = (...bs) => {
    for (const b of bs) push(b);
  };
  const pushU16 = (v) => {
    push((v >> 8) & 0xff);
    push(v & 0xff);
  };

  let bitBuf = 0;
  let bitCnt = 0;
  function writeBits(code, n) {
    for (let i = n - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((code >> i) & 1);
      if (++bitCnt === 8) {
        const byte = bitBuf & 0xff;
        push(byte);
        if (byte === 0xff) push(0x00);
        bitBuf = 0;
        bitCnt = 0;
      }
    }
  }
  const flushBits = () => {
    while (bitCnt) writeBits(1, 1);
  };

  // --- headers ---
  pushBytes(0xff, 0xd8); // SOI
  pushBytes(0xff, 0xe0); // APP0 / JFIF
  pushU16(16);
  pushBytes(0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);

  const writeDQT = (id, table) => {
    pushBytes(0xff, 0xdb);
    pushU16(67);
    push(id);
    for (let k = 0; k < 64; k++) push(table[ZIGZAG[k]]);
  };
  writeDQT(0, qLuma);
  writeDQT(1, qChroma);

  pushBytes(0xff, 0xc0); // SOF0
  pushU16(17);
  push(8);
  pushU16(h);
  pushU16(w);
  push(3);
  pushBytes(1, 0x22, 0); // Y, 2x2 sampling, quant table 0
  pushBytes(2, 0x11, 1);
  pushBytes(3, 0x11, 1);

  const writeDHT = (cls, id, bits, vals) => {
    pushBytes(0xff, 0xc4);
    pushU16(19 + vals.length);
    push((cls << 4) | id);
    for (let i = 0; i < 16; i++) push(bits[i]);
    for (const v of vals) push(v);
  };
  writeDHT(0, 0, DC_LUMA_BITS, DC_VALS);
  writeDHT(1, 0, AC_LUMA_BITS, AC_LUMA_VALS);
  writeDHT(0, 1, DC_CHROMA_BITS, DC_VALS);
  writeDHT(1, 1, AC_CHROMA_BITS, AC_CHROMA_VALS);

  pushBytes(0xff, 0xda); // SOS
  pushU16(12);
  push(3);
  pushBytes(1, 0x00, 2, 0x11, 3, 0x11);
  pushBytes(0, 63, 0);

  // --- entropy-coded data ---
  const blk = new Float64Array(64);
  const tmp = new Float64Array(64);
  const zz = new Int32Array(64);

  function encodeBlock(plane, pw, ph, bx, by, q, dcTab, acTab, prevDC) {
    // Edge replication on partial blocks, so the right and bottom margins do
    // not ring against whatever happens to be in memory.
    for (let y = 0; y < 8; y++) {
      const sy = Math.min(ph - 1, by + y);
      for (let x = 0; x < 8; x++) {
        const sx = Math.min(pw - 1, bx + x);
        blk[y * 8 + x] = plane[sy * pw + sx] - 128;
      }
    }

    // Forward DCT. The same COS table serves both directions because it folds
    // in the C(u)/2 normalisation.
    for (let v = 0; v < 8; v++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let y = 0; y < 8; y++) sum += COS[v * 8 + y] * blk[y * 8 + x];
        tmp[v * 8 + x] = sum;
      }
    }
    for (let v = 0; v < 8; v++) {
      for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let x = 0; x < 8; x++) sum += COS[u * 8 + x] * tmp[v * 8 + x];
        blk[v * 8 + u] = sum / q[v * 8 + u];
      }
    }
    for (let k = 0; k < 64; k++) zz[k] = Math.round(blk[ZIGZAG[k]]);

    const diff = zz[0] - prevDC;
    const n = category(diff);
    writeBits(dcTab.codes[n], dcTab.lens[n]);
    if (n) writeBits(diff < 0 ? diff + (1 << n) - 1 : diff, n);

    let run = 0;
    for (let k = 1; k < 64; k++) {
      if (zz[k] === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        writeBits(acTab.codes[0xf0], acTab.lens[0xf0]); // ZRL
        run -= 16;
      }
      const s = category(zz[k]);
      writeBits(acTab.codes[(run << 4) | s], acTab.lens[(run << 4) | s]);
      writeBits(zz[k] < 0 ? zz[k] + (1 << s) - 1 : zz[k], s);
      run = 0;
    }
    if (run > 0) writeBits(acTab.codes[0], acTab.lens[0]); // EOB

    return zz[0];
  }

  const mcusX = Math.ceil(w / 16);
  const mcusY = Math.ceil(h / 16);
  let predY = 0;
  let predCb = 0;
  let predCr = 0;

  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      for (let by = 0; by < 2; by++) {
        for (let bx = 0; bx < 2; bx++) {
          predY = encodeBlock(
            Y, w, h, mx * 16 + bx * 8, my * 16 + by * 8, qLuma, dcLuma, acLuma, predY,
          );
        }
      }
      predCb = encodeBlock(Cb, cw, chh, mx * 8, my * 8, qChroma, dcChroma, acChroma, predCb);
      predCr = encodeBlock(Cr, cw, chh, mx * 8, my * 8, qChroma, dcChroma, acChroma, predCr);
    }
  }

  flushBits();
  pushBytes(0xff, 0xd9); // EOI

  return Buffer.from(out.subarray(0, len));
}
