/**
 * Baseline JPEG decoder — enough to read source art, nothing more.
 *
 * Node ships no image decoding and this project has no dependencies, so this
 * exists for the same reason the PNG codec and the ZIP writer do. Scope is
 * deliberately narrow: baseline sequential (SOF0/SOF1), Huffman entropy
 * coding, any chroma subsampling, greyscale or YCbCr. Progressive JPEG and
 * arithmetic coding throw a clear error rather than failing quietly.
 */

export const ZIGZAG = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
]);

// COS[u * 8 + x] folds in the C(u)/2 normalisation, so a plain double sum
// over u and v is the full 2-D IDCT.
export const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) {
    COS[u * 8 + x] = 0.5 * (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}

/** Canonical Huffman table, in the spec's mincode/maxcode/valptr form. */
function buildHuffTable(bits, huffval) {
  const mincode = new Int32Array(17);
  const maxcode = new Int32Array(17).fill(-1);
  const valptr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    valptr[l] = k;
    mincode[l] = code;
    code += bits[l - 1];
    k += bits[l - 1];
    maxcode[l] = bits[l - 1] === 0 ? -1 : code - 1;
    code <<= 1;
  }
  return { mincode, maxcode, valptr, huffval };
}

export function decodeJpeg(buf) {
  let p = 2; // skip SOI
  const quant = [];
  const huffDC = [];
  const huffAC = [];
  let frame = null;
  let restartInterval = 0;

  const readU16 = (at) => (buf[at] << 8) | buf[at + 1];

  while (p < buf.length - 1) {
    if (buf[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = buf[p + 1];
    p += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
    if (p + 1 >= buf.length) break;

    const len = readU16(p);
    const seg = buf.subarray(p + 2, p + len);

    if (marker === 0xdb) {
      for (let i = 0; i < seg.length; ) {
        const pq = seg[i] >> 4;
        const tq = seg[i] & 15;
        i++;
        const table = new Int32Array(64);
        for (let k = 0; k < 64; k++) {
          // De-zigzag here so the table indexes naturally later.
          table[ZIGZAG[k]] = pq ? (seg[i + k * 2] << 8) | seg[i + k * 2 + 1] : seg[i + k];
        }
        i += pq ? 128 : 64;
        quant[tq] = table;
      }
    } else if (marker === 0xc4) {
      for (let i = 0; i < seg.length; ) {
        const tc = seg[i] >> 4;
        const th = seg[i] & 15;
        i++;
        const bits = seg.subarray(i, i + 16);
        i += 16;
        let total = 0;
        for (let b = 0; b < 16; b++) total += bits[b];
        const vals = seg.subarray(i, i + total);
        i += total;
        (tc === 0 ? huffDC : huffAC)[th] = buildHuffTable(bits, vals);
      }
    } else if (marker === 0xdd) {
      restartInterval = readU16(p + 2);
    } else if (marker === 0xc2 || marker === 0xc6 || marker === 0xca) {
      throw new Error('Progressive JPEG is not supported — re-export as baseline');
    } else if (marker === 0xc3 || (marker >= 0xc9 && marker <= 0xcf)) {
      throw new Error(`Unsupported JPEG encoding (marker 0x${marker.toString(16)})`);
    } else if (marker === 0xc0 || marker === 0xc1) {
      const h = readU16(p + 3);
      const w = readU16(p + 5);
      const n = seg[5];
      const components = [];
      let maxH = 1;
      let maxV = 1;
      for (let i = 0; i < n; i++) {
        const o = 6 + i * 3;
        const c = { id: seg[o], h: seg[o + 1] >> 4, v: seg[o + 1] & 15, tq: seg[o + 2] };
        maxH = Math.max(maxH, c.h);
        maxV = Math.max(maxV, c.v);
        components.push(c);
      }
      frame = { w, h, components, maxH, maxV };
      frame.mcusPerLine = Math.ceil(w / (8 * maxH));
      frame.mcusPerColumn = Math.ceil(h / (8 * maxV));
      for (const c of components) {
        c.planeW = frame.mcusPerLine * c.h * 8;
        c.planeH = frame.mcusPerColumn * c.v * 8;
        c.plane = new Uint8ClampedArray(c.planeW * c.planeH);
        c.pred = 0;
      }
    } else if (marker === 0xda) {
      if (!frame) throw new Error('JPEG scan before frame header');
      const n = seg[0];
      const scan = [];
      for (let i = 0; i < n; i++) {
        const id = seg[1 + i * 2];
        const tables = seg[2 + i * 2];
        const comp = frame.components.find((c) => c.id === id);
        if (!comp) throw new Error(`Scan references unknown component ${id}`);
        comp.dcTable = huffDC[tables >> 4];
        comp.acTable = huffAC[tables & 15];
        scan.push(comp);
      }
      p = decodeScan(buf, p + len, frame, scan, quant, restartInterval);
      continue;
    }

    p += len;
  }

  if (!frame) throw new Error('No JPEG frame header found');
  return toRgb(frame);
}

function decodeScan(buf, start, frame, scan, quant, restartInterval) {
  let p = start;
  let bitBuf = 0;
  let bitCount = 0;
  let eof = false;

  function nextBit() {
    if (bitCount === 0) {
      if (p >= buf.length) {
        eof = true;
        return 0;
      }
      let b = buf[p++];
      if (b === 0xff) {
        const next = buf[p];
        if (next === 0x00) {
          p++; // stuffed byte
        } else if (next >= 0xd0 && next <= 0xd7) {
          p++; // restart marker consumed by resetInterval
          b = buf[p++];
        } else {
          eof = true;
          p--;
          return 0;
        }
      }
      bitBuf = b;
      bitCount = 8;
    }
    bitCount--;
    return (bitBuf >> bitCount) & 1;
  }

  function decodeHuff(table) {
    if (!table) throw new Error('Missing Huffman table referenced by scan');
    let l = 1;
    let code = nextBit();
    while (l <= 16 && code > table.maxcode[l]) {
      code = (code << 1) | nextBit();
      l++;
    }
    if (l > 16) return 0;
    return table.huffval[table.valptr[l] + code - table.mincode[l]];
  }

  const receive = (n) => {
    let v = 0;
    while (n-- > 0) v = (v << 1) | nextBit();
    return v;
  };
  const extend = (v, n) => (n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v);

  const coefs = new Int32Array(64);
  const blk = new Float64Array(64);
  const tmp = new Float64Array(64);

  function decodeBlock(comp, bx, by) {
    coefs.fill(0);
    const t = decodeHuff(comp.dcTable);
    comp.pred += extend(receive(t), t);
    coefs[0] = comp.pred;

    let k = 1;
    while (k < 64) {
      const rs = decodeHuff(comp.acTable);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      coefs[ZIGZAG[k]] = extend(receive(s), s);
      k++;
    }

    idctBlock(comp, bx, by);
  }

  function idctBlock(comp, bx, by) {
    const q = quant[comp.tq];
    if (!q) throw new Error(`Missing quantisation table ${comp.tq}`);

    // Rows: g[v][x] = sum_u COS[u*8+x] * F[v*8+u]
    for (let v = 0; v < 8; v++) {
      const row = v * 8;
      let allZero = true;
      for (let u = 1; u < 8; u++) {
        if (coefs[row + u] !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) {
        // Flat row — very common in smooth artwork, and much cheaper.
        const dc = coefs[row] * q[row] * COS[0];
        for (let x = 0; x < 8; x++) tmp[row + x] = dc;
        continue;
      }
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let u = 0; u < 8; u++) sum += COS[u * 8 + x] * (coefs[row + u] * q[row + u]);
        tmp[row + x] = sum;
      }
    }

    // Columns: f[y][x] = sum_v COS[v*8+y] * g[v][x]
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        let sum = 0;
        for (let v = 0; v < 8; v++) sum += COS[v * 8 + y] * tmp[v * 8 + x];
        blk[y * 8 + x] = sum;
      }
    }

    const px0 = bx * 8;
    const py0 = by * 8;
    for (let y = 0; y < 8; y++) {
      const dst = (py0 + y) * comp.planeW + px0;
      for (let x = 0; x < 8; x++) comp.plane[dst + x] = blk[y * 8 + x] + 128;
    }
  }

  const single = scan.length === 1;
  const mcusPerLine = single
    ? Math.ceil((frame.w * scan[0].h) / frame.maxH / 8)
    : frame.mcusPerLine;
  const mcusPerColumn = single
    ? Math.ceil((frame.h * scan[0].v) / frame.maxV / 8)
    : frame.mcusPerColumn;

  const total = mcusPerLine * mcusPerColumn;
  const interval = restartInterval || total;
  let done = 0;

  while (done < total && !eof) {
    for (const c of scan) c.pred = 0;
    const end = Math.min(total, done + interval);

    for (let i = done; i < end; i++) {
      const row = (i / mcusPerLine) | 0;
      const col = i % mcusPerLine;
      if (single) {
        decodeBlock(scan[0], col, row);
      } else {
        for (const c of scan) {
          for (let v = 0; v < c.v; v++) {
            for (let h = 0; h < c.h; h++) {
              decodeBlock(c, col * c.h + h, row * c.v + v);
            }
          }
        }
      }
    }
    done = end;

    // Realign to the restart marker, if there is one.
    bitCount = 0;
    while (p < buf.length - 1) {
      if (buf[p] === 0xff && buf[p + 1] >= 0xd0 && buf[p + 1] <= 0xd7) {
        p += 2;
        break;
      }
      if (buf[p] === 0xff && buf[p + 1] !== 0x00) break;
      if (done >= total) break;
      p++;
    }
  }

  // Skip to the next marker for the caller.
  while (p < buf.length - 1 && !(buf[p] === 0xff && buf[p + 1] !== 0x00)) p++;
  return p;
}

function toRgb(frame) {
  const { w, h, components, maxH, maxV } = frame;
  const rgb = new Uint8Array(w * h * 3);

  if (components.length === 1) {
    const c = components[0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = c.plane[y * c.planeW + x];
        const d = (y * w + x) * 3;
        rgb[d] = v;
        rgb[d + 1] = v;
        rgb[d + 2] = v;
      }
    }
    return { w, h, rgb };
  }

  if (components.length !== 3) {
    throw new Error(`Unsupported JPEG component count: ${components.length}`);
  }

  const [Y, Cb, Cr] = components;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const yy = Y.plane[((y * Y.v) / maxV | 0) * Y.planeW + ((x * Y.h) / maxH | 0)];
      const cb = Cb.plane[((y * Cb.v) / maxV | 0) * Cb.planeW + ((x * Cb.h) / maxH | 0)] - 128;
      const cr = Cr.plane[((y * Cr.v) / maxV | 0) * Cr.planeW + ((x * Cr.h) / maxH | 0)] - 128;
      const d = (y * w + x) * 3;
      const r = yy + 1.402 * cr;
      const g = yy - 0.344136 * cb - 0.714136 * cr;
      const b = yy + 1.772 * cb;
      rgb[d] = r < 0 ? 0 : r > 255 ? 255 : r;
      rgb[d + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      rgb[d + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }

  return { w, h, rgb };
}

/** Dimensions only, without decoding the entropy data. */
export function jpegSize(buf) {
  let p = 2;
  while (p < buf.length - 1) {
    if (buf[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = buf[p + 1];
    p += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (buf[p] << 8) | buf[p + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: (buf[p + 5] << 8) | buf[p + 6], h: (buf[p + 3] << 8) | buf[p + 4] };
    }
    p += len;
  }
  throw new Error('No JPEG frame header found');
}
