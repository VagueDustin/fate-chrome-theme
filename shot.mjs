#!/usr/bin/env node
/**
 * Condition a screenshot for the Chrome Web Store listing.
 *
 * The store wants exactly 1280x800 or 640x400, JPEG or 24-bit PNG with NO
 * alpha channel. Windows capture tools happily hand you 1920x1080 RGBA, which
 * the upload then rejects on both counts. This scales to cover, centre-crops
 * to the exact size, flattens any alpha onto the theme's own base navy, and
 * writes a 24-bit PNG.
 *
 *   node shot.mjs capture.png
 *   node shot.mjs capture.png --size=640x400 --theme=gilded-fate
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng } from './lib/png.mjs';
import { hexToRgb, clamp } from './lib/paint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const input = argv.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('usage: node shot.mjs <capture.png> [--size=1280x800] [--theme=gold-navy]');
  process.exit(1);
}

const SIZES = { '1280x800': [1280, 800], '640x400': [640, 400] };
const sizeKey = flag('size', '1280x800');
if (!SIZES[sizeKey]) {
  console.error(`--size must be one of: ${Object.keys(SIZES).join(', ')}`);
  process.exit(1);
}
const [TW, TH] = SIZES[sizeKey];

const themeId = flag('theme', 'gold-navy');
const tokens = JSON.parse(readFileSync(join(HERE, 'brand', 'tokens.json'), 'utf8'));
const theme = tokens.themes[themeId];
if (!theme) {
  console.error(`Unknown theme "${themeId}". Available: ${Object.keys(tokens.themes).join(', ')}`);
  process.exit(1);
}
// Any transparency flattens onto the theme's own surface, never onto white.
const bg = hexToRgb(theme.tokens.surface.base);

const src = decodePng(readFileSync(input), bg);
const at = (x, y, k) => src.rgb[(y * src.w + x) * 3 + k];

// Scale to cover, then centre-crop — never distort the aspect ratio.
const scale = Math.max(TW / src.w, TH / src.h);
const offX = (src.w * scale - TW) / 2;
const offY = (src.h * scale - TH) / 2;

const out = new Uint8Array(TW * TH * 3);

for (let y = 0; y < TH; y++) {
  const sy0 = (y + offY) / scale;
  const sy1 = (y + 1 + offY) / scale;
  for (let x = 0; x < TW; x++) {
    const sx0 = (x + offX) / scale;
    const sx1 = (x + 1 + offX) / scale;
    const d = (y * TW + x) * 3;

    if (scale >= 1) {
      // Upscaling: box collapses to a point, so interpolate instead.
      const fx = clamp(sx0, 0, src.w - 1);
      const fy = clamp(sy0, 0, src.h - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(src.w - 1, x0 + 1);
      const y1 = Math.min(src.h - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      for (let k = 0; k < 3; k++) {
        const top = at(x0, y0, k) * (1 - tx) + at(x1, y0, k) * tx;
        const bot = at(x0, y1, k) * (1 - tx) + at(x1, y1, k) * tx;
        out[d + k] = Math.round(top * (1 - ty) + bot * ty);
      }
    } else {
      // Downscaling: average the source box so text stays readable.
      const x0 = Math.max(0, Math.floor(sx0));
      const x1 = Math.min(src.w, Math.ceil(sx1));
      const y0 = Math.max(0, Math.floor(sy0));
      const y1 = Math.min(src.h, Math.ceil(sy1));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          r += at(sx, sy, 0);
          g += at(sx, sy, 1);
          b += at(sx, sy, 2);
          n++;
        }
      }
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
    }
  }
}

const outDir = join(HERE, 'dist', 'store', 'screenshots');
mkdirSync(outDir, { recursive: true });
const stem = basename(input, extname(input));
const outPath = join(outDir, `${stem}-${sizeKey}.png`);
writeFileSync(outPath, encodePng(TW, TH, out));

const cropped = Math.round(offX) > 0 || Math.round(offY) > 0;
console.log(`${src.w}x${src.h} -> ${TW}x${TH}  (24-bit RGB, no alpha)`);
if (cropped) {
  console.log(`cropped ${Math.round(offX * 2)}px horizontally, ${Math.round(offY * 2)}px vertically`);
}
console.log(outPath.replace(HERE + '\\', '').replace(HERE + '/', ''));
