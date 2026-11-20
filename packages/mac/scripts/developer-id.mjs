#!/usr/bin/env node
// The fork's builds are signed for distribution outside the App Store: with Hangzhou Yaoxing's
// Developer ID, then notarized by Apple, so the app opens on any Mac without a warning.
//
//   node scripts/developer-id.mjs sign [path/to/Beluga.app]   tauri-build.mjs runs it after `tauri build`
//   node scripts/developer-id.mjs notarize [path/to/out.dmg]  npm run app:build runs it after make-dmg.mjs
//
// The certificate is in the login keychain. Notarizing needs your Apple account's app-specific
// password, kept once in the keychain under NOTARY_PROFILE (docs/fork.md, "签名与公证"):
//
//   xcrun notarytool store-credentials beluga-notary --team-id L9YRXEKYN2 --apple-id <your Apple ID>
//
// Without the certificate the build stays ad hoc, as before; without the profile it is signed but
// not notarized, and says so.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEVELOPER_ID = 'Developer ID Application: Hangzhou Yaoxing Intelligent Technology Co., Ltd. (L9YRXEKYN2)';
export const TEAM_ID = 'L9YRXEKYN2';
export const NOTARY_PROFILE = 'beluga-notary';

const here = path.resolve(import.meta.dirname, '..');
const tauri = path.join(here, 'src-tauri');
const conf = JSON.parse(readFileSync(path.join(tauri, 'tauri.conf.json'), 'utf8'));
const bundleDir = path.join(tauri, 'target/release/bundle');
const defaultApp = path.join(bundleDir, `macos/${conf.productName}.app`);
const defaultDmg = path.join(bundleDir, `dmg/${conf.productName}_${conf.version}_${os.arch() === 'arm64' ? 'aarch64' : 'x64'}.dmg`);

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const loud = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

/** The Developer ID when it's in the keychain (another identity in $APPLE_SIGNING_IDENTITY wins). */
export function signingIdentity() {
  if (process.env.APPLE_SIGNING_IDENTITY) return process.env.APPLE_SIGNING_IDENTITY;
  try {
    return run('security', ['find-identity', '-v', '-p', 'codesigning']).includes(`"${DEVELOPER_ID}"`) ? DEVELOPER_ID : undefined;
  } catch {
    return undefined;
  }
}

const isMachO = (file) => {
  try {
    return /Mach-O/.test(run('file', ['-b', file]));
  } catch {
    return false;
  }
};

/** Every Mach-O file under `dir` that isn't a link (a link is signed where it points). */
function machOs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = lstatSync(full, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...machOs(full));
    else if (st.isFile() && isMachO(full)) out.push(full);
  }
  return out;
}

const sign = (identity, target, entitlements) =>
  run('codesign', ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', ...(entitlements ? ['--entitlements', entitlements] : []), target]);

/**
 * Sign the whole app with `identity`, inside out: Tauri signs only the app, its main binary and its
 * sidecars, while notarization checks every Mach-O inside (the daemon's native modules, esbuild,
 * node-pty's helper), each with the hardened runtime and a secure timestamp.
 */
export function signApp(identity, app = defaultApp) {
  if (!existsSync(app)) throw new Error(`No app at ${app}: run tauri build first`);
  const entitlements = path.join(tauri, conf.bundle.macOS.entitlements);
  const resources = path.join(app, 'Contents/Resources');
  const nested = existsSync(resources) ? machOs(resources) : [];
  for (const file of nested) sign(identity, file);
  const widgets = path.join(app, 'Contents/PlugIns/BelugaWidgets.appex');
  if (existsSync(widgets)) sign(identity, widgets, path.join(here, 'widgets/widgets.entitlements'));
  const macos = path.join(app, 'Contents/MacOS');
  const main = conf.mainBinaryName ?? 'beluga-mac';
  for (const name of readdirSync(macos)) if (name !== main) sign(identity, path.join(macos, name), entitlements);
  sign(identity, app, entitlements);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  console.log(`Signed ${path.basename(app)} and ${nested.length} files inside it with ${identity}`);
  refreshUpdater(app);
}

/** The updater's .tar.gz was packed before the signing above: packed again from the signed app, and its .sig made again. */
function refreshUpdater(app) {
  const tar = `${app}.tar.gz`;
  if (!existsSync(tar)) return;
  rmSync(tar);
  rmSync(`${tar}.sig`, { force: true });
  // Without the key this build made none (tauri-build.mjs): this one was an earlier build's.
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) return;
  execFileSync('tar', ['-czf', tar, '-C', path.dirname(app), path.basename(app)], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  loud('npx', ['tauri', 'signer', 'sign', tar]);
}

/** Whether `xcrun notarytool` has the account kept under NOTARY_PROFILE. */
function hasNotaryProfile() {
  try {
    run('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE]);
    return true;
  } catch {
    return false;
  }
}

/** Sign the .dmg, have Apple notarize it, and staple the ticket to it (Gatekeeper then needs no network). */
export function notarize(dmg = defaultDmg) {
  const identity = signingIdentity();
  if (!identity || identity === '-') return console.log('Not notarized: the app is signed ad hoc (no Developer ID in the keychain).');
  if (!existsSync(dmg)) throw new Error(`No .dmg at ${dmg}: run make-dmg.mjs first`);
  sign(identity, dmg);
  if (!hasNotaryProfile()) {
    console.warn(`Signed, not notarized: no "${NOTARY_PROFILE}" profile in the keychain. Once:\n  xcrun notarytool store-credentials ${NOTARY_PROFILE} --team-id ${TEAM_ID} --apple-id <your Apple ID>`);
    return;
  }
  loud('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', NOTARY_PROFILE, '--wait']);
  loud('xcrun', ['stapler', 'staple', dmg]);
  loud('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose', dmg]);
  console.log(`Notarized ${path.basename(dmg)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [step, target] = process.argv.slice(2);
  if (step === 'sign') {
    const identity = signingIdentity();
    if (identity && identity !== '-') signApp(identity, target ? path.resolve(target) : undefined);
    else console.log('Signed ad hoc: no Developer ID in the keychain.');
  } else if (step === 'notarize') notarize(target ? path.resolve(target) : undefined);
  else throw new Error('Usage: developer-id.mjs sign|notarize [path]');
}
