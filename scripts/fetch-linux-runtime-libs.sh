#!/bin/bash
# 收集 Linux 二进制运行所需的共享库（排除 glibc 核心组件），放入 fnos/app/lib，
# 使应用在未安装 WebKitGTK 的飞牛系统上也能启动。
#
# 用法：./scripts/fetch-linux-runtime-libs.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${LINUX_BUILD_IMAGE:-bilimusic-linux-builder:bookworm}"
PLATFORM="${LINUX_BUILD_PLATFORM:-linux/amd64}"
BIN="$ROOT_DIR/target-linux/release/bilimusic-server"
LIB_DIR="$ROOT_DIR/fnos/app/lib"

[ -f "$BIN" ] || { echo "缺少 $BIN，请先执行 scripts/build-linux-docker.sh" >&2; exit 1; }

docker run --rm --platform "$PLATFORM" \
  -v "$ROOT_DIR":/work -e LIB_DIR=/work/fnos/app/lib \
  "$IMAGE" bash -c '
set -euo pipefail
BIN=/work/target-linux/release/bilimusic-server
rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"
# glibc 核心与加载器由系统提供，不打包，避免与系统版本冲突
SKIP=" libc.so.6 libm.so.6 libdl.so.2 libpthread.so.0 librt.so.1 libresolv.so.2 libutil.so.1 libnsl.so.1 ld-linux-x86-64.so.2 libgcc_s.so.1 linux-vdso.so.1 "
queue="$BIN"
seen=""
while [ -n "$queue" ]; do
  set -- $queue
  file=$1; shift; queue="$*"
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    name=$(basename "$dep")
    case "$SKIP" in *" $name "*) continue;; esac
    case " $seen " in *" $dep "*) continue;; esac
    seen="$seen $dep"
    cp -L "$dep" "$LIB_DIR/$name"
    queue="$queue $dep"
  done < <(ldd "$file" 2>/dev/null | awk "/=> \\//{print \$3} /^\\//{print \$1}")
done
strip --strip-unneeded "$LIB_DIR"/*.so* 2>/dev/null || true
du -sh "$LIB_DIR"
ls "$LIB_DIR" | wc -l
'
