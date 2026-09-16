#!/usr/bin/env node
/**
 * FATE — Chrome theme build.
 *
 * Two inputs, nothing invented from either:
 *
 *   Colour   the canonical brand tokens. No house hex is written in this file;
 *            it consumes semantic roles (surface.raised, accent.default,
 *            text.faint) so a retune of the brand package flows straight
 *            through to every Chrome surface.
 *   Artwork  the source art in this directory. Per the brand repo's rule —
 *            derive, never improvise — the new tab page, icons and promo tiles
 *            are all conditioned from those files by a recorded step rather
 *            than drawn here.
 *
 *   node build.mjs
 *   node build.mjs --brand=../vaguedustin-brand
 *   node build.mjs --theme=gold-navy --version=1.2.0
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng } from './lib/png.mjs';
import { decodeJpeg } from './lib/jpeg.mjs';
import { encodeJpeg } from './lib/jpeg-encode.mjs';
import { Canvas, verticalStrip, downsample, hexToRgb, mix, clamp } from './lib/paint.mjs';
import { coverResize } from './lib/resample.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// ------------------------------------------------------------ source art ----

const ART = {
  wallpaper: 'fate-chrome-theme-wallpaper.png',
  icon: 'fate-chrome-theme-icon.png',
};

// Chrome places theme_ntp_background at its natural size and never scales it,
// so the source art IS the final pixel grid and the build never resamples it.
// Past roughly this size Chrome crops rather than fits, so the build says so
// instead of silently deciding for you.
const NTP_ADVISORY = { w: 2560, h: 1440 };
const JPEG_QUALITY = 92;

const ICON_SIZES = [16, 32, 48, 128];
const PROMO_TILES = {
  // The wallpaper's interesting detail sits around its edges and its centre is
  // deliberately calm, so the tiles crop from the upper band rather than dead
  // centre — otherwise a tile is mostly empty navy.
  'promo-small-440x280': { w: 440, h: 280, focusY: 0.34 },
  'promo-marquee-1400x560': { w: 1400, h: 560, focusY: 0.4 },
};

const STRIP_W = 64; // uniform across x, so Chrome tiles it without a seam
const STRIP_H = 160; // taller than any Chrome frame or toolbar band

/** Load source art as flat RGB, dispatching on file type. */
function loadArt(key) {
  const name = ART[key];
  const path = join(HERE, name);
  if (!existsSync(path)) {
    throw new Error(`Missing source art: ${name}\nExpected it in ${HERE}. See README -> Source art.`);
  }
  const bytes = readFileSync(path);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const image = isJpeg ? decodeJpeg(bytes) : decodePng(bytes);
  return { name, bytes, image, isJpeg };
}

// ---------------------------------------------------------------- tokens ----

function loadTokens() {
  const explicit = arg('brand', null);
  const candidates = [];
  if (explicit) {
    const p = resolve(HERE, explicit);
    candidates.push(p.endsWith('.json') ? p : join(p, 'dist', 'tokens.json'), join(p, 'tokens.json'));
  }
  candidates.push(
    join(HERE, 'node_modules', '@vaguedustin', 'brand', 'dist', 'tokens.json'),
    join(HERE, 'brand', 'tokens.json'),
  );
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) {
      return { tokens: JSON.parse(readFileSync(c, 'utf8')), source: c };
    }
  }
  throw new Error(`No brand tokens found. Looked in:\n  ${candidates.join('\n  ')}`);
}

/** `rgba(212,175,55,0.12)` -> { rgb: [212,175,55], a: 0.12 } */
function parseRgba(str) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(str);
  if (!m) throw new Error(`Cannot parse colour: ${str}`);
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
}

// --------------------------------------------------------------- artwork ----

/**
 * Frame, toolbar and inactive-tab strips. These stay generated: they are pure
 * token gradients, and Chrome tiles them, so they must be uniform across x.
 */
function renderStrips(theme, prim) {
  const t = theme.tokens;
  const frame = hexToRgb(t.surface.sunken);
  const toolbar = hexToRgb(t.surface.raised);
  const base = hexToRgb(t.surface.base);
  const black = [0, 0, 0];
  const gold300 = hexToRgb(prim.gold['300']);

  const frameStrip = (dim) =>
    verticalStrip(STRIP_W, STRIP_H, [
      [0, mix(mix(frame, black, 0.45), black, dim)],
      [1, mix(frame, black, dim)],
    ]);

  const toolbarStrip = verticalStrip(STRIP_W, STRIP_H, [
    [0, toolbar],
    [0.55, mix(toolbar, base, 0.45)],
    [1, mix(toolbar, base, 0.6)],
  ]);
  // `inset 0 1px 0 rgba(255,233,168,0.08)` from the gilded panel shadow — the
  // stroke that makes a dark surface read as gilded rather than merely dark.
  for (let x = 0; x < STRIP_W; x++) toolbarStrip.blend(x, 0, gold300, 0.08);

  const tabStrip = verticalStrip(STRIP_W, STRIP_H, [
    [0, mix(frame, toolbar, 0.16)],
    [1, mix(frame, toolbar, 0.42)],
  ]);

  return {
    'theme_frame.png': frameStrip(0),
    'theme_frame_inactive.png': frameStrip(0.32),
    'theme_frame_incognito.png': frameStrip(0.55),
    'theme_frame_incognito_inactive.png': frameStrip(0.68),
    'theme_toolbar.png': toolbarStrip,
    'theme_tab_background.png': tabStrip,
  };
}

// -------------------------------------------------------------- manifest ----

const toChrome = (rgb) => rgb.map((v) => Math.round(clamp(v, 0, 255)));

function buildColors(theme) {
  const t = theme.tokens;
  const frame = hexToRgb(t.surface.sunken);
  const toolbar = hexToRgb(t.surface.raised);
  const black = [0, 0, 0];
  const accentSubtle = parseRgba(t.accent.subtle);

  return {
    // Window frame — the deepest surface in the system.
    frame: toChrome(frame),
    frame_inactive: toChrome(mix(frame, black, 0.32)),
    frame_incognito: toChrome(mix(frame, black, 0.55)),
    frame_incognito_inactive: toChrome(mix(frame, black, 0.68)),

    // The toolbar colour doubles as the active tab fill, so it takes the
    // raised surface and the active tab reads as lifted out of the frame.
    toolbar: toChrome(toolbar),
    tab_text: toChrome(hexToRgb(t.text.primary)),
    tab_background_text: toChrome(hexToRgb(t.text.muted)),
    tab_background_text_inactive: toChrome(hexToRgb(t.text.faint)),
    bookmark_text: toChrome(hexToRgb(t.text.muted)),

    // Gold means interactive or brand, nothing else (AGENTS.md §2.3) — so it
    // lands on the toolbar controls and new-tab links, never on body text.
    toolbar_button_icon: toChrome(hexToRgb(t.accent.default)),
    button_background: [...toChrome(accentSubtle.rgb), accentSubtle.a],

    omnibox_background: toChrome(hexToRgb(t.surface.overlay)),
    omnibox_text: toChrome(hexToRgb(t.text.primary)),

    // The wallpaper's own edges average #020613, so this fill meets them
    // invisibly on screens wider or taller than the art.
    ntp_background: toChrome(hexToRgb(t.surface.base)),
    ntp_text: toChrome(hexToRgb(t.text.primary)),
    ntp_link: toChrome(hexToRgb(t.accent.default)),
  };
}

// The Web Store rejects an upload whose manifest description exceeds 132
// characters, and it only tells you at upload time.
const DESCRIPTION_LIMIT = 132;
const DESCRIPTION =
  'Deep navy and metallic gold across every Chrome surface. Constellations, ' +
  'nebula, a gilded crescent — the thread is in motion.';

// ------------------------------------------------------------------ main ----

const { tokens, source } = loadTokens();
const prim = tokens.primitives;
const themeId = arg('theme', 'gilded-fate');
const version = arg('version', '1.0.0');

const theme = tokens.themes[themeId];
if (!theme) {
  throw new Error(`Unknown theme "${themeId}". Available: ${Object.keys(tokens.themes).join(', ')}`);
}

// Fail here rather than at the upload dialog.
if (DESCRIPTION.length > DESCRIPTION_LIMIT) {
  throw new Error(
    `manifest description is ${DESCRIPTION.length} characters; the Chrome Web Store ` +
      `limit is ${DESCRIPTION_LIMIT}. Shorten DESCRIPTION in build.mjs.`,
  );
}
const tier = tokens.tiers[theme.tier];

console.log(`brand tokens : ${relative(HERE, source) || source}`);
console.log(`theme        : ${theme.name} (${themeId}), ${tier.name} tier`);
console.log('');

const distRoot = join(HERE, 'dist');
if (existsSync(distRoot)) rmSync(distRoot, { recursive: true });

const outDir = join(distRoot, 'fate-chrome-theme');
const imgDir = join(outDir, 'images');
const iconDir = join(outDir, 'icons');
mkdirSync(imgDir, { recursive: true });
mkdirSync(iconDir, { recursive: true });

const images = {};
let bytes = 0;

// Token-derived chrome strips.
for (const [name, canvas] of Object.entries(renderStrips(theme, prim))) {
  const png = encodePng(canvas.w, canvas.h, canvas.toBytes());
  writeFileSync(join(imgDir, name), png);
  images[name.replace(/\.png$/, '')] = `images/${name}`;
  bytes += png.length;
}

// New tab page.
//
// Theme images must be PNG — Chrome's own docs say a non-PNG "will not render
// properly" (crbug.com/1200459) — so a JPEG source is converted rather than
// passed through. Otherwise the art is left exactly as authored: native size,
// no resampling, lossless re-encode, and whichever encoding is smaller wins.
//
// `--ntp=WxH` opts into resampling, for retargeting one high-resolution master
// at a specific screen. It is never automatic: Chrome crops rather than fits,
// so the right size is an art decision, not something the build should guess.
const wallpaperArt = loadArt('wallpaper');
let wallpaper = wallpaperArt.image;
let ntpNote;

const ntpOverride = arg('ntp', null);
if (ntpOverride) {
  const m = /^(\d+)x(\d+)$/.exec(ntpOverride);
  if (!m) throw new Error(`--ntp must look like 3440x1440, got "${ntpOverride}"`);
  const [tw, th] = [+m[1], +m[2]];
  const src = wallpaperArt.image;
  const fitted = coverResize(wallpaper, tw, th);
  wallpaper = { w: tw, h: th, rgb: fitted.toBytes() };
  const upscaling = tw > src.w || th > src.h;
  ntpNote =
    `${src.w}x${src.h} -> ${tw}x${th}, resampled` + (upscaling ? ' (UPSCALED — softer)' : '');
}

const reencoded = encodePng(wallpaper.w, wallpaper.h, wallpaper.rgb);
const keepOriginal = !ntpOverride && !wallpaperArt.isJpeg && wallpaperArt.bytes.length <= reencoded.length;
const ntpBytes = keepOriginal ? wallpaperArt.bytes : reencoded;
if (!ntpNote) {
  const dims = `${wallpaper.w}x${wallpaper.h} native`;
  if (wallpaperArt.isJpeg) ntpNote = `${dims}, JPEG source converted to PNG (Chrome requires PNG)`;
  else ntpNote = `${dims}, ${keepOriginal ? 'shipped verbatim' : 'losslessly re-encoded, smaller'}`;
}
writeFileSync(join(imgDir, 'theme_ntp_background.png'), ntpBytes);
images.theme_ntp_background = 'images/theme_ntp_background.png';
bytes += ntpBytes.length;

// Icons, downsampled from the source mark. PNG here — a 128px crest needs
// crisp edges, and at this size the file is tiny either way.
const iconArt = loadArt('icon');
const iconSrc = iconArt.image;
const iconCanvas = new Canvas(iconSrc.w, iconSrc.h, [0, 0, 0]);
for (let i = 0; i < iconSrc.rgb.length; i++) iconCanvas.px[i] = iconSrc.rgb[i];

const icons = {};
for (const size of ICON_SIZES) {
  const shrunk = downsample(iconCanvas, size, size);
  const png = encodePng(size, size, shrunk.toBytes());
  writeFileSync(join(iconDir, `icon-${size}.png`), png);
  icons[size] = `icons/icon-${size}.png`;
  bytes += png.length;
}

const manifest = {
  manifest_version: 3,
  name: 'FATE',
  version,
  description: DESCRIPTION,
  icons,
  theme: {
    images,
    colors: buildColors(theme),
    properties: {
      // `top`, not `center`, on purpose. Chrome cannot scale this image, so on
      // a screen taller than the art `top` keeps it flush under the toolbar
      // instead of floating it in a band of fill; and on a screen shorter than
      // the art it crops from the bottom, which keeps the crescent — the
      // signature element, sitting high-left — visible either way.
      ntp_background_alignment: 'top',
      ntp_background_repeat: 'no-repeat',
      ntp_logo_alternate: 1, // white Google logo — every house surface is dark
    },
  },
};

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  join(outDir, 'CREDIT.txt'),
  [
    tokens.brand.credit,
    '',
    `${theme.name} — ornament tier: ${tier.name} (${tier.id})`,
    `Origin: ${theme.origin}`,
    '',
    'Generated by build.mjs from the canonical brand tokens and the source art',
    'in the repository root. Do not hand-edit.',
  ].join('\n') + '\n',
);

console.log(
  `  dist/fate-chrome-theme  ${Object.keys(images).length} images, ` +
    `${ICON_SIZES.length} icons  ${(bytes / 1024 / 1024).toFixed(2)} MB`,
);
console.log(`  new tab background: ${ntpNote}  (${(ntpBytes.length / 1024).toFixed(0)} KB)`);
// Only advise when the size was inherited from the source. If --ntp named it,
// the choice was deliberate and does not need explaining back.
if (!ntpOverride && (wallpaper.w > NTP_ADVISORY.w || wallpaper.h > NTP_ADVISORY.h)) {
  console.log(
    `\n  ! ${wallpaper.w}x${wallpaper.h} is larger than most new tab viewports. Chrome places this\n` +
      '    image at natural size and never scales it, so the edges of the art will be cropped\n' +
      '    rather than fitted. Exporting the source at ~1920x1080 avoids that.',
  );
}

// Store listing assets are NOT part of the uploaded package — they live in
// dist/store/ so pack.mjs cannot sweep them into the zip.
const storeDir = join(distRoot, 'store');
mkdirSync(storeDir, { recursive: true });
for (const [name, spec] of Object.entries(PROMO_TILES)) {
  const tile = coverResize(wallpaper, spec.w, spec.h, { focusY: spec.focusY });
  // The store takes JPEG or 24-bit PNG for tiles; JPEG is a fraction of the size
  // on this artwork and the listing form does not care which.
  writeFileSync(
    join(storeDir, `${name}.jpg`),
    encodeJpeg(spec.w, spec.h, tile.toBytes(), JPEG_QUALITY),
  );
}
writeFileSync(join(storeDir, 'store-icon-128x128.png'), readFileSync(join(iconDir, 'icon-128.png')));
console.log(`  dist/store  ${Object.keys(PROMO_TILES).length} promo tiles + store icon`);

// README banner. Committed rather than ignored, because the repo is the theme's
// public landing page and GitHub needs the file in-tree to render it. Output is
// deterministic, so it only shows as modified when the source art changes.
const bannerDir = join(HERE, 'docs');
mkdirSync(bannerDir, { recursive: true });
// Biased high: the crescent sits near the top of the art and is the one thing
// the banner has to keep.
const banner = coverResize(wallpaperArt.image, 1400, 500, { focusY: 0.1 });
writeFileSync(
  join(bannerDir, 'banner.jpg'),
  encodeJpeg(1400, 500, banner.toBytes(), JPEG_QUALITY),
);
console.log('  docs/banner.jpg  README banner');

console.log('\nLoad unpacked from chrome://extensions with Developer mode on.');
