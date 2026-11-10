#!/usr/bin/env bash
# 项目结束时的交付移交:最终部署包 + 完整 git 库(bundle)+ 历史版本 + 中文交付说明,打成一个 tar.gz。
# 用法: handover.sh [项目目录] [--transfer-github <新所有者>]
#   默认只在本机打包,不对外做任何事。
#   --transfer-github 会把 GitHub 远程库转给客户账号(对外、不可轻易撤回):只有客户明确同意后才加这个参数。
# 输出: PACK_TGZ=... 以及 (转移时) TRANSFER=...
set -euo pipefail

DIR="."; NEW_OWNER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --transfer-github) NEW_OWNER="${2:?需要新所有者}"; shift 2 ;;
    *) DIR="$1"; shift ;;
  esac
done
PROJECT="$(cd "$DIR" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="$(basename "$PROJECT")"
g() { git -C "$PROJECT" "$@"; }

g diff --quiet && g diff --cached --quiet || { echo "有未提交改动,先提交" >&2; exit 1; }
LATEST="$(g tag -l --sort=-version:refname | head -1)"
[ -n "$LATEST" ] || { echo "还没有任何版本 tag,不能交付" >&2; exit 1; }
DATE="$(date +%Y-%m-%d)"
OUT="$PROJECT/delivery/handover"
ROOT="$OUT/$NAME-交付-$DATE"
rm -rf "$ROOT"; mkdir -p "$ROOT/部署包" "$ROOT/源码"

# 1. 最终部署包(最新 tag)
"$HERE/pack.sh" --ref "$LATEST" "$PROJECT" "$ROOT/.pack" >/dev/null
cp -R "$ROOT/.pack/$NAME-$LATEST/." "$ROOT/部署包/"; rm -rf "$ROOT/.pack"

# 2. 完整 git 库(含所有 tag)
g bundle create "$ROOT/源码/$NAME.bundle" --all >/dev/null 2>&1
g bundle verify "$ROOT/源码/$NAME.bundle" >/dev/null 2>&1 || { echo "源码 bundle 校验失败" >&2; exit 1; }

# 3. 历史版本
{
  echo "# 历史版本"; echo
  echo "| 版本 | 日期 | 说明 |"; echo "|---|---|---|"
  g tag -l --sort=-version:refname | while read -r t; do
    echo "| $t | $(g log -1 --format=%cd --date=format:%Y-%m-%d "$t^{commit}") | $(g tag -l --format='%(contents:subject)' "$t") |"
  done
} > "$ROOT/历史版本.md"

# 4. 交付说明
sed -e "s/{{NAME}}/$NAME/g" -e "s/{{DATE}}/$DATE/g" -e "s/{{VERSION}}/$LATEST/g" "$HERE/templates/交付说明.md" > "$ROOT/交付说明.md"

# 包里不许有密钥(源码 bundle 是二进制,另查提交里的凭据文件)
if find "$ROOT" \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name 'id_*' \) | grep -q . \
   || g ls-files | grep -Eiq '(^|/)(\.env|[^/]*\.pem|[^/]*\.key|id_(rsa|ed25519))$'; then
  echo "发现疑似密钥文件,已中止" >&2; exit 1
fi

( cd "$OUT" && tar -czf "$NAME-交付-$DATE.tar.gz" "$NAME-交付-$DATE" )
echo "PACK_TGZ=$OUT/$NAME-交付-$DATE.tar.gz"

# 5. 可选:转移 GitHub 仓库
if [ -n "$NEW_OWNER" ]; then
  REPO="$(g remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
  gh api -X POST "repos/$REPO/transfer" -f new_owner="$NEW_OWNER" >/dev/null
  echo "TRANSFER=$REPO -> $NEW_OWNER(对方需在邮箱里接受转移)"
fi
