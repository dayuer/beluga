#!/usr/bin/env node
/**
 * Synon Studio iOS 发布构建（SS-99）：走工作室自己的 Apple 团队（Apple Distribution 证书 +
 * TestFlight）。`app.json` 是版本号与构建号的唯一来源：
 *   - `expo.version`           → CFBundleShortVersionString（对人说的版本号）
 *   - `expo.ios.buildNumber`   → CFBundleVersion（App Store Connect 里唯一，不能重用）
 *
 *   node scripts/build-ios.mjs check              只读：工具、团队、证书、版本与下一个构建号
 *   node scripts/build-ios.mjs archive [--bump]   prebuild → 归档 → 导出 dist/ios/*.ipa（不上传）
 *   CONFIRM_UPLOAD=yes node scripts/build-ios.mjs upload
 *                                                  上传 TestFlight（对外动作，先得到所有者同意）
 *
 * `--bump` 会向 App Store Connect 要下一个空构建号（没有 ASC_APP_ID 时按本地 +1），写回 app.json，
 * 再构建，所以构建号不会两个来源各写一份。
 *
 * 环境变量：
 *   IOS_TEAM_ID     开发者团队号（默认工作室团队 L9YRXEKYN2）
 *   ASC_APP_ID      App Store Connect 的 App ID（archive --bump 与 upload 用）
 *   GROUP           TestFlight 测试组名（upload 用）
 *   EXTERNAL=yes    外部测试，附带提交 Beta 审核
 *   BUILD_NUMBER    直接指定本次构建号，不写回 app.json
 *   ANDROID_HOME 无关；iOS 只需要 Xcode、CocoaPods 与 asc。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = path.join(root, 'app.json');
const readConfig = () => JSON.parse(fs.readFileSync(appJsonPath, 'utf8')).expo;
const app = readConfig();
const bundleId = app.ios?.bundleIdentifier;
const team = process.env.IOS_TEAM_ID ?? 'L9YRXEKYN2';
const scheme = 'SynonStudio';
// 签名：工作室团队 + App Store 证书。Xcode 里登了 Apple 账号时用 Automatic；这台构建机没有账号，
// 就用已安装的 App Store 描述文件做 Manual（IOS_SIGNING=manual，描述文件由 asc profiles 建好并 local install）。
const signing = process.env.IOS_SIGNING ?? 'automatic';
const profileName = process.env.IOS_PROFILE ?? 'Synon Studio App Store';
// 导出方式：App Store（默认）或 ad-hoc（真机直装，SS-240），取 IOS_EXPORT_METHOD。
const exportMethod = process.env.IOS_EXPORT_METHOD ?? 'app-store-connect';
const identity =
  process.env.IOS_SIGN_IDENTITY ?? `Apple Distribution: Hangzhou Yaoxing Intelligent Technology Co., Ltd. (${team})`;
const out = path.join(root, 'dist', 'ios');
const archivePath = path.join(out, `${scheme}.xcarchive`);
const exportPath = path.join(out, 'export');

const fail = (msg) => {
  console.error(`build-ios: ${msg}`);
  process.exit(1);
};

const have = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

const asc = (args, { read = true } = {}) => {
  const r = spawnSync('asc', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    if (read) return null;
    fail(`asc ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  }
  return (r.stdout || '').trim();
};

const nextBuildNumber = (version) => {
  const appId = process.env.ASC_APP_ID;
  if (appId) {
    const raw = asc(['builds', 'next-build-number', '--app', appId, '--version', version]);
    const n = raw && /"nextBuildNumber"\s*:\s*"?(\d+)"?/.exec(raw)?.[1];
    if (n) return Number(n);
  }
  return Number(app.ios?.buildNumber ?? '1') + 1;
};

const writeBuildNumber = (n) => {
  const json = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  json.expo.ios = { ...json.expo.ios, buildNumber: String(n) };
  fs.writeFileSync(appJsonPath, `${JSON.stringify(json, null, 2)}\n`);
};

const buildNumber = () => process.env.BUILD_NUMBER ?? String(app.ios?.buildNumber ?? '1');

function cmdCheck() {
  const missing = [
    !have('xcodebuild', ['-version']) ? 'xcodebuild' : null,
    !have('pod') ? 'pod' : null,
  ].filter(Boolean);
  if (missing.length) fail(`缺 ${missing.join('、')}（需要 Xcode 与其命令行工具、CocoaPods）`);
  if (!have('asc')) fail('缺 asc：见 skills/beluga-apple/skills/asc-basics/SKILL.md');
  if (!bundleId || bundleId === 'com.example.app') fail('app.json 里没有真实的 ios.bundleIdentifier');
  const ids = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  if (!new RegExp(`Apple Distribution[^"]*\\(${team}\\)`).test(ids)) {
    fail(`钥匙串里没有团队 ${team} 的 Apple Distribution 证书（不要自己创建或吊销证书，告诉所有者缺什么）`);
  }
  const registered = asc(['bundle-ids', 'list', '--paginate', '--output', 'json']);
  const known = registered && new RegExp(`"identifier"\\s*:\\s*"${bundleId.replace(/\./g, '\\.')}"`).test(registered);
  console.log(`bundle id   ${bundleId}（${known ? '已在开发者后台登记' : '尚未登记；首次归档时自动签名会登记，或先 asc bundle-ids create'}）`);
  console.log(`team        ${team}`);
  console.log(`scheme      ${scheme}`);
  console.log(`签名        ${signing === 'manual' ? `Manual · ${profileName}` : 'Automatic（需要 Xcode › Settings › Accounts 里登了 Apple 账号）'}`);
  console.log(`版本        ${app.version}（构建号 ${buildNumber()}）`);
  console.log(`下一个构建号 ${process.env.ASC_APP_ID ? nextBuildNumber(app.version) : '（设 ASC_APP_ID 后向 App Store Connect 要）'}`);
  if (!process.env.ASC_APP_ID) console.log('ASC_APP_ID  未设置：upload 与 --bump 的联网取号需要它（asc apps list）');
}

function cmdArchive() {
  const bump = process.argv.includes('--bump');
  let n = buildNumber();
  if (bump && !process.env.BUILD_NUMBER) {
    n = String(nextBuildNumber(app.version));
    writeBuildNumber(n);
    console.log(`build-ios: 构建号 ${n} 已写入 app.json`);
  }

  console.log('build-ios: prebuild（clean，含 pod install）');
  const pre = spawnSync('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8', LC_ALL: process.env.LC_ALL || 'en_US.UTF-8' },
  });
  if (pre.status !== 0) fail('expo prebuild 失败');

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  console.log(`build-ios: archive（${app.version} / ${n}，团队 ${team}，${signing}）`);
  const signingArgs = signing === 'manual'
    ? [
        'CODE_SIGN_STYLE=Manual',
        `CODE_SIGN_IDENTITY=${identity}`,
        `PROVISIONING_PROFILE_SPECIFIER=${profileName}`,
      ]
    : ['CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates'];
  const archive = spawnSync('xcodebuild', [
    'archive',
    '-workspace', path.join(root, 'ios', `${scheme}.xcworkspace`),
    '-scheme', scheme,
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-archivePath', archivePath,
    `DEVELOPMENT_TEAM=${team}`,
    ...signingArgs,
    `CURRENT_PROJECT_VERSION=${n}`,
    `MARKETING_VERSION=${app.version}`,
    '-quiet',
  ], { cwd: root, stdio: 'inherit' });
  if (archive.status !== 0) fail('归档失败：多半是证书 / 描述文件问题，把上面的错误如实告诉所有者');

  const options = path.join(out, 'ExportOptions.plist');
  fs.writeFileSync(options, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>${exportMethod}</string>
<key>teamID</key><string>${team}</string>
<key>signingStyle</key><string>${signing}</string>${
    signing === 'manual'
      ? `
<key>provisioningProfiles</key><dict><key>${bundleId}</key><string>${profileName}</string></dict>`
      : ''
  }
</dict></plist>
`);
  const exp = spawnSync('xcodebuild', [
    '-exportArchive',
    '-archivePath', archivePath,
    '-exportPath', exportPath,
    '-exportOptionsPlist', options,
    '-allowProvisioningUpdates',
    '-quiet',
  ], { cwd: root, stdio: 'inherit' });
  if (exp.status !== 0) fail('导出失败');

  const ipa = fs.readdirSync(exportPath).find((name) => name.endsWith('.ipa'));
  if (!ipa) fail(`没找到导出的 .ipa（${exportPath}）`);
  const final = path.join(out, `Synon-Studio-${app.version}-${n}.ipa`);
  fs.copyFileSync(path.join(exportPath, ipa), final);
  console.log(`✓ ${path.relative(root, final)}`);
  console.log(`  TestFlight 上传：CONFIRM_UPLOAD=yes ASC_APP_ID=<app id> GROUP="<组名>" node scripts/build-ios.mjs upload`);
}

function cmdUpload() {
  if (process.env.CONFIRM_UPLOAD !== 'yes') {
    fail('上传会占用构建号并对测试者可见：先得到所有者同意，再 CONFIRM_UPLOAD=yes 运行');
  }
  const appId = process.env.ASC_APP_ID;
  const group = process.env.GROUP;
  if (!appId || !group) fail('请设 ASC_APP_ID 与 GROUP（asc apps list / asc testflight groups list）');
  const ipa = fs
    .readdirSync(out)
    .filter((name) => name.endsWith('.ipa'))
    .map((name) => path.join(out, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!ipa) fail(`没有可上传的 .ipa（${out}），先 node scripts/build-ios.mjs archive`);

  const args = ['publish', 'testflight', '--app', appId, '--ipa', ipa, '--group', group, '--wait'];
  if (process.env.EXTERNAL === 'yes') args.push('--submit', '--confirm');
  console.log(`build-ios: ${ipa} → TestFlight 组「${group}」`);
  const r = spawnSync('asc', args, { stdio: 'inherit' });
  if (r.status !== 0) fail('上传失败（看上面的 asc 输出）');
}

const command = process.argv[2];
if (command === 'check') cmdCheck();
else if (command === 'archive') cmdArchive();
else if (command === 'upload') cmdUpload();
else {
  console.error('用法：node scripts/build-ios.mjs check | archive [--bump] | upload');
  process.exit(1);
}
