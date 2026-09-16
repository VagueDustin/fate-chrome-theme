/**
 * Painting helpers. Everything here works in linear 0-255 float RGB and
 * composites source-over, so a CSS gradient stack from the brand tokens can be
 * transcribed layer-for-layer instead of re-invented.
 */

export const hexToRgb = (hex) => {
  const s = hex.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
};

export const rgbToHex = (c) =>
  '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Deterministic PRNG so every build produces byte-identical art. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Canvas {
  constructor(w, h, baseRgb) {
    this.w = w;
    this.h = h;
    this.px = new Float64Array(w * h * 3);
    for (let i = 0; i < this.px.length; i += 3) {
      this.px[i] = baseRgb[0];
      this.px[i + 1] = baseRgb[1];
      this.px[i + 2] = baseRgb[2];
    }
  }

  /** source-over a single pixel */
  blend(x, y, rgb, alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    const a = alpha > 1 ? 1 : alpha;
    this.px[i] += (rgb[0] - this.px[i]) * a;
    this.px[i + 1] += (rgb[1] - this.px[i + 1]) * a;
    this.px[i + 2] += (rgb[2] - this.px[i + 2]) * a;
  }

  /**
   * CSS `radial-gradient(<rx> <ry> at <cx> <cy>, rgba(colour/alpha), transparent <stop>)`.
   * Coordinates and radii in pixels; `stop` is the fraction of the ray at which
   * the colour has fully faded (CSS default 1).
   */
  radial({ cx, cy, rx, ry, rgb, alpha, stop = 1, mask = null }) {
    for (let y = 0; y < this.h; y++) {
      const dy = (y - cy) / ry;
      const dy2 = dy * dy;
      for (let x = 0; x < this.w; x++) {
        const dx = (x - cx) / rx;
        const t = Math.sqrt(dx * dx + dy2);
        if (t >= stop) continue;
        // CSS ramps linearly to the stop, which leaves a first-derivative
        // kink that Mach-bands across a surface this large. Easing the ramp
        // keeps the same extent and peak with no visible ring.
        let a = alpha * smoothstep(1 - t / stop);
        if (mask) a *= mask(x, y);
        this.blend(x, y, rgb, a);
      }
    }
  }

  /** Soft radial dot with a gaussian-ish falloff — used for stars and glows. */
  dot(cx, cy, radius, rgb, alpha, falloff = 2) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        if (d >= 1) continue;
        this.blend(x, y, rgb, alpha * Math.pow(1 - d, falloff));
      }
    }
  }

  /** Four-point sparkle — the house star from the company wordmark. */
  sparkle(cx, cy, len, rgb, alpha) {
    this.dot(cx, cy, len * 0.26, rgb, alpha, 1.6);
    for (let i = 0; i < len * 2; i++) {
      const t = i / (len * 2);
      const d = t * len;
      const a = alpha * Math.pow(1 - t, 2.6);
      const wdt = Math.max(0.35, (1 - t) * 0.9);
      for (let o = -wdt; o <= wdt; o += 0.5) {
        this.blend(Math.round(cx + d), Math.round(cy + o), rgb, a * 0.55);
        this.blend(Math.round(cx - d), Math.round(cy + o), rgb, a * 0.55);
        this.blend(Math.round(cx + o), Math.round(cy + d), rgb, a * 0.55);
        this.blend(Math.round(cx + o), Math.round(cy - d), rgb, a * 0.55);
      }
    }
  }

  /**
   * Crescent moon — the motif tucked into the `V` of the company wordmark.
   * Rendered as a disc minus an offset disc, with an antialiased edge and a
   * 135° foil gradient across the face so it reads as metal, not flat paint.
   */
  crescent(cx, cy, radius, tiltRad, rgbA, rgbB, alpha) {
    const ox = cx + Math.cos(tiltRad) * radius * 0.52;
    const oy = cy + Math.sin(tiltRad) * radius * 0.52;
    const inner = radius * 0.92;
    const aa = Math.max(1, radius * 0.02);
    const x0 = Math.max(0, Math.floor(cx - radius - 2));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + radius + 2));
    const y0 = Math.max(0, Math.floor(cy - radius - 2));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + radius + 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dOut = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const dIn = Math.hypot(x + 0.5 - ox, y + 0.5 - oy);
        const inDisc = smoothstep((radius - dOut) / aa);
        const cut = smoothstep((dIn - inner) / aa);
        const cov = inDisc * cut;
        if (cov <= 0) continue;
        // 135deg foil ramp, matching primitives.gradient.goldEdge
        const g = clamp(
          (x - (cx - radius) + (y - (cy - radius))) / (4 * radius),
          0,
          1,
        );
        this.blend(x, y, mix(rgbA, rgbB, g), alpha * cov);
      }
    }
  }

  /** Axis-aligned 1px-ish line, used for corner brackets and hairlines. */
  line(x0, y0, x1, y1, rgb, alpha, weight = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let w = 0; w < weight; w++) {
        if (x0 === x1) this.blend(x + w, y, rgb, alpha);
        else this.blend(x, y + w, rgb, alpha);
      }
    }
  }

  /** Film grain — ceremonial/charted tiers only (see AGENTS.md §5). */
  grain(rand, amplitude, block = 2) {
    for (let y = 0; y < this.h; y += block) {
      for (let x = 0; x < this.w; x += block) {
        const n = (rand() - 0.5) * 2 * amplitude;
        for (let by = 0; by < block && y + by < this.h; by++) {
          for (let bx = 0; bx < block && x + bx < this.w; bx++) {
            const i = ((y + by) * this.w + (x + bx)) * 3;
            this.px[i] = clamp(this.px[i] + n, 0, 255);
            this.px[i + 1] = clamp(this.px[i + 1] + n, 0, 255);
            this.px[i + 2] = clamp(this.px[i + 2] + n, 0, 255);
          }
        }
      }
    }
  }

  toBytes() {
    const out = new Uint8Array(this.w * this.h * 3);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(clamp(this.px[i], 0, 255));
    return out;
  }
}

/**
 * Box-downsample a canvas. Rendering large and shrinking gives far cleaner
 * edges on a 16px icon than rendering at 16px ever will.
 */
export function downsample(src, w, h) {
  const out = new Canvas(w, h, [0, 0, 0]);
  const fx = src.w / w;
  const fy = src.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.min(src.h, Math.ceil((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.min(src.w, Math.ceil((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.w + sx) * 3;
          r += src.px[i];
          g += src.px[i + 1];
          b += src.px[i + 2];
          n++;
        }
      }
      const o = (y * w + x) * 3;
      out.px[o] = r / n;
      out.px[o + 1] = g / n;
      out.px[o + 2] = b / n;
    }
  }
  return out;
}

/** Vertical gradient strip; uniform across x so Chrome can tile it seamlessly. */
export function verticalStrip(w, h, stops) {
  const c = new Canvas(w, h, stops[0][1]);
  for (let y = 0; y < h; y++) {
    const t = h === 1 ? 0 : y / (h - 1);
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        lo = stops[i];
        hi = stops[i + 1];
        break;
      }
    }
    const span = hi[0] - lo[0];
    const local = span === 0 ? 0 : (t - lo[0]) / span;
    const rgb = mix(lo[1], hi[1], local);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      c.px[i] = rgb[0];
      c.px[i + 1] = rgb[1];
      c.px[i + 2] = rgb[2];
    }
  }
  return c;
}
