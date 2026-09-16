/**
 * Scale-to-cover plus centre-crop, shared by the promo tiles and the
 * screenshot conditioner so both frame source art the same way.
 */
import { Canvas, clamp } from './paint.mjs';

/**
 * @param {{w: number, h: number, rgb: Uint8Array}} src
 * @param {number} tw target width
 * @param {number} th target height
 * @param {{focusY?: number}} [opts] vertical crop bias, 0 = top, 1 = bottom,
 *   0.5 = centred. Useful when the interesting part of the art is not centred.
 * @returns {Canvas}
 */
export function coverResize(src, tw, th, opts = {}) {
  const focusY = opts.focusY ?? 0.5;
  const at = (x, y, k) => src.rgb[(y * src.w + x) * 3 + k];

  const scale = Math.max(tw / src.w, th / src.h);
  const offX = (src.w * scale - tw) / 2;
  const offY = (src.h * scale - th) * focusY;

  const out = new Canvas(tw, th, [0, 0, 0]);

  for (let y = 0; y < th; y++) {
    const sy0 = (y + offY) / scale;
    const sy1 = (y + 1 + offY) / scale;
    for (let x = 0; x < tw; x++) {
      const sx0 = (x + offX) / scale;
      const sx1 = (x + 1 + offX) / scale;
      const d = (y * tw + x) * 3;

      if (scale >= 1) {
        // Upscaling: the box collapses to a point, so interpolate instead.
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
          out.px[d + k] = top * (1 - ty) + bot * ty;
        }
      } else {
        // Downscaling: average the source box so fine detail survives.
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
        out.px[d] = r / n;
        out.px[d + 1] = g / n;
        out.px[d + 2] = b / n;
      }
    }
  }

  return out;
}
