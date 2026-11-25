# 任务分解（tasks.md）

> 依据 `spec.md`。按顺序执行，每个 Step 完成后更新 TodoWrite。

## Step 0：可行性 spike（必须先做，~最小改动）
- [x] 0.1 `src-tauri/Cargo.toml` 加 `[features] server = ["tauri/test"]`；临时 `examples/mock_ipc.rs` 构建 mock app + 注册 1 个命令，调用 `tauri::test::get_ipc_response`。
- [x] 0.2 验证：成功返回 JSON；错误命令返回 `CommandError` JSON；`State<'_, Database>` 可注入。
- [x] 0.3 记录最终可用的 `InvokeRequest` 字段写法（`callback/error/url/body/headers/invoke_key`）。
- [x] 0.4 失败则停止并回报，转 D1-Alt。

## Step 1：后端基础设施改造
- [x] 1.1 `infrastructure/database.rs`：`pub fn open_at(dir: &Path) -> Result<Self>`，`open(app)` 改为调用它。
- [x] 1.2 `infrastructure/media_proxy.rs`：增加 `pub fn port(&self)->u16` / `base_url()`；确认可在无 AppHandle 场景启动（`start()` 已具备，若缓存依赖 AppHandle 则新增 `start_at(dir, port)`）。
- [x] 1.3 `src-tauri/src/lib.rs`：抽出 `pub fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R>`，`run()` 复用之；加 `pub mod server;`。

## Step 2：HTTP 服务（server 模块）
- [x] 2.1 `server/mod.rs`：读取 env（PORT/HOST/DATA_DIR/WEB_DIR）；构建 mock App（注册命令 + manage Database/MediaProxy/Bilibili/Lrclib/MusicCatalog/SyncState）；创建 `main` webview stub。
- [x] 2.2 `server/ipc.rs`：`dispatch(cmd, args) -> Result<Value, CommandError>`；错误归一化（无 code 时 `code="INVOKE_ERROR"`）。
- [x] 2.3 `POST /api/invoke/:command`、`GET /api/health`。
- [x] 2.4 `GET /media/*path` → 代理 `MediaProxy`，透传 Range/206/Content-Type/Content-Length。
- [x] 2.5 静态托管 + SPA fallback；`Cache-Control` 对 `index.html` no-cache。
- [x] 2.6 响应序列化后替换 `http://127.0.0.1:<port>` → `/media`（同源代理，保留 Range/206）。
- [x] 2.7 优雅退出（SIGTERM 停 axum + 落库）。
- [x] 2.8 `src/bin/bilimusic-server.rs` 入口。

## Step 3：前端 Web 适配
- [x] 3.1 grep 全部 `@tauri-apps/*` 引用，列清单。
- [x] 3.2 `src/web/*` shim：core/store/dialog/opener/event。
- [x] 3.3 `vite.config.ts` 按 `mode==='web'` 注入 alias + `base:'./'`。
- [x] 3.4 `package.json`：`"build:web": "vite build --mode web"`。
- [x] 3.5 设置项持久化（plugin-store 已 shim 到 localStorage）。

## Step 4：移动端适配
- [x] 4.1 `index.html` viewport / `viewport-fit=cover`。
- [x] 4.2 全局 CSS 安全区变量；播放器条、底部导航、侧栏折叠。
- [x] 4.3 390×844 截图核对并修正溢出/点击区。

## Step 5：本地冒烟验证（macOS）
- [x] 5.1 `npm run build:web`；`cargo run --bin bilimusic-server --features server`。
- [x] 5.2 `curl /api/health`、`curl -X POST /api/invoke/bili_search`。
- [x] 5.3 浏览器子代理：搜索→播放→收藏→歌单→刷新持久化；390 视口。
- [x] 5.4 修复发现的问题，回归。

## Step 6：Linux 构建 + fpk 打包
- [x] 6.1 `scripts/build-linux-docker.sh`：构建带 webkit2gtk/gtk/soup 等依赖的 `linux/amd64` 镜像，输出 `target-linux/release/bilimusic-server`。
- [x] 6.2 `fnos/` 目录：manifest、config/privilege、config/resource、cmd/*、app/ui/config、图标（64/256 png）。
- [x] 6.3 `scripts/build-fpk.sh`：组装 `app/{bin,web,ui,lib}` 并调用 `fnpack build --nosign` 生成 `.fpk`。
- [x] 6.4 `scripts/check-fpk.sh`：校验 manifest 必填键、version 语义化、cmd 可执行、port、ui/config JSON。
- [x] 6.5 启动脚本以包用户创建数据目录并写 `info.log`；安装阶段不写 root 目录。
- [x] 6.6 `scripts/fetch-linux-runtime-libs.sh`：把 WebKitGTK/GTK 等共享库随包附带（`fnos/app/lib`），避免依赖飞牛系统预装；已在纯净 Debian 12 容器验证可启动。

## Step 7：交付
- [x] 7.1 `git add` + commit（`feat(fnos): web server mode + fpk packaging`）。
- [x] 7.2 push 到 `fork` 的 `fnos-web` 分支。
- [x] 7.3 输出：安装包路径、安装方式、端口、默认账号/数据目录、已知限制。
