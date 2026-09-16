#!/usr/bin/env node
/**
 * Condition a screenshot for the Chrome Web Store listing.
 *
 * The store wants exactly 1280x800 or 640x400, JPEG or 24-bit PNG with NO
 * alpha channel. Windows capture tools happily hand you 1920x1080 RGBA, which
 * the upload then rejects on both counts. This scales to cover, centre-crops to
 * the exact size, flattens any alpha onto the theme's own base navy, and writes
 * a 24-bit PNG.
 *
 *   node shot.mjs capture.png
 *   node shot.mjs capture.png --size=640x400
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng } from './lib/png.mjs';
import { hexToRgb } from './lib/paint.mjs';
import { coverResize } from './lib/resample.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const input = argv.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('usage: node shot.mjs <capture.png> [--size=1280x800] [--theme=gilded-fate]');
  process.exit(1);
}

const SIZES = { '1280x800': [1280, 800], '640x400': [640, 400] };
const sizeKey = flag('size', '1280x800');
if (!SIZES[sizeKey]) {
  console.error(`--size must be one of: ${Object.keys(SIZES).join(', ')}`);
  process.exit(1);
}
const [TW, TH] = SIZES[sizeKey];

const themeId = flag('theme', 'gilded-fate');
const tokens = JSON.parse(readFileSync(join(HERE, 'brand', 'tokens.json'), 'utf8'));
const theme = tokens.themes[themeId];
if (!theme) {
  console.error(`Unknown theme "${themeId}". Available: ${Object.keys(tokens.themes).join(', ')}`);
  process.exit(1);
}
// Any transparency flattens onto the theme's own surface, never onto white.
const src = decodePng(readFileSync(input), hexToRgb(theme.tokens.surface.base));
const out = coverResize(src, TW, TH);

const outDir = join(HERE, 'dist', 'store', 'screenshots');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${basename(input, extname(input))}-${sizeKey}.png`);
writeFileSync(outPath, encodePng(TW, TH, out.toBytes()));

const scale = Math.max(TW / src.w, TH / src.h);
const cropX = Math.round(src.w * scale - TW);
const cropY = Math.round(src.h * scale - TH);

console.log(`${src.w}x${src.h} -> ${TW}x${TH}  (24-bit RGB, no alpha)`);
if (cropX > 0 || cropY > 0) console.log(`cropped ${cropX}px horizontally, ${cropY}px vertically`);
console.log(outPath.replace(HERE + '\\', '').replace(HERE + '/', ''));
