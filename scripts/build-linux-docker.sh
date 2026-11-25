#!/bin/bash
# 交叉构建飞牛（fnOS，x86_64 Linux）可用的 bilimusic-server。
#
# 依赖 Docker（macOS 上可用 OrbStack / Docker Desktop）。首次会构建一个带
# webkit2gtk 等依赖的构建镜像，后续复用。
#
# 用法：
#   ./scripts/build-linux-docker.sh
#   LINUX_BUILD_PLATFORM=linux/arm64 ./scripts/build-linux-docker.sh   # 需要 arm 包时
#
# 产物：target-linux/release/bilimusic-server
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${LINUX_BUILD_PLATFORM:-linux/amd64}"
IMAGE="${LINUX_BUILD_IMAGE:-bilimusic-linux-builder:bookworm}"
TARGET_DIR="$ROOT_DIR/target-linux"

command -v docker >/dev/null 2>&1 || { echo "未找到 docker，请先启动 OrbStack/Docker Desktop。" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker 守护进程未运行，请先启动 OrbStack/Docker Desktop。" >&2; exit 1; }

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> 构建构建镜像 $IMAGE ($PLATFORM)"
  BUILD_CTX="$(mktemp -d)"
  trap 'rm -rf "$BUILD_CTX"' EXIT
  cat > "$BUILD_CTX/Dockerfile" <<'DOCKERFILE'
FROM rust:1-bookworm
ENV PATH=/usr/local/cargo/bin:$PATH
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev ca-certificates \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
      librsvg2-dev libxdo-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev patchelf \
 && rm -rf /var/lib/apt/lists/*
DOCKERFILE
  docker build --platform "$PLATFORM" -t "$IMAGE" "$BUILD_CTX"
  rm -rf "$BUILD_CTX"
fi

mkdir -p "$TARGET_DIR" "$ROOT_DIR/.cargo-linux"

echo "==> 构建 bilimusic-server"
docker run --rm --platform "$PLATFORM" \
  -v "$ROOT_DIR":/work -w /work \
  -e CARGO_HOME=/work/.cargo-linux \
  -e CARGO_TARGET_DIR=/work/target-linux \
  "$IMAGE" bash -c 'cargo build --release --features server --bin bilimusic-server'

if [ ! -f "$TARGET_DIR/release/bilimusic-server" ]; then
  echo "构建完成但未找到 target-linux/release/bilimusic-server" >&2
  exit 1
fi

# 以 root 构建时修正产物属主，避免后续本地操作受限
if [ "$(id -u)" != "0" ]; then
  docker run --rm --platform "$PLATFORM" -v "$ROOT_DIR":/work "$IMAGE" \
    chown -R "$(id -u):$(id -g)" /work/target-linux /work/.cargo-linux >/dev/null 2>&1 || true
fi

file "$TARGET_DIR/release/bilimusic-server"
echo "$TARGET_DIR/release/bilimusic-server"
