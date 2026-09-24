/**
 * Minimal PNG encoder: 8-bit truecolour (RGB), adaptive scanline filtering.
 * Dependency-free: Node's zlib is the only thing doing real work.
 */
import { deflateSync, inflateSync } from 'node:zlib';
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

/**
 * Decode an 8-bit non-interlaced PNG to flat RGB, dropping any alpha by
 * compositing onto `background`. Covers colour types 2 (RGB) and 6 (RGBA),
 * which is what every Windows screenshot tool produces.
 *
 * @returns {{w: number, h: number, rgb: Uint8Array}}
 */
export function decodePng(buf, background = [0, 0, 0]) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG file');

  let p = 8;
  let w = 0;
  let h = 0;
  let colorType = -1;
  const idat = [];

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`Unsupported bit depth ${data[8]} (need 8)`);
      colorType = data[9];
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }

  const channels = { 2: 3, 6: 4 }[colorType];
  if (!channels) {
    throw new Error(
      `Unsupported PNG colour type ${colorType}; re-save as RGB or RGBA (not palette/greyscale)`,
    );
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const rgb = new Uint8Array(w * h * 3);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? cur[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let v = row[i];
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) {
        const pp = left + up - upLeft;
        const pa = Math.abs(pp - left);
        const pb = Math.abs(pp - up);
        const pc = Math.abs(pp - upLeft);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * channels;
      const d = (y * w + x) * 3;
      const a = channels === 4 ? cur[s + 3] / 255 : 1;
      for (let k = 0; k < 3; k++) {
        rgb[d + k] = Math.round(cur[s + k] * a + background[k] * (1 - a));
      }
    }
    prev.set(cur);
  }

  return { w, h, rgb };
}
