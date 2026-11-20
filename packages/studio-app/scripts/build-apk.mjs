#!/usr/bin/env node
/**
 * Synon Studio 的 Android 发布包（SS-100）：`dist/Synon-Studio-<version>.apk`，签在工作室自己的
 * 密钥上（不与 Beluga 共用；换密钥的手机必须先卸载再装）。打完后用 apksigner 核对证书指纹，
 * 与 `signing.json` 不一致就拒绝输出可发布的包。
 *
 *   node scripts/build-apk.mjs             prebuild（clean）→ gradle assembleRelease → 核对 → dist/
 *   node scripts/build-apk.mjs --bump      先给 app.json 的 android.versionCode +1 再构建
 *
 * `app.json` 是版本号与构建号的唯一来源：`expo.version` → versionName，
 * `expo.android.versionCode` → versionCode。
 *
 * 密钥：`~/.synon-release/synon-studio-android.p12`（或 SYNON_STUDIO_ANDROID_KEYSTORE），
 * 口令在钥匙串 `synon-studio-android-release`（或 SYNON_STUDIO_ANDROID_KEY_PASSWORD）。
 * 没有密钥时会在 gradle 里退回 debug 签名，这个脚本随后一定失败——发布包只能出自上面的密钥。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const appJsonPath = path.join(root, 'app.json');
const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')).expo;
const want = JSON.parse(fs.readFileSync(path.join(root, 'signing.json'), 'utf8')).sha256.toLowerCase();

const fail = (msg) => {
  console.error(`build-apk: ${msg}`);
  process.exit(1);
};

const keystore =
  process.env.SYNON_STUDIO_ANDROID_KEYSTORE ?? path.join(home, '.synon-release', 'synon-studio-android.p12');
if (!fs.existsSync(keystore)) {
  fail(`没有签名密钥 ${keystore}（发布包只能用它；换机器时从备份恢复，别新建）`);
}
let password = process.env.SYNON_STUDIO_ANDROID_KEY_PASSWORD;
if (!password) {
  try {
    password = execFileSync(
      'security',
      ['find-generic-password', '-s', 'synon-studio-android-release', '-w'],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    fail('钥匙串里没有密钥口令（synon-studio-android-release）');
  }
}

if (process.argv.includes('--bump')) {
  const json = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const next = Number(json.expo.android?.versionCode ?? 1) + 1;
  json.expo.android = { ...json.expo.android, versionCode: next };
  fs.writeFileSync(appJsonPath, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`build-apk: versionCode ${next} 已写入 app.json`);
}

const version = app.version;
const versionCode = app.android?.versionCode ?? 1;
const sdk = process.env.ANDROID_HOME ?? path.join(home, 'Library', 'Android', 'sdk');
const env = {
  ...process.env,
  CI: '1',
  ANDROID_HOME: sdk,
  JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  SYNON_STUDIO_ANDROID_KEYSTORE: keystore,
  SYNON_STUDIO_ANDROID_KEY_PASSWORD: password,
};

const run = (cmd, args, cwd = root) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (r.status !== 0) fail(`${cmd} ${args[0] ?? ''} failed`);
};

run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--clean']);
fs.writeFileSync(path.join(root, 'android', 'local.properties'), `sdk.dir=${sdk}\n`);
run('./gradlew', ['assembleRelease'], path.join(root, 'android'));

const tools = path.join(sdk, 'build-tools');
const latest = fs
  .readdirSync(tools)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);
if (!latest) fail(`找不到 build-tools（${tools}）`);
const apksigner = path.join(tools, latest, 'apksigner');
const from = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(from)) fail(`没有 ${from}`);

let got;
try {
  const out = execFileSync(apksigner, ['verify', '--print-certs', from], { env, encoding: 'utf8' });
  const hex = /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(out)?.[1];
  got = hex?.match(/../g)?.join(':').toLowerCase();
} catch {
  fail('apksigner 校验失败：这个 APK 没有签名');
}
if (got !== want) {
  fail(
    `这个 APK 签在 ${got ?? '未知证书'} 上，不是工作室的密钥（${want}）。多半是构建时没读到密钥；发布包不能用。`,
  );
}

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const final = path.join(dist, `Synon-Studio-${version}.apk`);
fs.copyFileSync(from, final);
console.log(
  `✓ dist/${path.basename(final)} · ${app.name} ${version} (${versionCode}) · ${(fs.statSync(from).size / 1e6).toFixed(0)} MB · signed with Synon Studio's key`,
);
