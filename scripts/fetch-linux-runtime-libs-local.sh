#!/bin/bash
# 收集 Linux 二进制运行所需的共享库（排除 glibc 核心组件），放入 fnos/app/lib。
#
# 与 scripts/fetch-linux-runtime-libs.sh 的产物一致，但不依赖 Docker：直接在本机
# 用一个「解包出来的 dev sysroot」做 ldd 递归收集。适用于已经在同版本 Debian 上
# 本地构建（见 scripts/build-fpk-local.sh）的场景。
#
# 用法：
#   SYSROOT=/abs/path/to/sysroot ./scripts/fetch-linux-runtime-libs-local.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${FPK_BIN:-$ROOT_DIR/target-linux/release/bilimusic-server}"
LIB_DIR="$ROOT_DIR/fnos/app/lib"
SYSROOT="${SYSROOT:-}"
SYS_LIBDIR="$SYSROOT/usr/lib/x86_64-linux-gnu"

[ -f "$BIN" ] || { echo "缺少 $BIN，请先构建 bilimusic-server" >&2; exit 1; }
[ -d "$SYS_LIBDIR" ] || { echo "缺少 sysroot 库目录 $SYS_LIBDIR" >&2; exit 1; }

rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"

# glibc 核心与加载器由系统提供，不打包，避免与系统版本冲突
SKIP=" libc.so.6 libm.so.6 libdl.so.2 libpthread.so.0 librt.so.1 libresolv.so.2 libutil.so.1 libnsl.so.1 ld-linux-x86-64.so.2 libgcc_s.so.1 linux-vdso.so.1 "

LIB_DIR_ABS="$(cd "$LIB_DIR" && pwd)"
queue="$BIN"
seen=" "
while [ -n "$queue" ]; do
  set -- $queue
  file=$1; shift; queue="$*"
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    name=$(basename "$dep")
    case "$SKIP" in *" $name "*) continue;; esac
    case "$seen" in *" $dep "*) continue;; esac
    seen="$seen$dep "
    # 优先取 sysroot 里的同名库，保证与构建环境一致
    src="$SYS_LIBDIR/$name"
    [ -e "$src" ] || src="$dep"
    # 解析成真实文件后递归，.so 名字与 SONAME 不一致时也不会漏
    cp -L "$src" "$LIB_DIR/$name"
    real=$(readlink -f "$src")
    queue="$queue $LIB_DIR_ABS/$name"
  done < <(LD_LIBRARY_PATH="$SYS_LIBDIR:$LIB_DIR:"$LIB_DIR"" ldd "$file" 2>/dev/null | awk '/=> \//{print $3} /^\//{print $1}')
done

# 补齐 .so.0 之类的直接依赖名（有些库 ldd 只给出 SONAME）
for f in "$LIB_DIR"/*.so*; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  [ -e "$LIB_DIR/$base" ] || cp -L "$f" "$LIB_DIR/$base"
done

strip --strip-unneeded "$LIB_DIR"/*.so* 2>/dev/null || true
echo "运行库：$(du -sh "$LIB_DIR" | cut -f1)，$(ls "$LIB_DIR" | wc -l) 个文件"
