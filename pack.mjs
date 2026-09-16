#!/usr/bin/env node
/**
 * Package each built theme for upload.
 *
 * The Chrome Web Store wants manifest.json at the ROOT of the archive, not
 * inside a folder — that is the single most common upload rejection. This packs
 * the contents of each `dist/fate-*` directory, never the directory itself.
 *
 *   node build.mjs && node pack.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './lib/zip.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const distRoot = join(HERE, 'dist');

if (!existsSync(distRoot)) {
  console.error('No dist/ — run `node build.mjs` first.');
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const builds = readdirSync(distRoot).filter(
  (n) => n.startsWith('fate-') && statSync(join(distRoot, n)).isDirectory(),
);

if (!builds.length) {
  console.error('No fate-* builds in dist/ — run `node build.mjs` first.');
  process.exit(1);
}

for (const name of builds) {
  const dir = join(distRoot, name);
  const entries = walk(dir)
    .map((abs) => ({
      name: relative(dir, abs).split(sep).join('/'),
      data: readFileSync(abs),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1)); // stable order => reproducible zip

  if (!entries.some((e) => e.name === 'manifest.json')) {
    throw new Error(`${name}: manifest.json is not at the archive root`);
  }

  const out = join(distRoot, `${name}.zip`);
  const buf = zip(entries);
  writeFileSync(out, buf);
  console.log(`  dist/${name}.zip  ${entries.length} files  ${(buf.length / 1024).toFixed(0)} KB`);
}

console.log('\nUpload a zip at https://chrome.google.com/webstore/devconsole');
