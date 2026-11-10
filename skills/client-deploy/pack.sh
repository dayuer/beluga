#!/usr/bin/env bash
# 把客户项目(Vite 静态站)打成"可自行部署的交付包"。不联网上传、不需要任何服务器凭据。
# 用法: pack.sh [--ref <tag>] [项目目录] [输出目录]
# 输出: <输出目录>/<项目名>-<版本>/ 以及同名 .tar.gz;最后一行 PACK_DIR=... / PACK_TGZ=...
set -euo pipefail

REF=""; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:?--ref 需要 tag}"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
DIR="$(cd "${ARGS[0]:-.}" && pwd)"
OUT="${ARGS[1]:-$DIR/delivery}"
NAME="$(basename "$DIR")"
HERE="$(cd "$(dirname "$0")" && pwd)"
VER="$(git -C "$DIR" describe --tags --exact-match "${REF:-HEAD}" 2>/dev/null || git -C "$DIR" rev-parse --short "${REF:-HEAD}" 2>/dev/null || date +%Y%m%d)"

SRC="$DIR"; TMP=""
if [ -n "$REF" ]; then
  git -C "$DIR" rev-parse --verify -q "$REF^{commit}" >/dev/null || { echo "找不到版本 $REF" >&2; exit 1; }
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  git -C "$DIR" archive "$REF" | tar -x -C "$TMP"
  SRC="$TMP"
fi

echo "构建 $NAME $VER ..."
INSTALL=ci; [ -f "$SRC/package-lock.json" ] || INSTALL=install
( cd "$SRC" && { [ -d node_modules ] || npm "$INSTALL" --silent; } && npm run build --silent )

PKG="$OUT/$NAME-$VER"
rm -rf "$PKG"; mkdir -p "$PKG/site" "$PKG/nginx"
cp -R "$SRC/dist/." "$PKG/site/"
cp "$HERE/templates/Dockerfile" "$HERE/templates/docker-compose.yml" \
   "$HERE/templates/docker-compose.https.yml" "$HERE/templates/.env.example" "$PKG/"
cp "$HERE/templates/nginx-container.conf" "$PKG/nginx/default.conf"
cp "$HERE/templates/nginx-host.conf.example" "$PKG/nginx/host-nginx.conf.example"
cp "$HERE/templates/Caddyfile" "$PKG/Caddyfile"
sed -e "s/{{NAME}}/$NAME/g" -e "s/{{VERSION}}/$VER/g" "$HERE/templates/部署说明.md" > "$PKG/部署说明.md"
echo "$VER" > "$PKG/VERSION"

# 包里不许有密钥
if find "$PKG" \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name 'id_*' \) | grep -q .; then
  echo "交付包里发现疑似密钥文件,已中止" >&2; exit 1
fi
if grep -rIlE 'BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}' "$PKG" >/dev/null; then
  echo "交付包内容里发现疑似密钥,已中止" >&2; exit 1
fi

( cd "$OUT" && tar -czf "$NAME-$VER.tar.gz" "$NAME-$VER" )
echo "PACK_DIR=$PKG"; echo "PACK_TGZ=$OUT/$NAME-$VER.tar.gz"
