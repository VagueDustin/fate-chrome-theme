#!/usr/bin/env node
/**
 * FATE — Chrome theme generator for VagueDustin Enterprises.
 *
 * Every colour and every pixel below is derived from the canonical design
 * language in `@vaguedustin/brand`. No house hex is written here: the only
 * inputs are semantic roles (`surface.raised`, `accent.default`, ...) and the
 * primitives they resolve to. Retune the brand package, rerun this script, and
 * the theme follows.
 *
 *   node build.mjs                          # vendored brand/tokens.json
 *   node build.mjs --brand=../vaguedustin-brand
 *   node build.mjs --themes=gold-navy
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';
import {
  Canvas,
  verticalStrip,
  downsample,
  hexToRgb,
  mix,
  smoothstep,
  mulberry32,
  clamp,
} from './lib/paint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

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

/**
 * Parse the house depth wash straight out of `primitives.gradient.navyDepth`
 * so a retune of that token flows into the artwork.
 *
 * Handles: radial-gradient([ellipse ]<rx> <ry> at <cx> <cy>, rgba(...), transparent[ <n>%])
 */
function parseDepthWash(css) {
  const layers = [];
  const re = /radial-gradient\(/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '(') depth++;
      else if (css[i] === ')') depth--;
      i++;
    }
    const body = css.slice(start, i - 1).trim();
    const spec =
      /^(?:ellipse\s+)?(-?[\d.]+(?:px|%))\s+(-?[\d.]+(?:px|%))\s+at\s+(-?[\d.]+(?:px|%))\s+(-?[\d.]+(?:px|%))\s*,\s*(rgba?\([^)]*\))\s*,\s*transparent(?:\s+([\d.]+)%)?$/i.exec(
        body,
      );
    if (!spec) throw new Error(`Unrecognised depth-wash layer: ${body}`);
    const { rgb, a } = parseRgba(spec[5]);
    layers.push({
      rx: spec[1],
      ry: spec[2],
      cx: spec[3],
      cy: spec[4],
      rgb,
      alpha: a,
      stop: spec[6] === undefined ? 1 : +spec[6] / 100,
    });
  }
  if (!layers.length) throw new Error('No radial-gradient layers found in navyDepth token');
  return layers;
}

/** Pull the hex stops out of a simple `linear-gradient(135deg, #A, #B)` token. */
function parseLinearStops(css) {
  const hits = css.match(/#[0-9a-f]{6}/gi);
  if (!hits || hits.length < 2) throw new Error(`Cannot parse gradient stops: ${css}`);
  return hits;
}

// The token's px radii are authored against a 1920-wide viewport.
const AUTHORED_VIEWPORT = 1920;
const unit = (v, axis, W, H) => {
  const n = parseFloat(v);
  if (v.endsWith('%')) return (n / 100) * (axis === 'x' ? W : H);
  return n * (W / AUTHORED_VIEWPORT);
};

// ------------------------------------------------------------- artwork ------

const NTP_W = 2560;
const NTP_H = 1440;
const STRIP_W = 64; // uniform across x, so Chrome tiles it without a seam
const STRIP_H = 160; // taller than any Chrome frame/toolbar band

/**
 * The house scene — depth wash, starfield, sparkles, crescent moon, plus the
 * tier's optional corner brackets and film grain. Shared by the new tab page
 * and the store promo tiles so the two can never drift apart.
 */
function renderScene(theme, tier, prim, wash, opts) {
  const {
    w: W,
    h: H,
    mask = () => 1,
    calm = () => 1,
    moon,
    starDivisor = 7600,
    bracketInset = 0.08,
    bracketArm = 0.055,
    seed = 0x0fa7e,
  } = opts;

  const t = theme.tokens;
  const c = new Canvas(W, H, hexToRgb(t.surface.base));
  const rand = mulberry32(seed);

  for (const L of wash) {
    c.radial({
      cx: unit(L.cx, 'x', W, H),
      cy: unit(L.cy, 'y', W, H),
      rx: unit(L.rx, 'x', W, H),
      ry: unit(L.ry, 'y', W, H),
      rgb: L.rgb,
      alpha: L.alpha,
      stop: L.stop,
      mask,
    });
  }

  const gold300 = hexToRgb(prim.gold['300']);
  const gold500 = hexToRgb(prim.gold['500']);
  const accent = hexToRgb(t.accent.default);
  const inkPrimary = hexToRgb(t.text.primary);
  const ceremonial = tier.id === 'ceremonial';
  // Stars are drawn in absolute pixels, so they must not shrink on a small tile.
  const scale = W / NTP_W;

  // Starfield — cool ink dust with a gold minority, the house celestial motif.
  const starCount = Math.round((W * H) / starDivisor);
  for (let i = 0; i < starCount; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const golden = rand() < 0.28;
    const r = (0.7 + rand() * (golden ? 1.9 : 1.3)) * Math.max(1, scale);
    const a = (0.1 + rand() * 0.42) * mask(Math.round(x), Math.round(y)) * calm(x, y);
    c.dot(x, y, r, golden ? gold300 : inkPrimary, a, 2.1);
  }

  // Four-point sparkles — the wordmark's signature star.
  const sparkles = ceremonial ? 16 : 9;
  for (let i = 0; i < sparkles; i++) {
    const x = rand() < 0.5 ? rand() * W * 0.26 : W * (0.74 + rand() * 0.26);
    const y = rand() * H * 0.92;
    const len = (6 + rand() * (ceremonial ? 16 : 10)) * Math.max(0.5, scale);
    const a = (ceremonial ? 0.3 : 0.2) * (0.5 + rand() * 0.5) * mask(Math.round(x), Math.round(y));
    c.sparkle(x, y, len, gold300, a);
  }

  // Crescent moon — the motif tucked into the `V` of the company wordmark.
  // Gold has to carry real weight here: a pale gold laid on navy at low alpha
  // lands on neutral grey, which reads as off-brand rather than restrained.
  const [foilA, foilB] = parseLinearStops(prim.gradient.goldEdge).map(hexToRgb);
  const mx = W * moon.x;
  const my = H * moon.y;
  const mr = W * moon.r;
  c.dot(mx, my, mr * 2.8, gold500, ceremonial ? 0.07 : 0.045, 2.4);
  c.crescent(mx, my, mr, -0.62, foilA, foilB, ceremonial ? 0.52 : 0.4);

  // Corner brackets — ceremonial / charted tiers only (AGENTS.md §5).
  if (tier.surface.cornerAccents) {
    const inset = Math.round(W * bracketInset);
    const arm = Math.round(W * bracketArm);
    const weight = Math.max(1, Math.round(2 * scale));
    const a = 0.26;
    for (const [x, y, sx, sy] of [
      [inset, inset, 1, 1],
      [W - 1 - inset, inset, -1, 1],
      [inset, H - 1 - inset, 1, -1],
      [W - 1 - inset, H - 1 - inset, -1, -1],
    ]) {
      c.line(x, y, x + arm * sx, y, accent, a * mask(x, y), weight);
      c.line(x, y, x, y + arm * sy, accent, a * mask(x, y), weight);
    }
  }

  // Film grain — ceremonial / charted tiers only.
  if (tier.surface.texture) c.grain(rand, 2.2, 2);

  return c;
}

function renderNtp(theme, tier, prim, wash) {
  // The image is top-aligned and flush under the toolbar, so only the left,
  // right and bottom edges need to settle into `ntp_background` exactly. The
  // ramp is wide and twice-eased: a short one leaves a visible ring where it
  // cuts across the depth wash on the right-hand side.
  const padX = Math.round(NTP_W * 0.13);
  const padY = Math.round(NTP_H * 0.16);

  return renderScene(theme, tier, prim, wash, {
    w: NTP_W,
    h: NTP_H,
    mask: (x, y) =>
      smoothstep(smoothstep(Math.min(x / padX, (NTP_W - 1 - x) / padX, (NTP_H - 1 - y) / padY, 1))),
    // Chrome's own new-tab furniture (logo, search box, shortcut tiles) lives
    // here; keep the starfield quiet behind it rather than cutting a hard hole.
    calm: (x, y) => {
      const nx = x / NTP_W;
      const ny = y / NTP_H;
      return nx > 0.26 && nx < 0.74 && ny > 0.1 && ny < 0.7 ? 0.22 : 1;
    },
    // Clear of both the ceremonial corner bracket and the new-tab calm zone.
    moon: { x: 0.19, y: 0.225, r: 0.038 },
  });
}

/**
 * Chrome Web Store promo tiles. Listing assets, NOT part of the uploaded
 * package — they go to dist/store/ so `pack.mjs` never sweeps them into a zip.
 * Nothing is masked or kept calm here: the whole canvas is visible artwork.
 */
const PROMO_TILES = {
  'promo-small-440x280': [440, 280],
  'promo-marquee-1400x560': [1400, 560],
};

function renderPromo(theme, tier, prim, wash, w, h) {
  return renderScene(theme, tier, prim, wash, {
    w,
    h,
    moon: { x: 0.22, y: 0.46, r: 0.09 },
    starDivisor: 2600,
    bracketInset: 0.045,
    bracketArm: 0.05,
  });
}

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

/**
 * Store / extensions-page icon.
 *
 * The Chrome Web Store listing requires a 128px icon, and the brand repo has no
 * vector master to derive one from (`brand/README.md` -> Missing / to do). This
 * is built from the two house motifs the wordmark already carries — the crescent
 * moon and a four-point sparkle, on the depth wash — so it is consistent with
 * the rest of the system, but it is a stand-in for a real mark, not one.
 */
const ICON_SIZES = [16, 32, 48, 128];
const ICON_SUPERSAMPLE = 512;

function renderIcon(theme, prim, wash) {
  const S = ICON_SUPERSAMPLE;
  const t = theme.tokens;
  const c = new Canvas(S, S, hexToRgb(t.surface.base));

  for (const L of wash) {
    c.radial({
      cx: unit(L.cx, 'x', S, S),
      cy: unit(L.cy, 'y', S, S),
      rx: unit(L.rx, 'x', S, S),
      ry: unit(L.ry, 'y', S, S),
      rgb: L.rgb,
      alpha: L.alpha,
      stop: L.stop,
    });
  }

  const [foilA, foilB] = parseLinearStops(prim.gradient.goldEdge).map(hexToRgb);
  const gold300 = hexToRgb(prim.gold['300']);
  const accent = hexToRgb(t.accent.default);

  c.dot(S * 0.46, S * 0.5, S * 0.42, hexToRgb(prim.gold['500']), 0.1, 2.4);
  c.crescent(S * 0.46, S * 0.5, S * 0.3, -0.62, foilA, foilB, 0.95);
  c.sparkle(S * 0.74, S * 0.29, S * 0.1, gold300, 0.85);

  // Gilded hairline keyline, inset like a struck edge.
  const inset = Math.round(S * 0.055);
  const w = Math.max(1, Math.round(S * 0.012));
  c.line(inset, inset, S - 1 - inset, inset, accent, 0.5, w);
  c.line(inset, S - 1 - inset - w, S - 1 - inset, S - 1 - inset - w, accent, 0.5, w);
  c.line(inset, inset, inset, S - 1 - inset, accent, 0.5, w);
  c.line(S - 1 - inset - w, inset, S - 1 - inset - w, S - 1 - inset, accent, 0.5, w);

  return Object.fromEntries(ICON_SIZES.map((s) => [s, downsample(c, s, s)]));
}

// ------------------------------------------------------------- manifest -----

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

    ntp_background: toChrome(hexToRgb(t.surface.base)),
    ntp_text: toChrome(hexToRgb(t.text.primary)),
    ntp_link: toChrome(hexToRgb(t.accent.default)),
  };
}

const BLURB = {
  'gold-navy':
    'Deep navy and metallic gold across every Chrome surface. Restrained, legible, all day — and lit from just off the page.',
  'gilded-fate':
    'Deep navy and metallic gold across every Chrome surface, gilded and ceremonial. The thread is already in motion.',
  admiralty:
    'Deep navy and antique gold across every Chrome surface, charted and engraved. Every window a survey of somewhere further out.',
  realm:
    'Deep navy and warm gold across every Chrome surface, parchment-lit. A browser dressed for the realm it opens onto.',
};

// ----------------------------------------------------------------- main -----

const { tokens, source } = loadTokens();
const prim = tokens.primitives;
const wash = parseDepthWash(prim.gradient.navyDepth);
const version = arg('version', '1.0.0');
const requested = arg('themes', 'gold-navy,gilded-fate')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`brand tokens : ${relative(HERE, source) || source}`);
console.log(`depth wash   : ${wash.length} radial layers from primitives.gradient.navyDepth`);
console.log('');

const distRoot = join(HERE, 'dist');
if (existsSync(distRoot)) rmSync(distRoot, { recursive: true });

for (const id of requested) {
  const theme = tokens.themes[id];
  if (!theme) {
    throw new Error(`Unknown theme "${id}". Available: ${Object.keys(tokens.themes).join(', ')}`);
  }
  const tier = tokens.tiers[theme.tier];

  const outDir = join(distRoot, `fate-${id}`);
  const imgDir = join(outDir, 'images');
  mkdirSync(imgDir, { recursive: true });

  const canvases = renderStrips(theme, prim);
  canvases['theme_ntp_background.png'] = renderNtp(theme, tier, prim, wash);

  const images = {};
  let bytes = 0;
  for (const [name, canvas] of Object.entries(canvases)) {
    const png = encodePng(canvas.w, canvas.h, canvas.toBytes());
    writeFileSync(join(imgDir, name), png);
    images[name.replace(/\.png$/, '')] = `images/${name}`;
    bytes += png.length;
  }

  const iconDir = join(outDir, 'icons');
  mkdirSync(iconDir, { recursive: true });
  const icons = {};
  for (const [size, canvas] of Object.entries(renderIcon(theme, prim, wash))) {
    const png = encodePng(canvas.w, canvas.h, canvas.toBytes());
    writeFileSync(join(iconDir, `icon-${size}.png`), png);
    icons[size] = `icons/icon-${size}.png`;
    bytes += png.length;
  }

  // Store listing assets are NOT part of the uploaded package — they live in
  // dist/store/ so pack.mjs cannot sweep them into the zip.
  const storeDir = join(distRoot, 'store', id);
  mkdirSync(storeDir, { recursive: true });
  for (const [pname, [pw, ph]] of Object.entries(PROMO_TILES)) {
    const canvas = renderPromo(theme, tier, prim, wash, pw, ph);
    writeFileSync(join(storeDir, `${pname}.png`), encodePng(pw, ph, canvas.toBytes()));
  }
  writeFileSync(
    join(storeDir, 'store-icon-128x128.png'),
    readFileSync(join(iconDir, 'icon-128.png')),
  );

  const manifest = {
    manifest_version: 3,
    name: `FATE — ${theme.name}`,
    version,
    description:
      BLURB[id] ?? `The ${theme.name} theme from the VagueDustin Enterprises design language.`,
    icons,
    theme: {
      images,
      colors: buildColors(theme),
      properties: {
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
      'Generated by build.mjs from the canonical brand tokens. Do not hand-edit.',
    ].join('\n') + '\n',
  );

  console.log(
    `  dist/fate-${id}  tier=${tier.id}  images=${Object.keys(images).length}  ${(
      bytes /
      1024 /
      1024
    ).toFixed(2)} MB`,
  );
}

console.log('\nLoad unpacked from chrome://extensions with Developer mode on.');
