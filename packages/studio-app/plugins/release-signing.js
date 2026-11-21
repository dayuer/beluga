// 发布用的 APK 签在 Synon Studio 自己的密钥上（SS-100），不与 Beluga 共用：
// 手机的更新只认同一个签名，换密钥就必须先卸载重装。密钥默认在
// ~/.synon-release/synon-studio-android.p12（或 SYNON_STUDIO_ANDROID_KEYSTORE），
// 口令在钥匙串 "synon-studio-android-release"（或 SYNON_STUDIO_ANDROID_KEY_PASSWORD），
// 由 scripts/build-apk.mjs 读出来传给 gradle。没有密钥时退回 debug 签名：只适合自己试装，
// 不能当作发布包。
const { withAppBuildGradle } = require('expo/config-plugins');

const CONFIG = `    signingConfigs {
        if (System.getenv('SYNON_STUDIO_ANDROID_KEYSTORE')) {
            release {
                storeFile file(System.getenv('SYNON_STUDIO_ANDROID_KEYSTORE'))
                storePassword System.getenv('SYNON_STUDIO_ANDROID_KEY_PASSWORD')
                keyAlias System.getenv('SYNON_STUDIO_ANDROID_KEY_ALIAS') ?: 'synon-studio'
                keyPassword System.getenv('SYNON_STUDIO_ANDROID_KEY_PASSWORD')
            }
        } else {
            logger.warn('Synon Studio: no SYNON_STUDIO_ANDROID_KEYSTORE, so this release build is signed with the debug key (not for release)')
        }
        debug {`;

const PICK =
  "signingConfig System.getenv('SYNON_STUDIO_ANDROID_KEYSTORE') ? signingConfigs.release : signingConfigs.debug";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (g.includes('SYNON_STUDIO_ANDROID_KEYSTORE')) return c;
    const head = /    signingConfigs \{\n        debug \{/;
    const release = /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/;
    if (!head.test(g) || !release.test(g)) {
      throw new Error('release-signing: app/build.gradle no longer looks as expected');
    }
    g = g.replace(head, CONFIG).replace(release, `$1${PICK}`);
    c.modResults.contents = g;
    return c;
  });
};
