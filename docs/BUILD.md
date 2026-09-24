# Building

```bash
node build.mjs && node pack.mjs
```

No dependencies. The PNG codec, the baseline JPEG codec, the ZIP writer and the resampler are all
hand-rolled. Node ships no image handling, and this project brings none in.

## Inputs

Two, and nothing is invented from either.

**Colour** comes from the canonical brand tokens. No hex is written anywhere in the generator; it
consumes semantic roles (`surface.raised`, `accent.default`, `text.faint`), so a retune of the brand
package flows through with one command.

**Artwork** comes from the source art in the repository root. Per the house rule (derive, never
improvise), the new tab page, icons, promo tiles and README banner are all conditioned from those
files by a recorded step rather than drawn by the build.

| File | Size | Used for |
| --- | --- | --- |
| `fate-chrome-theme-wallpaper.png` | 1920×1080 | New tab background, marquee tile, README banner |
| `fate-chrome-theme-icon.png` | 1254×1254 | Extension and store icons, 16/32/48/128 |

`assets/store/` holds **hand-made listing assets**: the 440×280 promo tile and the screenshots.
They live there rather than in `dist/store/` because `dist/` is deleted at the top of every build;
the build copies them across so `dist/store/` stays the single folder you upload from. Anything
named `screenshot*` also gets a conditioned 1280×800 copy, since the store rejects every other size.

`docs/banner.jpg` is generated but unused by the README. It is the right shape for GitHub's social
preview image, under *Settings → General → Social preview*.

Replacing either file and rerunning `node build.mjs` is the whole update path. PNG and baseline JPEG
sources are both accepted.

## Flags

```bash
node build.mjs --brand=<path>        # build against a brand package checkout
node build.mjs --theme=gold-navy     # any theme in the brand package
node build.mjs --version=1.2.0       # otherwise taken from the newest git tag
node build.mjs --ntp=3440x1440       # retarget the new tab art at a screen size
```

The version comes from `git describe --tags --abbrev=0`, so a local build carries the same version
CI would release and the build prints which it used. It previously defaulted to a hardcoded `1.0.0`,
which produced packages the Web Store rejected with *"version must be larger than the published
package"*. The manifest version has to increase on every upload, and CI was the only thing passing
a real one.

Tokens resolve in this order: `--brand=`, then `node_modules/@vaguedustin/brand`, then the vendored
`brand/tokens.json`. The vendored copy is a verbatim snapshot and must be refreshed by hand when the
design language is retuned.

## How the tokens map onto Chrome

Chrome exposes a fixed set of theme keys. Each is fed a semantic role, never a raw hex.

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

- **Gold goes on controls, not on text.** Gold means interactive or brand and nothing else, so it
  lands on `toolbar_button_icon` and `ntp_link`, not on tab labels, and never on a status colour.
- **`text.faint` is `#76849F`.** The darker `#5C6B8A` fails WCAG AA on navy, a regression the brand
  repo records as already having happened once. It is fed from the token, so it cannot drift here.
- **Toolbar doubles as the active tab fill** in Chrome, which is why it takes `surface.raised`: the
  selected tab then reads as lifted out of the frame, matching the panel model in the system.

## Generated images

Only the chrome strips are generated; they are pure token gradients.

| Image | Size | What it is |
| --- | --- | --- |
| `theme_frame*.png` | 64×160 | Vertical gradient into `surface.sunken`. Four variants: active, inactive, incognito, incognito-inactive. |
| `theme_toolbar.png` | 64×160 | `surface.raised` settling downward, with the `inset 0 1px 0 rgba(255,233,168,0.08)` gilded hairline on its top edge, the stroke that makes a dark surface read as gilded rather than merely dark. |
| `theme_tab_background.png` | 64×160 | Inactive tabs, sitting between frame and toolbar. |

They are 64px wide and uniform across x on purpose: Chrome tiles theme images, so a
horizontally-uniform strip shows no seam at any window width, including ultrawide.

## Chrome constraints

Each of these was found the hard way and is enforced or worked around in the build.

**Theme images must be PNG.** Chrome's docs state that a non-PNG theme image
["will not render properly"](https://developer.chrome.com/docs/extensions/develop/ui/themes)
(crbug.com/1200459), so a JPEG source is converted rather than passed through. Third-party guides
claiming JPEG works are wrong.

**The manifest `description` is capped at 132 characters,** and Chrome only enforces it at upload.
`build.mjs` checks it at build time so the failure arrives with a character count instead of a
rejected zip.

**`manifest.json` must sit at the root of the uploaded archive,** not inside a folder. `pack.mjs`
handles that; it is the most common upload rejection.

**Chrome cannot install a `.crx` it did not sign.** There is no link, installer or drag-and-drop
around it, which is why off-store installs need Developer mode and Load unpacked.

## Sizing the new tab background

There is no `cover`, `contain` or stretch for a theme background. The entire surface area is two
manifest properties: alignment (`center`, `left`, `right`, `top`, `bottom`, plus corner pairs) and
repeat (`repeat`, `no-repeat`, `repeat-x`, `repeat-y`). The image is placed at natural size and then
cropped or letterboxed. "Scales to any screen" is not achievable the way it would be in CSS.

That leaves three honest strategies:

| | How it behaves | Cost |
| --- | --- | --- |
| **Author at your largest target** | Fills that screen exactly | Smaller screens crop from the centre, so edge-anchored ornament is lost |
| **Safe-zone the composition** | Survives every screen size | The frame can no longer be full-bleed; ornament has to sit inside a central ~1280×800 region |
| **Tileable band + `repeat-x`** | Genuinely fills any width | Cannot contain a single moon or corner frame; a tile repeats across the screen |

This theme takes the first. The art is 1920×1080, which fills a 1080p new tab outright; on an
ultrawide it centres with fill around it. That fill is invisible rather than a seam, because
`ntp_background` is `#020617` and the art's own edges average `#020613`.

To fill a wider screen, re-export the source at that size. `--ntp` can retarget an existing master,
but it upscales, which softens the art. Get the exact viewport from DevTools on any normal page:

```javascript
window.innerWidth + " × " + window.innerHeight
```

**Alignment is `top`, not `center`, deliberately.** On a screen taller than the art, `top` keeps the
image flush under the toolbar rather than floating it in a band of fill. On a screen shorter than
the art, it crops from the bottom, which keeps the crescent (the signature element, sitting
high-left) visible either way.

## Releasing

Tagging builds the theme and attaches the zip to a GitHub Release:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

The workflow passes the tag into `--version`, so the manifest version always matches the tag. The
Web Store rejects a re-upload whose version it has already seen. A manual `workflow_dispatch` run
builds and packs without releasing, as a build check.

Builds are byte-identical between a local Windows run and Linux CI.

## Web Store listing

`node build.mjs` writes everything the listing form needs, except the screenshot, to `dist/store/`.

| Form field | File | Notes |
| --- | --- | --- |
| Store icon 128×128 | `store-icon-128x128.png` | Same art as the packaged icon |
| Small promo tile 440×280 | `promo-small-440x280.jpg` | Optional, shown in search results |
| Marquee promo tile 1400×560 | `promo-marquee-1400x560.jpg` | Optional, featured shelves |
| Screenshot 1280×800 | you capture this | See below |
| Category | *Space* | The celestial motifs make it the closest fit; *Dark* also works |
| Description | `store/description.txt` | Version-controlled rather than living only in the dashboard |

The tiles are resampled and encoded as JPEG: their dimensions are fixed by the store, so there is no
lossless option, and they are listing artwork rather than part of the theme.

### Screenshots

The store takes 1280×800 or 640×400, JPEG or 24-bit PNG with no alpha, and rejects anything else.
Capture a real window, then condition it:

```bash
node shot.mjs capture.png
```

It scales to cover, centre-crops to the exact size, flattens any alpha onto the theme's base navy
rather than onto white, and writes 24-bit PNG to `dist/store/screenshots/`. Add `--size=640x400` for
the smaller option. Sizing the Chrome window to 1280×800 before capturing avoids any crop at all.
