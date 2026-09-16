# FATE — Chrome themes

Chrome browser themes built from the canonical VagueDustin Enterprises design language.
Deep navy, metallic gold, the depth wash, the celestial motifs. Nothing here is hand-picked —
every colour and every pixel is derived from `@vaguedustin/brand` at build time.

```
brand tokens  →  build.mjs  →  dist/fate-<theme>/   (manifest.json + generated PNGs)
```

---

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick one of:
   - `dist/fate-gold-navy` — **start here**
   - `dist/fate-gilded-fate`

The theme applies immediately. Chrome holds one theme at a time, so loading the other one
replaces it; `chrome://settings/appearance` → **Reset to default** removes it.

Loading unpacked is the only install route that does not involve the Chrome Web Store. If you
want it to survive without Developer mode, it has to be published (see *Packaging* below).

---

## The two builds

Both are the same design language at different **ornament tiers** — the tier is read out of the
brand package, not chosen here, so each build automatically obeys the rules in `AGENTS.md` §5.

| | `fate-gold-navy` | `fate-gilded-fate` |
| --- | --- | --- |
| Brand theme | Gold & Navy (hallmark) | Gilded Fate (hallmark) |
| Origin | Fated Updates | Fatenames |
| Tier | **Utility** | **Ceremonial** |
| Accent | `#D4AF37` metallic gold | `#F2C94C` lit gold |
| Frame / toolbar | `#020617` / `#101736` | `#020617` / `#0A0E27` |
| New tab: corner brackets | — | ✅ |
| New tab: film grain | — | ✅ |
| Sparkle density | 9 | 16 |

`gold-navy` is the recommended default, for the reason the brand repo gives: *under-decorated is a
recoverable mistake, over-decorated is a rewrite.* A browser frame is in your eyeline all day.

---

## How the design language maps onto Chrome

Chrome exposes a fixed set of theme keys. Each one is fed a **semantic role**, never a raw hex, so
a retune of the brand package flows straight through.

| Chrome key | Semantic token | `gold-navy` | `gilded-fate` |
| --- | --- | --- | --- |
| `frame` | `surface.sunken` | `#020617` | `#020617` |
| `toolbar` | `surface.raised` | `#101736` | `#0A0E27` |
| `omnibox_background` | `surface.overlay` | `#16213E` | `#101736` |
| `ntp_background` | `surface.base` | `#070B1A` | `#020617` |
| `tab_text`, `omnibox_text`, `ntp_text` | `text.primary` | `#E6EAF2` | `#E6EAF2` |
| `tab_background_text`, `bookmark_text` | `text.muted` | `#94A0BB` | `#94A0BB` |
| `tab_background_text_inactive` | `text.faint` | `#76849F` | `#76849F` |
| `toolbar_button_icon`, `ntp_link` | `accent.default` | `#D4AF37` | `#F2C94C` |
| `button_background` | `accent.subtle` | 12% gold | 12% gold |
| `frame_inactive` / `frame_incognito` | `surface.sunken` mixed toward black | derived | derived |

Three decisions worth recording:

- **Gold goes on controls, not on text.** Per `AGENTS.md` §2.3 gold means *interactive or brand and
  nothing else*, so it lands on `toolbar_button_icon` (back, forward, reload, menu) and `ntp_link` —
  not on tab labels, and never on a status colour.
- **`text.faint` is `#76849F`.** The darker `#5C6B8A` fails WCAG AA on navy; the brand repo flags
  that regression as already having happened once. It is fed from the token, so it cannot drift here.
- **Toolbar doubles as the active tab fill** in Chrome, which is why it takes `surface.raised` —
  the selected tab then reads as lifted out of the frame, matching the panel model in the system.

### The generated images

| Image | Size | What it is |
| --- | --- | --- |
| `theme_frame*.png` | 64×160 | Vertical gradient into `surface.sunken`. Four variants: active, inactive, incognito, incognito-inactive. |
| `theme_toolbar.png` | 64×160 | `surface.raised` settling downward, with the `inset 0 1px 0 rgba(255,233,168,0.08)` gilded hairline on its top edge — the stroke that makes a dark surface read as *gilded* rather than merely dark. |
| `theme_tab_background.png` | 64×160 | Inactive tabs, sitting between frame and toolbar. |
| `theme_ntp_background.png` | 2560×1440 | The new tab page. |

The strips are 64px wide and **uniform across x on purpose** — Chrome tiles theme images, so a
horizontally-uniform strip is seamless at any window width, including ultrawide.

The new tab page is composed from the brand tokens directly:

- The **depth wash** is parsed out of `primitives.gradient.navyDepth` and its three radial layers are
  rendered literally, scaled from the 1920px viewport they were authored against. Edit that token and
  the artwork changes.
- The **crescent moon** is the motif tucked into the `V` of the company wordmark, filled with the
  `primitives.gradient.goldEdge` foil ramp.
- The **starfield and four-point sparkles** are the celestial motif the whole house inherits.
- Corner brackets and film grain appear only where the theme's tier turns them on.

Everything is drawn from a seeded PRNG, so a rebuild is byte-identical.

---

## Rebuilding

```bash
node build.mjs
```

No dependencies — the PNG encoder in `lib/png.mjs` is about 90 lines over Node's `zlib`.

Tokens are resolved in this order: `--brand=`, then `node_modules/@vaguedustin/brand`, then the
vendored copy in `brand/tokens.json`. To build against the live brand repo instead of the vendored
snapshot:

```bash
node build.mjs --brand="../FATE - VagueDustin Enterprises - Branding/vaguedustin-brand"
```

Other flags:

```bash
node build.mjs --themes=gold-navy          # one variant
node build.mjs --themes=admiralty,realm    # the derived themes also work
node build.mjs --version=1.1.0
```

`brand/tokens.json` is a verbatim copy of `dist/tokens.json` from the brand package. Refresh it
whenever the design language is retuned.

---

## Distribution

```bash
node build.mjs && node pack.mjs   # -> dist/fate-*.zip
```

`pack.mjs` puts `manifest.json` at the **root** of the archive, which is what the Web Store
requires and the most common reason an upload is rejected.

### Chrome Web Store — the only one-click install

Chrome refuses to install a `.crx` that Google did not sign. There is no link, no installer and no
drag-and-drop that gets around it: off-store installs are Developer mode + Load unpacked, full stop.
So if you want someone to click once and have the theme applied, it has to be listed.

1. Register at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   — one-time developer fee (currently $5), covers everything you ever publish.
2. **Add new item** → upload `dist/fate-gold-navy.zip`.
3. Fill the listing: 128×128 icon (`icons/icon-128.png` in the build), at least one 1280×800 or
   640×400 screenshot, category **Themes**, and a description.
4. Privacy tab: declare no data collection — the theme has no permissions, no code and no network
   access, which is the easiest possible review.
5. **Submit for review.** Days is typical, weeks is the documented worst case.

Publish each variant as its own item; Chrome has no concept of variants within one listing.

### GitHub — one-click *download*, not one-click install

Tag a version and `.github/workflows/release.yml` builds both themes and attaches the zips to a
GitHub Release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The download is then one click. **Installing still takes three steps** — unzip, `chrome://extensions`
with Developer mode on, Load unpacked — because of the signing rule above. Worth doing anyway as the
source of record and for anyone who would rather not wait on review.

The workflow passes the tag into `--version` so the manifest version always matches the tag. The
Web Store rejects a re-upload whose version it has already seen.

---

## Known limits

These are Chrome's, not the theme's:

- Themes can only colour the browser frame, tab strip, toolbar, omnibox and new tab page. Chrome's
  menus, settings pages and dialogs follow the OS light/dark setting and cannot be themed.
- `theme_ntp_background` is placed at its natural size, never scaled. At 2560×1440 it covers
  essentially every desktop; on anything wider or taller the edges fade into `ntp_background`
  exactly, so the seam is invisible rather than a visible rectangle.
- Chrome has no theme hook for the bookmark bar background separately from the toolbar.
- **The icon is a stand-in.** A Web Store listing requires a 128px icon, so `build.mjs` generates one
  (16/32/48/128) from the two motifs the company wordmark already carries — the crescent moon and a
  four-point sparkle, on the depth wash. It is consistent with the system, but it is not a real mark:
  the brand repo has no vector master for the wordmark or the Fatenames medallion
  (`brand/README.md` → *Missing / to do*). Replace it when one exists.

---

Provided by VagueDustin Enterprises™
