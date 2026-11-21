#!/bin/zsh
# go.sh <viewName> <shotName> [tap text...]: push a plan state, restart the app on the list, open the first request, shoot.
cd "$(dirname "$0")"; export OVERLAY_DIR="${OVERLAY_DIR:-$PWD/../../.beluga/scratch/overlay}"
a() { node adbui.mjs "$@" 2>&1 | grep -v "no such hash"; }
node --experimental-strip-types push.mjs "$1" 2>&1 | grep -v "no such hash\|Warning\|ExperimentalWarning\|node --trace"
adb -s ${ANDROID_SERIAL:-324750623054} shell am force-stop com.synon.studio
adb -s ${ANDROID_SERIAL:-324750623054} shell monkey -p com.synon.studio -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 4
a tap "${3:-饮水打卡, 刚刚}"
sleep 2
a shot "$2"
