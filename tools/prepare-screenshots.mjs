#!/usr/bin/env node
/**
 * One-off conditioning for the README screenshots.
 *
 * Captures are not derived from source art, so they are committed rather than
 * rebuilt; this script exists to record exactly what was done to them:
 * crop a trailing strip, scale to a sane width, re-encode.
 *
 *   node tools/prepare-screenshots.mjs <capture.jpg> docs/screenshot-x.jpg [--crop-bottom=60]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJpeg } from '../lib/jpeg.mjs';
import { encodeJpeg } from '../lib/jpeg-encode.mjs';
import { decodePng } from '../lib/png.mjs';
import { Canvas, downsample } from '../lib/paint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const positional = argv.filter((a) => !a.startsWith('--'));
const [input, output] = positional;

if (!input || !output) {
  console.error('usage: node tools/prepare-screenshots.mjs <in> <out> [--crop-bottom=N] [--width=N]');
  process.exit(1);
}

const cropBottom = Number(flag('crop-bottom', 0));
const targetWidth = Number(flag('width', 1600));

const bytes = readFileSync(input);
const src = bytes[0] === 0xff && bytes[1] === 0xd8 ? decodeJpeg(bytes) : decodePng(bytes);

const keepH = src.h - cropBottom;
const cropped = new Canvas(src.w, keepH, [0, 0, 0]);
for (let y = 0; y < keepH; y++) {
  for (let x = 0; x < src.w; x++) {
    const s = (y * src.w + x) * 3;
    const d = (y * src.w + x) * 3;
    cropped.px[d] = src.rgb[s];
    cropped.px[d + 1] = src.rgb[s + 1];
    cropped.px[d + 2] = src.rgb[s + 2];
  }
}

const scale = Math.min(1, targetWidth / src.w);
const outW = Math.round(src.w * scale);
const outH = Math.round(keepH * scale);
const final = scale < 1 ? downsample(cropped, outW, outH) : cropped;

const outPath = join(HERE, '..', output);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, encodeJpeg(outW, outH, final.toBytes(), 88));

console.log(`${src.w}x${src.h} -> ${outW}x${outH}  (cropped ${cropBottom}px)  ${output}`);
