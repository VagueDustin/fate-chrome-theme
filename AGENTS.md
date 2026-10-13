# AGENTS.md

Guidance for coding agents working in this repository. docs/BUILD.md is the full reference.

## What this is

FATE is a Chrome browser theme (navy and gold) published on the Chrome Web Store. The theme is
generated: a dependency-free Node script reads the brand tokens and the source art and writes the
unpacked theme, its icons and the store listing assets. The project is marked finished; expect
maintenance, not features.

## Layout

- `build.mjs` - the generator. Writes `dist/fate-chrome-theme/` (the unpacked theme),
  `dist/store/` (listing assets) and `docs/banner.jpg` / `docs/icon.png`.
- `pack.mjs` - zips the theme into `dist/fate-chrome-theme.zip` with `manifest.json` at the root.
- `shot.mjs` - conditions a captured screenshot to the store's 1280x800 (or `--size=640x400`).
- `lib/` - hand-rolled PNG, baseline JPEG, ZIP, CRC32, paint and resample code.
- `brand/tokens.json` - vendored snapshot of the brand tokens (refreshed by hand).
- `fate-chrome-theme-wallpaper.png`, `fate-chrome-theme-icon.png` - the source art.
- `assets/store/` - hand-made listing assets (promo tile, screenshots), copied into `dist/store/`.
- `store/description.txt` - the Web Store description.
- `tools/prepare-screenshots.mjs` - screenshot preparation helper.

## Commands

Node 22 (what the release workflow uses). There is no `package.json` and nothing to install.

```bash
node build.mjs && node pack.mjs      # build the theme and the zip into dist/
node build.mjs --version=1.2.0       # explicit manifest version (default: newest git tag)
node build.mjs --brand=<path>        # build against a brand package checkout
node build.mjs --ntp=3440x1440       # retarget the new tab art
node shot.mjs capture.png            # condition a store screenshot
```

There are no tests or linters. Verify a change by running the build and loading
`dist/fate-chrome-theme/` via `chrome://extensions` -> Developer mode -> Load unpacked. Builds are
byte-identical across Windows and Linux, so a build that changes `docs/banner.jpg` or
`docs/icon.png` unexpectedly is a signal something drifted.

## Rules

- **No dependencies.** Image and archive handling is hand-rolled on purpose; do not add npm packages.
- **No raw house hex in the generator.** Colours come from semantic token roles
  (`surface.raised`, `accent.default`, `text.faint`), resolved from `--brand=`, then
  `node_modules/@vaguedustin/brand`, then `brand/tokens.json`.
- **Derive, never improvise.** Artwork is conditioned from the source art files, not drawn by code.
- Gold (`accent.*`) goes on controls and links, never on status or decorative text.
- Chrome theme images must be PNG; the manifest `description` must stay within 132 characters
  (`build.mjs` checks); `manifest.json` must sit at the zip root (`pack.mjs` handles it).
- `dist/` is build output and gitignored; do not commit it.

## Releasing

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds with `--version` taken from
the tag and attaches the zip to a GitHub Release. The manifest version must increase on every Web
Store upload. Do not create tags unless asked.

## Commit style

Short imperative subjects describing the change ("Take the manifest version from the newest git tag").
