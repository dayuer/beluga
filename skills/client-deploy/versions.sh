#!/usr/bin/env bash
# 版本检查点与回退。每个版本 = 一个 git tag + 一份部署包 + 截图,存在 <项目>/delivery/versions/<tag>/。
# 用法:
#   versions.sh checkpoint <tag> [截图文件...]   客户确认后:建 tag(已有则复用)、打包、存截图
#   versions.sh list                              版本列表(Markdown 表,新的在前)
#   versions.sh show <tag>                        某版详情:日期、说明、截图、包路径
#   versions.sh rollback <tag> [--git]            回到某版:确保有该版的包并写出回退说明;--git 再把源码恢复到该版(新提交,不改历史)
# 环境: PROJECT=<项目目录,默认当前目录>
set -euo pipefail

PROJECT="$(cd "${PROJECT:-.}" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="$(basename "$PROJECT")"
VDIR="$PROJECT/delivery/versions"
cmd="${1:-}"; shift || true

g() { git -C "$PROJECT" "$@"; }
need_tag() { g rev-parse --verify -q "refs/tags/$1" >/dev/null || { echo "没有这个版本: $1" >&2; exit 1; }; }
safe() { case "$1" in */*|*..*|"") echo "版本名不合法: $1" >&2; exit 1 ;; esac; }
tag_date() { g log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M' "$1^{commit}"; }
tag_msg() { g tag -l --format='%(contents:subject)' "$1"; }

case "$cmd" in
checkpoint)
  TAG="${1:?需要 tag}"; shift; safe "$TAG"
  if ! g rev-parse --verify -q "refs/tags/$TAG" >/dev/null; then
    g diff --quiet && g diff --cached --quiet || { echo "有未提交改动,先提交再建检查点" >&2; exit 1; }
    g tag -a "$TAG" -m "${TAG_MESSAGE:-$TAG}"
  fi
  D="$VDIR/$TAG"; mkdir -p "$D/screenshots"
  "$HERE/pack.sh" --ref "$TAG" "$PROJECT" "$D" | tail -n 2
  for s in "$@"; do cp "$s" "$D/screenshots/"; done
  printf '{"tag":"%s","date":"%s","message":"%s","commit":"%s"}\n' \
    "$TAG" "$(tag_date "$TAG")" "$(tag_msg "$TAG" | sed 's/"/\\"/g')" "$(g rev-parse --short "$TAG^{commit}")" > "$D/meta.json"
  echo "CHECKPOINT=$D"
  ;;
list)
  echo "| 版本 | 日期 | 说明 | 截图 | 部署包 |"; echo "|---|---|---|---|---|"
  g tag -l --sort=-version:refname | while read -r t; do
    [ -d "$VDIR/$t" ] || continue
    n=$(find "$VDIR/$t/screenshots" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "| $t | $(tag_date "$t") | $(tag_msg "$t") | $n 张 | $(ls "$VDIR/$t"/*.tar.gz 2>/dev/null | head -1 | xargs -n1 basename 2>/dev/null) |"
  done
  ;;
show)
  TAG="${1:?需要 tag}"; safe "$TAG"; need_tag "$TAG"
  echo "版本: $TAG"; echo "日期: $(tag_date "$TAG")"; echo "说明: $(tag_msg "$TAG")"
  find "$VDIR/$TAG/screenshots" -type f 2>/dev/null | sed 's/^/截图: /'
  ls "$VDIR/$TAG"/*.tar.gz 2>/dev/null | sed 's/^/部署包: /' || true
  ;;
rollback)
  TAG="${1:?需要 tag}"; shift; safe "$TAG"; need_tag "$TAG"
  D="$VDIR/$TAG"
  ls "$D"/*.tar.gz >/dev/null 2>&1 || "$HERE/pack.sh" --ref "$TAG" "$PROJECT" "$D" | tail -n 2
  TGZ="$(ls "$D"/*.tar.gz | head -1)"
  cat > "$D/回退说明.md" <<EOF
# 回退到版本 $TAG

这是 $NAME 的旧版本 $TAG($(tag_date "$TAG"))的完整部署包:\`$(basename "$TGZ")\`。

在你的服务器上(原来部署的那个文件夹的上一级):

1. 把 \`$(basename "$TGZ")\` 传到服务器并解压:\`tar -xzf $(basename "$TGZ")\`
2. 先停掉现在的版本:进入当前版本的文件夹,执行 \`docker compose down\`(如果用的是 HTTPS 版,加 \`-f docker-compose.https.yml\`)
3. 进入解压出来的新文件夹,按里面的《部署说明.md》启动(和第一次部署一样)
4. 打开网址,确认是旧版本的样子;一切正常后,旧的文件夹可以保留几天再删

注意:应用的数据如果存在浏览器本地,回退不会影响;如果有数据库,请先备份再回退。
EOF
  if [ "${1:-}" = "--git" ]; then
    g diff --quiet && g diff --cached --quiet || { echo "有未提交改动,先提交" >&2; exit 1; }
    g diff --name-only -z --diff-filter=A "$TAG" HEAD | xargs -0 -r git -C "$PROJECT" rm -q -f --
    g checkout "$TAG" -- .
    g commit -q --allow-empty -m "回退到 $TAG" && echo "源码已恢复到 $TAG(新提交,历史未改)"
  fi
  echo "ROLLBACK_PACK=$TGZ"; echo "ROLLBACK_DOC=$D/回退说明.md"
  ;;
*) sed -n '2,10p' "$0"; exit 2 ;;
esac
