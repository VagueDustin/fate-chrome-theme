/**
 * Raster helpers. Everything works in 0-255 float RGB and composites
 * source-over, so a colour ramp from the brand tokens can be transcribed
 * directly rather than re-derived.
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
  '#' +
  c
    .map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

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

  toBytes() {
    const out = new Uint8Array(this.w * this.h * 3);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(clamp(this.px[i], 0, 255));
    return out;
  }
}

/**
 * Box-downsample a canvas. Rendering or loading large and shrinking gives far
 * cleaner edges on a 16px icon than any direct small render.
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
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
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

