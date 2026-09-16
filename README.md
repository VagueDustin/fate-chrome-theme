# FATE — Chrome theme

A Chrome theme in the VagueDustin Enterprises design language. Deep navy, metallic gold,
constellations and nebula.

Two inputs, nothing invented from either:

```
brand tokens  ─┐
               ├─ build.mjs ─→ dist/fate-chrome-theme/   (manifest.json + images)
source art    ─┘              dist/store/                (listing assets)
```

- **Colour** comes from the canonical brand tokens. No house hex is written anywhere in the
  generator — it consumes semantic roles (`surface.raised`, `accent.default`, `text.faint`), so a
  retune of the brand package flows through with one command.
- **Artwork** comes from the source art in this repo. Per the brand rule — *derive, never
  improvise* — the new tab page, icons and promo tiles are conditioned from those files by a
  recorded step rather than drawn by the build.

---

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → `dist/fate-chrome-theme`

Chrome holds one theme at a time. `chrome://settings/appearance` → **Reset to default** removes it.

Loading unpacked is the only install route that does not involve the Chrome Web Store — see
*Distribution*.

---

## Source art

| File | Size | Used for |
| --- | --- | --- |
| `fate-chrome-theme-wallpaper.png` | 1920×1080 | New tab background, both promo tiles |
| `fate-chrome-theme-icon.png` | 1254×1254 | Extension and store icons, 16/32/48/128 |

Replacing either file and rerunning `node build.mjs` is the whole update path. Both PNG and baseline
JPEG sources are accepted.

**Theme images must be PNG.** Chrome's docs are explicit that a non-PNG theme image
["will not render properly"](https://developer.chrome.com/docs/extensions/develop/ui/themes)
(crbug.com/1200459), so a JPEG source is converted rather than passed through. Third-party guides
claiming JPEG works are wrong; don't follow them.

**The new tab background is never resampled by default and never lossily re-encoded.** Chrome
places `theme_ntp_background` at its natural size, so the source file *is* the final pixel grid —
the build only changes its container, re-encoding losslessly and keeping whichever encoding is
smaller. At 1920×1080 the art covers a 1080p new tab outright.

The art's edges average `#020613`, within a rounding error of the theme's `surface.base` `#020617`.
That is why no feathering is needed: on a screen wider or taller than the image, Chrome's
`ntp_background` fill meets it invisibly.

The promo tiles *are* resampled and encoded as JPEG — they have fixed required dimensions, so there
is no lossless option, and they are listing artwork rather than part of the theme.

---

## How the design language maps onto Chrome

Chrome exposes a fixed set of theme keys. Each is fed a **semantic role**, never a raw hex.

| Chrome key | Semantic token | Value |
| --- | --- | --- |
| `frame` | `surface.sunken` | `#020617` |
| `toolbar` | `surface.raised` | `#0A0E27` |
| `omnibox_background` | `surface.overlay` | `#101736` |
| `ntp_background` | `surface.base` | `#020617` |
| `tab_text`, `omnibox_text`, `ntp_text` | `text.primary` | `#E6EAF2` |
| `tab_background_text`, `bookmark_text` | `text.muted` | `#94A0BB` |
| `tab_background_text_inactive` | `text.faint` | `#76849F` |
| `toolbar_button_icon`, `ntp_link` | `accent.default` | `#F2C94C` |
| `button_background` | `accent.subtle` | 12% gold |
| `frame_inactive` / `frame_incognito` | `surface.sunken` mixed toward black | derived |

Three decisions worth recording:

- **Gold goes on controls, not on text.** Per `AGENTS.md` §2.3 gold means *interactive or brand and
  nothing else*, so it lands on `toolbar_button_icon` (back, forward, reload, menu) and `ntp_link` —
  not on tab labels, and never on a status colour.
- **`text.faint` is `#76849F`.** The darker `#5C6B8A` fails WCAG AA on navy; the brand repo flags
  that regression as already having happened once. It is fed from the token, so it cannot drift here.
- **Toolbar doubles as the active tab fill** in Chrome, which is why it takes `surface.raised` — the
  selected tab then reads as lifted out of the frame, matching the panel model in the system.

### Generated images

Only the chrome strips are generated, because they are pure token gradients:

| Image | Size | What it is |
| --- | --- | --- |
| `theme_frame*.png` | 64×160 | Vertical gradient into `surface.sunken`. Four variants: active, inactive, incognito, incognito-inactive. |
| `theme_toolbar.png` | 64×160 | `surface.raised` settling downward, with the `inset 0 1px 0 rgba(255,233,168,0.08)` gilded hairline on its top edge — the stroke that makes a dark surface read as *gilded* rather than merely dark. |
| `theme_tab_background.png` | 64×160 | Inactive tabs, sitting between frame and toolbar. |

They are 64px wide and **uniform across x on purpose** — Chrome tiles theme images, so a
horizontally-uniform strip is seamless at any window width, including ultrawide.

---

## Rebuilding

```bash
node build.mjs && node pack.mjs
```

No dependencies. The PNG codec, the baseline JPEG codec, the ZIP writer and the resampler are all
hand-rolled — Node ships no image handling, and this project brings none in.

Tokens resolve in this order: `--brand=`, then `node_modules/@vaguedustin/brand`, then the vendored
`brand/tokens.json`. To build against the live brand repo instead of the vendored snapshot:

```bash
node build.mjs --brand="../FATE - VagueDustin Enterprises - Branding/vaguedustin-brand"
```

Other flags:

```bash
node build.mjs --theme=gold-navy     # any theme in the brand package
node build.mjs --version=1.2.0
node build.mjs --ntp=3440x1440       # retarget the new tab art at a screen size
```

`--ntp` opts into resampling (scale-to-cover, centre-crop) and warns when it is upscaling. It is
never automatic — see *Sizing the new tab background*.

---

## Distribution

`pack.mjs` puts `manifest.json` at the **root** of the archive, which is what the Web Store requires
and the most common reason an upload is rejected.

### Chrome Web Store — the only one-click install

Chrome refuses to install a `.crx` that Google did not sign. There is no link, no installer and no
drag-and-drop around it: off-store installs are Developer mode + Load unpacked, full stop. So if you
want someone to click once and have the theme applied, it has to be listed.

1. Register at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   — one-time developer fee (currently $5), covers everything you ever publish.
2. **Add new item** → upload `dist/fate-chrome-theme.zip`.
3. Fill the listing — see below.
4. Privacy tab: declare no data collection. The theme has no permissions, no code and no network
   access, which is the easiest possible review.
5. **Submit for review.** Days is typical, weeks is the documented worst case.

### GitHub — one-click *download*, not one-click install

Tag a version and `.github/workflows/release.yml` builds the theme and attaches the zip to a
GitHub Release:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

The download is then one click. **Installing still takes three steps** — unzip, `chrome://extensions`
with Developer mode on, Load unpacked — because of the signing rule above.

The workflow passes the tag into `--version` so the manifest version always matches the tag. The
Web Store rejects a re-upload whose version it has already seen.

---

## Listing assets

`node build.mjs` writes everything the listing form needs, except the screenshot, to `dist/store/`:

| Form field | File | Notes |
| --- | --- | --- |
| Store icon 128×128 | `store-icon-128x128.png` | Same art as the packaged icon |
| Small promo tile 440×280 | `promo-small-440x280.jpg` | Optional, shown in search results |
| Marquee promo tile 1400×560 | `promo-marquee-1400x560.jpg` | Optional, featured shelves |
| Screenshot 1280×800 | **you capture this** | See below |
| Category | *Space* | The celestial motifs make it the closest fit; *Dark* also works |
| Description | `store/description.txt` | Version-controlled rather than living only in the dashboard |

Both tiles are cropped from the wallpaper with a **vertical bias toward the upper band** — the art's
centre is deliberately calm, so a centred crop is mostly empty navy.

The tiles are JPEG and the store icon is 24-bit PNG with no alpha. The form accepts either.

### Screenshots

The store takes **1280×800 or 640×400, JPEG or 24-bit PNG with no alpha**, and rejects anything
else. Capture a real window — a rendered mock is not a screenshot — then condition it:

```bash
node shot.mjs capture.png
```

It scales to cover, centre-crops to the exact size, flattens any alpha onto the theme's base navy
rather than onto white, and writes 24-bit PNG to `dist/store/screenshots/`. Add `--size=640x400` for
the smaller option. Sizing the Chrome window to 1280×800 before capturing avoids any crop at all.

---

## Known limits

These are Chrome's, not the theme's:

- Themes can only colour the browser frame, tab strip, toolbar, omnibox and new tab page. Chrome's
  menus, settings pages and dialogs follow the OS light/dark setting and cannot be themed.
- `theme_ntp_background` is placed at its natural size and **cannot be scaled**. See below.
- Chrome has no theme hook for the bookmark bar background separately from the toolbar.

---

## Sizing the new tab background

There is **no `cover`, `contain` or stretch** for a theme background. The entire surface area is two
manifest properties — alignment (`center`, `left`, `right`, `top`, `bottom`, plus corner pairs) and
repeat (`repeat`, `no-repeat`, `repeat-x`, `repeat-y`). The image is placed at natural size and then
cropped or letterboxed. "Scales to any screen" is not achievable the way it would be in CSS.

That leaves three honest strategies:

| | How it behaves | Cost |
| --- | --- | --- |
| **Author at your largest target** | Fills that screen exactly | Smaller screens crop from the centre, so edge-anchored ornament is lost |
| **Safe-zone the composition** | Survives every screen size | The frame can no longer be full-bleed — ornament has to sit inside a central ~1280×800 region |
| **Tileable band + `repeat-x`** | Genuinely fills any width | Cannot contain a single moon or corner frame; a tile repeats across the screen |

This theme takes the first. The art is 1920×1080, which fills a 1080p new tab outright; on an
ultrawide it centres with fill around it. That fill is invisible rather than a seam, because
`ntp_background` is `#020617` and the art's own edges average `#020613`.

To fill a wider screen, re-export the source at that size — `--ntp` can retarget an existing master,
but it upscales, which softens the art. Get the exact viewport from DevTools on any normal page:

```javascript
window.innerWidth + " × " + window.innerHeight
```

**Alignment is `top`, not `center`, deliberately.** On a screen taller than the art, `top` keeps the
image flush under the toolbar rather than floating it in a band of fill. On a screen shorter than
the art, it crops from the bottom, which keeps the crescent — the signature element, sitting
high-left — visible either way.

---

Provided by VagueDustin Enterprises™
