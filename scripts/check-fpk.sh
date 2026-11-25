#!/bin/bash
# 校验 fnOS 应用目录（fnos/）是否满足 fnpack 打包要求与运行约定。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="${FPK_DIR:-$ROOT_DIR/fnos}"
MANIFEST="$PKG_DIR/manifest"

fail() { echo "校验失败：$1" >&2; exit 1; }

[ -f "$MANIFEST" ] || fail "缺少 $MANIFEST"

manifest_value() {
  awk -F '=' -v key="$1" '
    $0 ~ "^"key"[[:space:]]*=" {
      sub("^[^=]*=", "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      print
      exit
    }
  ' "$MANIFEST"
}

for key in appname version display_name platform desktop_uidir desktop_applaunchname service_port; do
  [ -n "$(manifest_value "$key")" ] || fail "manifest 缺少 $key"
done

appname="$(manifest_value appname)"
version="$(manifest_value version)"
platform="$(manifest_value platform)"
uidir="$(manifest_value desktop_uidir)"
launch="$(manifest_value desktop_applaunchname)"
port="$(manifest_value service_port)"

[[ "$appname" =~ ^[a-z0-9][a-z0-9_]*$ ]] || fail "appname 只能包含小写字母、数字与下划线：$appname"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || fail "version 需为 x.y.z 形式：$version"
case "$platform" in
  x86|arm|loongarch|risc-v|all) ;;
  *) fail "platform 取值不支持：$platform" ;;
esac
[[ "$port" =~ ^[0-9]+$ ]] || fail "service_port 需为数字：$port"

[ -f "$PKG_DIR/config/privilege" ] || fail "缺少 config/privilege"
[ -f "$PKG_DIR/config/resource" ] || fail "缺少 config/resource"
python3 - "$PKG_DIR" <<'PY' || fail "config/privilege、config/resource 或 app/ui/config 不是合法 JSON"
import json, sys, os
root = sys.argv[1]
privilege = json.load(open(os.path.join(root, "config/privilege"), encoding="utf-8"))
assert privilege.get("defaults", {}).get("run-as") in ("package", "root"), "config/privilege 需要 defaults.run-as"
json.load(open(os.path.join(root, "config/resource"), encoding="utf-8"))
ui = json.load(open(os.path.join(root, "app/ui/config"), encoding="utf-8"))
PY

[ -d "$PKG_DIR/app/$uidir" ] || fail "缺少 app/$uidir 目录"
[ -f "$PKG_DIR/app/$uidir/config" ] || fail "缺少 app/$uidir/config"
python3 - "$PKG_DIR/app/$uidir/config" "$launch" "$port" <<'PY' || fail "app/ui/config 中的桌面入口配置不完整"
import json, sys
config = json.load(open(sys.argv[1], encoding="utf-8"))
launch, port = sys.argv[2], sys.argv[3]
entry = config.get(".url", {}).get(launch)
assert entry, f"app/ui/config 缺少入口 {launch}"
assert entry.get("type") in ("url", "iframe"), "入口 type 需为 url 或 iframe"
entry_port = str(entry.get("port"))
# 飞牛不会替换 {port} 占位符，入口必须写与 manifest.service_port 一致的固定端口
assert entry_port == port, f"入口 port 需为固定数字且等于 manifest.service_port（{port}），不能使用占位符"
PY

for icon in "$PKG_DIR/ICON.PNG" "$PKG_DIR/ICON_256.PNG" "$PKG_DIR/app/$uidir/images/icon_64.png" "$PKG_DIR/app/$uidir/images/icon_256.png"; do
  [ -f "$icon" ] || fail "缺少图标 $icon"
done

[ -x "$PKG_DIR/cmd/main" ] || fail "cmd/main 不存在或不可执行"
[ -d "$PKG_DIR/wizard" ] || fail "缺少 wizard/ 目录"

echo "fnpack 校验通过：$appname $version ($platform) 端口 $port"
