#!/usr/bin/env bash
# 模拟器自测:build / install / launch / shot / all
# 用法: sim.sh <命令> [截图输出路径]     在 iOS 工程目录运行(或设 PROJECT)
# 环境变量: PROJECT=工程目录  SIM_NAME=模拟器名(默认第一台可用 iPhone)
#           SCHEME=App  BUNDLE_ID=默认 local.placeholder.app  SETTLE=启动后等待秒数(默认2)
set -euo pipefail
PROJECT="${PROJECT:-$PWD}"; cd "$PROJECT"
SCHEME="${SCHEME:-App}"; SETTLE="${SETTLE:-2}"
export BUNDLE_ID="${BUNDLE_ID:-local.placeholder.app}"   # 模拟器不需要真实 ID;project.yml 读它
export TEAM_ID="${TEAM_ID:-}"
BUILD="$PROJECT/build"; APP="$BUILD/Build/Products/Debug-iphonesimulator/$SCHEME.app"

die() { echo "错误: $*" >&2; exit 1; }
[[ "$(uname)" == Darwin ]] || die "只能在 Mac 上运行"
command -v xcodebuild >/dev/null || die "没有 Xcode"

pick_sim() {
  if [[ -n "${SIM_NAME:-}" ]]; then
    xcrun simctl list devices available | grep -F "$SIM_NAME (" | head -1 | grep -oE '[0-9A-F-]{36}' || true
  else
    xcrun simctl list devices available | grep -E '^\s+iPhone ' | head -1 | grep -oE '[0-9A-F-]{36}' || true
  fi
}
UDID="$(pick_sim)"; [[ -n "$UDID" ]] || die "没有可用的 iPhone 模拟器"

bundle_id() {
  [[ -n "${BUNDLE_ID:-}" ]] && { echo "$BUNDLE_ID"; return; }
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist"
}

cmd_build() {
  if [[ -f project.yml ]]; then command -v xcodegen >/dev/null || die "缺 xcodegen(brew install xcodegen)"; xcodegen generate -q; fi
  xcodebuild -project "$SCHEME.xcodeproj" -scheme "$SCHEME" -configuration Debug \
    -destination "id=$UDID" -derivedDataPath "$BUILD" build -quiet \
    || die "构建失败(上面是编译错误)"
  [[ -d "$APP" ]] || die "没找到 $APP"
}
cmd_install() {
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
  xcrun simctl install "$UDID" "$APP"
}
cmd_launch() { xcrun simctl launch "$UDID" "$(bundle_id)" >/dev/null; sleep "$SETTLE"; }
cmd_shot() {
  local out="${1:-$PROJECT/build/screenshot.png}"; mkdir -p "$(dirname "$out")"
  xcrun simctl io "$UDID" screenshot "$out" >/dev/null 2>&1
  [[ -s "$out" ]] || die "截图失败"
  echo "$out"
}
cmd_all() {
  cmd_build; xcrun simctl boot "$UDID" 2>/dev/null || true
  cmd_install; xcrun simctl terminate "$UDID" "$(bundle_id)" 2>/dev/null || true
  cmd_launch; cmd_shot "${1:-}"
}

case "${1:-}" in
  build) cmd_build ;; install) cmd_install ;; launch) cmd_launch ;;
  shot) shift; cmd_shot "${1:-}" ;; all) shift; cmd_all "${1:-}" ;;
  *) die "用法: sim.sh build|install|launch|shot [路径]|all [路径]" ;;
esac
