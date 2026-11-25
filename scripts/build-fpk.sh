#!/bin/bash
# 组装并打包飞牛（fnOS）应用：BiliMusic。
#
# 前置条件：
#   1. npm run build:web        生成 dist/ 前端产物
#   2. scripts/build-linux-docker.sh  生成 target-linux/release/bilimusic-server
#   3. 准备 fnpack（放到 tools/fnpack、PATH，或用 FNPACK_BIN 指定）
#
# 用法：
#   ./scripts/build-fpk.sh
#   FPK_VERSION=0.4.5 ./scripts/build-fpk.sh
#   PLATFORM=arm ./scripts/build-fpk.sh   # 需要同架构的 Linux 二进制
#
# 产物：dist-fpk/bilimusic-<version>-<platform>.fpk
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT_DIR/fnos"
DIST_DIR="$ROOT_DIR/dist"
OUT_DIR="${FPK_OUT_DIR:-$ROOT_DIR/dist-fpk}"
BIN="${FPK_BIN:-$ROOT_DIR/target-linux/release/bilimusic-server}"

manifest_value() {
  awk -F '=' -v key="$1" '
    $0 ~ "^"key"[[:space:]]*=" { sub("^[^=]*=", ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print; exit }
  ' "$PKG_DIR/manifest"
}

set_manifest() {
  local key="$1" value="$2" padded
  padded="$(printf '%-22s' "$key")"
  sed -i.bak "s/^${key}[[:space:]]*=.*/${padded}= ${value}/" "$PKG_DIR/manifest"
  rm -f "$PKG_DIR/manifest.bak"
}

VERSION="${FPK_VERSION:-$(manifest_value version)}"
PLATFORM="${PLATFORM:-$(manifest_value platform)}"

[ -f "$DIST_DIR/index.html" ] || { echo "缺少 dist/index.html，请先执行 npm run build:web" >&2; exit 1; }
[ -f "$BIN" ] || { echo "缺少 Linux 二进制 $BIN，请先执行 scripts/build-linux-docker.sh" >&2; exit 1; }
if ! file "$BIN" | grep -q "ELF 64-bit"; then
  echo "$BIN 不是 Linux x86_64 ELF 二进制，请用 scripts/build-linux-docker.sh 构建" >&2
  exit 1
fi

if [ ! -d "$PKG_DIR/app/lib" ]; then
  echo "==> 未找到运行时库 fnos/app/lib，开始收集"
  "$ROOT_DIR/scripts/fetch-linux-runtime-libs.sh" >&2
fi

if [ -n "${FNPACK_BIN:-}" ]; then
  FNPACK="$FNPACK_BIN"
elif command -v fnpack >/dev/null 2>&1; then
  FNPACK="$(command -v fnpack)"
elif [ -x "$ROOT_DIR/tools/fnpack" ]; then
  FNPACK="$ROOT_DIR/tools/fnpack"
else
  echo "未找到 fnpack：请放到 tools/fnpack，或设置 FNPACK_BIN=/abs/path/to/fnpack" >&2
  exit 1
fi

echo "==> 组装应用文件"
rm -rf "$PKG_DIR/app/bin" "$PKG_DIR/app/web"
mkdir -p "$PKG_DIR/app/bin" "$PKG_DIR/app/web"
install -m 0755 "$BIN" "$PKG_DIR/app/bin/bilimusic-server"
cp -R "$DIST_DIR/." "$PKG_DIR/app/web/"
# 启动脚本必须保持可执行
chmod 0755 "$PKG_DIR/cmd/main" "$PKG_DIR"/cmd/*_init 2>/dev/null || true

set_manifest version "$VERSION"
set_manifest platform "$PLATFORM"
"$ROOT_DIR/scripts/check-fpk.sh"

mkdir -p "$OUT_DIR"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
# 默认不签名（本地调试/侧载安装）。需要正式签名时先 fnpack cert import，再设置 FPK_SIGN=1。
SIGN_FLAG="--nosign"
if [ "${FPK_SIGN:-0}" = "1" ]; then
  SIGN_FLAG=""
fi
(
  cd "$BUILD_DIR"
  "$FNPACK" build --directory "$PKG_DIR" $SIGN_FLAG
)

built="$(find "$BUILD_DIR" -maxdepth 1 -name '*.fpk' -print | head -n 1)"
if [ -z "$built" ]; then
  echo "fnpack 完成但没有找到 .fpk 文件" >&2
  exit 1
fi

TARGET="$OUT_DIR/bilimusic-$VERSION-$PLATFORM.fpk"
mv "$built" "$TARGET"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$(basename "$TARGET")" > "$(basename "$TARGET").sha256")
else
  (cd "$OUT_DIR" && shasum -a 256 "$(basename "$TARGET")" > "$(basename "$TARGET").sha256")
fi

echo "安装包：$TARGET"
echo "校验值：$(cut -d ' ' -f 1 "$TARGET.sha256")"
