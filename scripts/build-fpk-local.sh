#!/bin/bash
# 在飞牛主机本机（Linux x86_64）上直接构建并打包 BiliMusic 飞牛应用。
#
# 与 scripts/build-fpk.sh 的区别：不需要 Docker，直接使用本机 Rust 工具链 +
# 本地解包的 dev sysroot 构建 bilimusic-server，再组装 fnos/ 目录并用 fnpack 打包。
#
# 前置条件：
#   1. npm ci && npm run build:web            生成 dist/
#   2. 本机已安装 Rust（RUSTUP_HOME/CARGO_HOME 指向本地目录即可）
#   3. SYSROOT 指向已解包 webkit2gtk-4.1-dev 等 dev 包的目录
#
# 用法：
#   SYSROOT=/abs/sysroot ./scripts/build-fpk-local.sh
#   FPK_VERSION=0.4.6.1 SYSROOT=/abs/sysroot ./scripts/build-fpk-local.sh
#
# 产物：dist-fpk/bilimusic-<version>-<platform>.fpk
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT_DIR/fnos"
DIST_DIR="$ROOT_DIR/dist"
OUT_DIR="${FPK_OUT_DIR:-$ROOT_DIR/dist-fpk}"
BIN="${FPK_BIN:-$ROOT_DIR/target-linux/release/bilimusic-server}"
SYSROOT="${SYSROOT:?请设置 SYSROOT 指向解包后的 dev sysroot}"

manifest_value() {
  awk -F '=' -v key="$1" '
    $0 ~ "^"key"[[:space:]]*=" { sub("^[^=]*=", ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print; exit }
  ' "$PKG_DIR/manifest"
}

VERSION="${FPK_VERSION:-$(manifest_value version)}"
PLATFORM="${PLATFORM:-$(manifest_value platform)}"

[ -f "$DIST_DIR/index.html" ] || { echo "缺少 dist/index.html，请先执行 npm run build:web" >&2; exit 1; }
[ -f "$BIN" ] || { echo "缺少 Linux 二进制 $BIN，请先构建 bilimusic-server" >&2; exit 1; }
file "$BIN" | grep -q "ELF 64-bit" || { echo "$BIN 不是 Linux ELF 二进制" >&2; exit 1; }
command -v fnpack >/dev/null 2>&1 || { echo "未找到 fnpack" >&2; exit 1; }

echo "==> 组装应用文件"
rm -rf "$PKG_DIR/app/bin" "$PKG_DIR/app/web"
mkdir -p "$PKG_DIR/app/bin" "$PKG_DIR/app/web"
install -m 0755 "$BIN" "$PKG_DIR/app/bin/bilimusic-server"
cp -R "$DIST_DIR/." "$PKG_DIR/app/web/"
chmod 0755 "$PKG_DIR/cmd/main" "$PKG_DIR"/cmd/*_init "$PKG_DIR"/cmd/*_callback 2>/dev/null || true
if [ -d "$PKG_DIR/app/lib" ]; then
  chmod 0755 "$PKG_DIR/app/lib"/*.so* 2>/dev/null || true
fi
find "$PKG_DIR/app/bin" -type f -exec chmod 0755 {} + 2>/dev/null || true
find "$PKG_DIR/cmd" -type f -exec chmod 0755 {} + 2>/dev/null || true

# manifest 版本号
python3 - "$PKG_DIR/manifest" "$VERSION" "$PLATFORM" <<'PY'
import re, sys
path, version, platform = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding='utf-8').read()
for key, value in (('version', version), ('platform', platform)):
    text = re.sub(rf'^{key}\s*=.*$', f'{key:<22}= {value}', text, count=1, flags=re.M)
open(path, 'w', encoding='utf-8').write(text)
PY

"$ROOT_DIR/scripts/check-fpk.sh"

mkdir -p "$OUT_DIR"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
(
  cd "$BUILD_DIR"
  fnpack build --directory "$PKG_DIR"
)
built="$(find "$BUILD_DIR" -maxdepth 1 -name '*.fpk' -print | head -n 1)"
[ -n "$built" ] || { echo "fnpack 完成但没有找到 .fpk" >&2; exit 1; }

TARGET="$OUT_DIR/bilimusic-$VERSION-$PLATFORM.fpk"
mv "$built" "$TARGET"
(cd "$OUT_DIR" && sha256sum "$(basename "$TARGET")" > "$(basename "$TARGET").sha256")

echo "安装包：$TARGET"
echo "校验值：$(cut -d' ' -f1 "$TARGET.sha256")"
