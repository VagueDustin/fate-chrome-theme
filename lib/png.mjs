/**
 * Minimal PNG encoder — 8-bit truecolour (RGB), adaptive scanline filtering.
 * Dependency-free: Node's zlib is the only thing doing real work.
 */
import { deflateSync } from 'node:zlib';
import { crc32 } from './crc32.mjs';

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
}

const BPP = 3;
const FILTERS = [0, 1, 2, 4]; // None, Sub, Up, Paeth

/**
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} rgb  w*h*3 bytes
 * @returns {Buffer} PNG file bytes
 */
export function encodePng(w, h, rgb) {
  const stride = w * BPP;
  const out = Buffer.alloc((stride + 1) * h);
  const prev = new Uint8Array(stride);
  const cand = FILTERS.map(() => new Uint8Array(stride));

  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestScore = Infinity;
    let bestBuf = cand[0];

    for (let ci = 0; ci < FILTERS.length; ci++) {
      const type = FILTERS[ci];
      const buf = cand[ci];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const left = i >= BPP ? row[i - BPP] : 0;
        const up = prev[i];
        const upLeft = i >= BPP ? prev[i - BPP] : 0;
        let v;
        if (type === 0) v = row[i];
        else if (type === 1) v = row[i] - left;
        else if (type === 2) v = row[i] - up;
        else {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          v = row[i] - pred;
        }
        v &= 0xff;
        buf[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        bestBuf = buf;
      }
    }

    out[y * (stride + 1)] = bestType;
    Buffer.from(bestBuf.buffer, bestBuf.byteOffset, stride).copy(out, y * (stride + 1) + 1);
    prev.set(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
