#!/usr/bin/env node
// `tauri build` with a build number: each run takes the next one from build-number.json and sets it
// as the bundle's CFBundleVersion, so the app reads "3.2.0 (42)" in About Beluga and Finder.
// The version itself (tauri.conf.json) stays X.Y.Z: the updater and the releases compare only that.
//
//   node scripts/tauri-build.mjs [tauri build args…]     (npm run app:build calls it)
//
// The number is taken before the build starts, so a failed build still uses one up and no two
// builds ever share a number.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(here, 'build-number.json');

let last = 0;
try {
  last = JSON.parse(readFileSync(file, 'utf8')).build;
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (!Number.isInteger(last) || last < 0) throw new Error(`${file}: "build" isn't a whole number`);
const build = last + 1;
writeFileSync(file, `${JSON.stringify({ build }, null, 2)}\n`);

const { version } = JSON.parse(readFileSync(path.join(here, 'src-tauri', 'tauri.conf.json'), 'utf8'));
console.log(`Building Beluga ${version} (build ${build})`);

const config = JSON.stringify({ bundle: { macOS: { bundleVersion: String(build) } } });
const r = spawnSync('npx', ['tauri', 'build', '--config', config, ...process.argv.slice(2)], {
  cwd: here,
  stdio: 'inherit',
  env: { ...process.env, BELUGA_BUILD_NUMBER: String(build) },
});
process.exit(r.status ?? 1);
