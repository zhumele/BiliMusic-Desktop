# BiliMusic-Desktop → fnOS 直装应用 改造规格（Spec）

## 1. 目标与验收标准

把 `licpp/BiliMusic-Desktop`（Tauri2 + React19 桌面端）改造成可直装在飞牛 fnOS 上的应用包（`.fpk`），并满足：

| # | 验收标准 | 判定方式 |
|---|---|---|
| A1 | 飞牛桌面图标可点击，在飞牛窗口（iframe）中打开应用 | fnOS 安装后桌面启动，窗口加载出首页 |
| A2 | 也可直接用浏览器 `http://<NAS_IP>:8899/` 打开成网页 | 浏览器访问，功能可用 |
| A3 | 功能与桌面端一致：B 站搜索/推荐、播放、歌单/收藏、歌词、登录态、下载到服务器、设置持久化 | 手动点击验证 |
| A4 | 手机浏览器打开自适应，无横向溢出，播放器/导航可用 | 390×844 视口验证 |
| A5 | 代码托管在自己的 Fork，`fnos-web` 分支可复现构建 | GitHub 仓库可见 + 构建脚本可跑 |
| A6 | 产物为符合 fnOS 规范的 fpk（manifest/cmd/config/ui 齐全） | `scripts/check-fpk.sh` 校验通过 |

## 2. 关键结论（来自已完成的代码分析）

- 前端：`src/`，Vite 构建；通过 `@tauri-apps/api/core` 的 `invoke()` 调用 **124 个** Rust 命令（`src-tauri/src/interface/*.rs`）。
- 播放：前端 `new Audio()`（`src/features/player/playerStore.ts`），音频 URL 由 Rust `MediaProxy`（axum，监听 `127.0.0.1:<随机端口>`，`src-tauri/src/infrastructure/media_proxy.rs`）生成，形如 `http://127.0.0.1:<port>/<token>/<id>`。
- 状态：`Database`、`MediaProxy`、`BilibiliProvider`、`LrclibProvider`、`MusicCatalogProvider`、`SyncState`，均在 `lib.rs` 的 `setup` 中以 `app.manage(...)` 注入。
- 桌面专属模块（`desktop_media`/`tray_player`/`mini_player`/`floating_lyrics`/`global_shortcuts`/`sync`）需要窗口/托盘，网页模式下不可用。
- 数据目录来自 `app.path().app_data_dir()`；服务端需改为可由环境变量指定。

## 3. 架构决策（Decision）

### D1（主方案）：复用 Tauri 命令注册 + Mock Runtime 做 IPC 分发

不重写 124 个命令，而是：

1. 在 `lib.rs` 抽出 `pub fn register_commands<R: Runtime>(builder) -> Builder<R>`，把现有 `invoke_handler(generate_handler![...])` 原样迁移进去；`run()` 改为调用它。
2. 新增 `src-tauri/src/server/`，用 `tauri::test::mock_builder()`（需 `tauri/test` feature）构建**无窗口** App，注册同一批命令，`app.manage(...)` 注入我们的状态实例；**不执行**桌面专属 setup（托盘/小窗/歌词窗/快捷键）。
3. HTTP 请求 → 构造 `tauri::webview::InvokeRequest{ body: InvokeBody::Json(args) }` → `tauri::test::get_ipc_response(&webview, req)` → 返回 JSON。
   - 前提校验：Step 0 先写最小 spike 证明该 API 可编译、可返回、可抛错；若不可行，回退到 D1-Alt（见 §8）。

理由：命令与状态管理零改动、与桌面端行为天然一致（A3 的核心保障）；避免手写 90+ 个 handler 造成的行为漂移。

### D2：HTTP 服务 = axum（项目已有依赖）

- `POST /api/invoke/{command}`：请求体为 JSON 对象（camelCase 参数），响应：
  - 成功 `200` + 原始 JSON 返回值；
  - 失败 `400` + `{ "code", "message", "retryable" }`（沿用 `CommandError` 序列化）。
- `GET /api/health`：`{status,version,schemaVersion}`。
- `GET /media/*path`：反向代理到本进程 `MediaProxy` 上游，**透传 `Range`/`Accept-Ranges` 与 `206`**（音频拖动进度必需）。
- `GET /*`：静态托管前端 `dist`，SPA fallback 到 `index.html`。
- 端口/目录配置（环境变量）：`BILIMUSIC_PORT`(默认 8899)、`BILIMUSIC_HOST`(默认 0.0.0.0)、`BILIMUSIC_DATA_DIR`(默认 `~/.bilimusic`)、`BILIMUSIC_WEB_DIR`(默认 `<exe目录>/web`)。

### D3：媒体 URL 同源改写

命令返回值序列化后，把 `http://127.0.0.1:<proxyPort>` 前缀替换为空串（→ 同源 `/media/...`），并用 axum 路由 `/media/*path` 代理到 `MediaProxy`。这样浏览器/手机都能播放，且兼容飞牛挂在 `/cgi/ThirdParty/...` 的反代前缀（用相对路径）。

### D4：前端 Tauri API Shim（只在 web 构建生效）

新增 `src/web/` 下 shim，用 Vite `resolve.alias` 在 `VITE_TARGET=web` 时替换：

- `@tauri-apps/api/core`：`invoke()` → `fetch('/api/invoke/'+cmd)`；`isTauri()` → `true`（关键：`desktopApi.ts` 里 `if (!inDesktopShell) return 空`，必须为 true 才会真正调用后端）；`Channel` 用轮询/SSE 占位。
- `@tauri-apps/plugin-store`：localStorage 实现 `load/get/set/save/delete/clear/entries/keys/values/length`。
- `@tauri-apps/plugin-dialog`：`open` 返回 `null`（服务端无法选本地目录），下载目录由后端固定为 `BILIMUSIC_DATA_DIR/downloads`。
- `@tauri-apps/plugin-opener`：`openUrl` → `window.open`。
- `@tauri-apps/api/event`：`listen/emit/once` 用 `BroadcastChannel` 或 no-op 返回 unlisten。
- 桌面专属命令（`desktop_*`/`tray_*`/`floating_*`/`mini_*`/`global_shortcuts_*`/`sync_*`）在 shim 内置默认返回值表，避免页面报错。

构建脚本：`npm run build:web`（`vite build --mode web`，输出 `dist/`）。

### D5：移动端适配

- `index.html` 保证 `viewport` 含 `width=device-width, initial-scale=1, viewport-fit=cover`；补 `safe-area-inset` 变量。
- 复用现有响应式布局，仅在 390px 下修正：侧栏折叠为底部导航/Tab、播放器条高度与安全区、列表行触控尺寸 ≥44px、长标题省略。
- 用浏览器子代理在 390×844 与 1440×900 下截图核对。

### D6：fnOS fpk 规范

目录（仓库内 `fnos/`，由 `scripts/build-fpk.sh` 组装）：

```
fnos/
  manifest                     # key=value
  ICON.PNG / ICON_256.PNG      # 64/256
  app/ui/config                # 桌面入口 JSON（type=iframe, port=8899, url=/）
  app/ui/images/icon_64.png icon_256.png
  config/privilege.json        # {"defaults":{"run-as":"package"}}
  config/resource.json         # {}
  cmd/main install_init install_callback upgrade_init upgrade_callback \
      uninstall_init uninstall_callback config_init config_callback
```

- `manifest`：`appname=bilimusic`、`version=0.4.4`、`source=thirdparty`、`platform=x86`、`desktop_uidir=ui`、`desktop_applaunch=bilimusic`、`service_port=8899`、`checkport="nc -z 127.0.0.1 8899"`、`ctl_stop=true`、`changelog=...` 等。
- `cmd/main`：`start` 后台启动二进制（`nohup` + PID 文件 + 日志到 `TRIM_TEMP_LOGFILE`），`stop` 杀进程，`status` 未运行 `exit 3`。
- 运行用户为 `package`（非 root），数据目录用 `TRIM_PKGVAR`（→ `BILIMUSIC_DATA_DIR`），Web 资源随包放在 `TRIM_APPDEST/web`。
- 打包用官方 `fnpack build -d fnos`；若无法获取 fnpack，则用 `scripts/build-fpk.sh` 按 fpk = gzip(tar) 结构自行生成并校验。

### D7：构建环境

- fnOS 目标架构 **x86_64**（`platform=x86`），可选 arm64。
- Linux 编译需要 Tauri 依赖：`libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libdbus-1-dev libssl-dev pkg-config build-essential`。用 Docker（`rust:1-bookworm`）构建，产物二进制 + `dist` 一起打包。
- 本机 macOS 仅用于：前端构建、服务端逻辑冒烟（`cargo run --features server`）。macOS 上 `cargo check` 现有 `macos-private-api` allowlist 报错属于既有环境问题，通过 `TAURI_CONFIG` 覆盖或忽略，不影响 Linux 产物。

## 4. 变更文件清单

### 新增
| 文件 | 作用 |
|---|---|
| `src-tauri/src/server/mod.rs` | axum 启动、路由、状态初始化、IPC 分发、媒体代理、静态托管、URL 改写 |
| `src-tauri/src/server/ipc.rs` | `InvokeRequest` 构造与 `get_ipc_response` 调用、错误归一化 |
| `src-tauri/src/server/static_files.rs` | 静态文件 + SPA fallback（可并入 mod.rs） |
| `src-tauri/src/bin/bilimusic-server.rs` | `#[tokio::main]` 入口，调用 `server::run()` |
| `src/web/core.ts` `store.ts` `dialog.ts` `opener.ts` `event.ts` `index.ts` | Tauri API 浏览器 shim |
| `vite.config.web.ts` 或 `vite.config.ts` 内 mode 分支 | web 构建 alias |
| `fnos/**` | fpk 源目录（见 D6） |
| `scripts/build-fpk.sh` `scripts/check-fpk.sh` | 组装与校验 |
| `scripts/build-linux-docker.sh` | Docker 内编译 Linux 二进制 + 前端 |

### 修改
| 文件 | 变更 |
|---|---|
| `src-tauri/Cargo.toml` | 增加 `[features] server = ["tauri/test"]`；`[[bin]]` 声明；`tower-http`（静态文件） |
| `src-tauri/src/lib.rs` | 抽出 `register_commands()`；`pub mod server` |
| `src-tauri/src/infrastructure/database.rs` | 新增 `Database::open_at(dir)`（按目录打开），`open(app)` 复用它 |
| `src-tauri/src/infrastructure/media_proxy.rs` | 新增按端口/路径启动入口，并暴露 `port()`/`base_url()` 访问器 |
| `src/services/desktopApi.ts` 等 | 仅当 shim 需要时最小改动（原则上不改，靠 alias） |
| `index.html` / 全局 CSS | 移动端 viewport、安全区 |
| `package.json` | `build:web` 脚本 |
| `src-tauri/tauri.conf.json` | 如需，增加 server 模式的配置兼容（不改变桌面行为） |

## 5. 非目标

- 不做账号系统/多用户隔离（单实例，与桌面端一致）。
- 不复刻托盘、悬浮歌词、小窗、系统媒体控制、自动更新、云同步（网页模式标记为不可用）。
- 不改 B 站接口实现、不改播放器核心逻辑。

## 6. 验证步骤

1. `cargo run --bin bilimusic-server --features server`（macOS，`BILIMUSIC_WEB_DIR=dist`）→ `curl /api/health` 200。
2. `curl -X POST /api/invoke/bili_search -d '{"keyword":"周杰伦"}'` 返回条目。
3. 浏览器打开 `http://127.0.0.1:8899/`：搜索→播放（`/media` 206）→ 收藏→歌单→歌词→设置持久化（刷新后仍在）。
4. 390×844 视口：无溢出、可播放、导航可用。
5. Docker 构建 Linux 二进制 → `scripts/build-fpk.sh` → `scripts/check-fpk.sh` → 得到 `bilimusic_0.4.4_x86.fpk`。
6. 推送 `fnos-web` 分支到 `fork`。

## 7. 风险与回退

| 风险 | 应对 |
|---|---|
| `tauri::test::get_ipc_response` / `InvokeRequest` 字段随版本变化 | Step 0 spike 先验证；失败则 D1-Alt：复制命令体为 `server/handlers.rs`，把 `State<'_,T>` 换成 `&T`，只覆盖前端实际调用的命令（约 60 个），其余返回明确"不支持"错误 |
| MockRuntime 下 `generate_handler!` 的桌面命令类型不满足 `CommandArg` | 用 `#[cfg(feature="server")]` 把桌面专属命令排除出注册列表（server 构建时），并让 shim 返回默认值 |
| Linux 缺少 webkit2gtk 等编译依赖 | Docker 内一次性安装；CI 脚本固化 |
| fnOS 反代前缀导致绝对路径 404 | 前端 `base: './'`、媒体用相对路径 `/media`、必要时读取 `X-Forwarded-Prefix` |
| 无法获取 fnpack | 自研 `build-fpk.sh`（tar+gzip），按官方目录规范校验 |

## 8. 审批要点

批准后按 `tasks.md` 顺序执行；Step 0（spike）若失败将先回报再切换 D1-Alt。
