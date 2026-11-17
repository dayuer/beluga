#!/usr/bin/env bash
# TestFlight 发布:check / archive / upload。上传是对外动作,必须先得到所有者同意。
# 用法(在 iOS 工程目录或设 PROJECT):
#   BUNDLE_ID=com.品牌.应用 TEAM_ID=… testflight.sh check                      检查工具、团队、App ID、下一个构建号(只读)
#   testflight.sh archive                    设构建号 → 签名归档 → 导出 .ipa(本机,不上传)
#   CONFIRM_UPLOAD=yes testflight.sh upload  上传并加入测试组(没有 CONFIRM_UPLOAD=yes 一律拒绝)
# 环境变量: BUNDLE_ID(必须真实) APP_ID(App Store Connect 的 App ID) TEAM_ID(开发者团队) GROUP(测试组名)
#           SCHEME=App  BUILD_NUMBER=可选,默认向 asc 要下一个  EXTERNAL=yes 时附带提交 Beta 审核(外部测试链接需要)
set -euo pipefail
PROJECT="${PROJECT:-$PWD}"; cd "$PROJECT"
SCHEME="${SCHEME:-App}"; OUT="${OUT:-$PROJECT/build/testflight}"
IPA="$OUT/export/$SCHEME.ipa"

die() { echo "错误: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "缺 $1($2)"; }
next_build() { asc builds next-build-number --app "$APP_ID" --version "$(version)" | sed -nE 's/.*"nextBuildNumber":"([0-9]+)".*/\1/p'; }
# 占位 Bundle ID(模板默认值、com.example.* 等)Apple 不会让你注册,提前拦下
require_real_bundle_id() {
  [[ -n "${BUNDLE_ID:-}" ]] || die "请设 BUNDLE_ID,例如 BUNDLE_ID=com.<公司或品牌>.<应用>(要真实、以后可转移的命名)"
  case "$BUNDLE_ID" in
    com.example.*|example.*|local.placeholder.*|*.placeholder.*|com.yourcompany.*|com.test.*)
      die "BUNDLE_ID=$BUNDLE_ID 是占位值,Apple 不会让你注册。请设成真实的、可转移的反向域名,如 BUNDLE_ID=com.<公司或品牌>.<应用>,并和 App Store Connect 里的 App 一致" ;;
  esac
  [[ "$BUNDLE_ID" =~ ^[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+$ ]] || die "BUNDLE_ID=$BUNDLE_ID 格式不对(只能字母数字 . -,至少两段)"
}
version() { grep -E 'MARKETING_VERSION' project.yml | head -1 | sed -E 's/.*MARKETING_VERSION: *"?([0-9.]+)"?.*/\1/'; }

cmd_check() {
  require_real_bundle_id
  need asc "安装并登录 asc,见 asc-basics skill"
  need xcodebuild "需要 Xcode"
  [[ -n "${APP_ID:-}" ]] || die "请设 APP_ID(asc apps list --output table 可查;App 还没建要先问所有者)"
  [[ -n "${TEAM_ID:-}" ]] || die "请设 TEAM_ID(security find-identity -v -p codesigning 里括号内的团队号)"
  security find-identity -v -p codesigning | grep -q "Apple Distribution.*($TEAM_ID)" \
    || die "钥匙串里没有团队 $TEAM_ID 的 Apple Distribution 证书。不要自己创建/吊销证书,告诉所有者缺什么"
  echo "版本 $(version),下一个构建号: $(next_build)"
}

cmd_archive() {
  require_real_bundle_id
  need xcodebuild "需要 Xcode"; [[ -n "${TEAM_ID:-}" ]] || die "请设 TEAM_ID"
  local n="${BUILD_NUMBER:-}"
  if [[ -z "$n" ]]; then need asc "或手动设 BUILD_NUMBER"; [[ -n "${APP_ID:-}" ]] || die "请设 APP_ID"
    n="$(next_build)"; fi
  [[ -n "$n" ]] || die "拿不到构建号"
  command -v xcodegen >/dev/null && [[ -f project.yml ]] && xcodegen generate -q
  rm -rf "$OUT"; mkdir -p "$OUT"
  cat > "$OUT/ExportOptions.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>teamID</key><string>$TEAM_ID</string>
<key>signingStyle</key><string>automatic</string>
</dict></plist>
PL
  xcodebuild archive -project "$SCHEME.xcodeproj" -scheme "$SCHEME" -destination 'generic/platform=iOS' \
    -archivePath "$OUT/$SCHEME.xcarchive" -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGNING_ALLOWED=YES CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$n" -quiet \
    || die "归档失败:多半是证书/描述文件问题,把上面的错误如实告诉所有者"
  xcodebuild -exportArchive -archivePath "$OUT/$SCHEME.xcarchive" -exportPath "$OUT/export" \
    -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates -quiet || die "导出失败"
  [[ -f "$IPA" ]] || die "没找到 $IPA"
  echo "$IPA (构建号 $n)"
}

cmd_upload() {
  [[ "${CONFIRM_UPLOAD:-}" == yes ]] || die "上传会占用构建号并对测试者可见:先问所有者,同意后用 CONFIRM_UPLOAD=yes 运行"
  need asc "见 asc-basics"; [[ -n "${APP_ID:-}" && -n "${GROUP:-}" ]] || die "请设 APP_ID 和 GROUP"
  [[ -f "$IPA" ]] || die "没有 $IPA,先 archive"
  local extra=()
  [[ "${EXTERNAL:-}" == yes ]] && extra=(--submit --confirm)
  asc publish testflight --app "$APP_ID" --ipa "$IPA" --group "$GROUP" --wait "${extra[@]}"
}

case "${1:-}" in
  check) cmd_check ;; archive) cmd_archive ;; upload) cmd_upload ;;
  *) die "用法: testflight.sh check|archive|upload" ;;
esac
