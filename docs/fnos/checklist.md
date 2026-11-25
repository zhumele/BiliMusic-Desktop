# 验收清单（checklist.md）

> 对应 `spec.md` 与 `tasks.md`。逐项勾选，失败项回到 `tasks.md` 补任务后重新验证。

## 后端服务（Web 形态）
- [x] `GET /api/health` 返回 `{"app":"ready","database":"ready","schemaVersion":13}`
- [x] `POST /api/invoke/bili_search` 能返回真实搜索条目
- [x] `POST /api/invoke/track_playback_plan` 返回的音频地址已改写为同源 `/media/...`
- [x] `GET /media/...` 透传 Range，返回 `206 Partial Content` 与 `audio/mp4`
- [x] 媒体代理重建端口后，仍能按最新地址转发（不再出现 502/回落到 index.html）
- [x] 进程收到 SIGTERM 时能优雅退出

## 浏览器端功能一致性
- [x] 桌面视口：搜索 → 播放，进度持续推进且无「暂时无法播放」
- [x] 收藏写入成功（`library_toggle_favorite`），收藏列表可读回
- [x] 歌单创建成功（`playlist_create`）
- [x] 刷新页面后当前曲目与播放进度恢复
- [x] 网页模式不再输出依赖 AVFoundation 的 HLS 地址（浏览器可直接播放）

## 移动端适配
- [x] 390×844 视口无横向溢出
- [x] 移动端底部导航、播放条正常显示
- [x] 移动端浏览器可完成搜索 → 播放，且不再触发原生插件报错
- [x] 移动端使用原生音频插件的分支已收敛到 `isNativeMobile`，浏览器走 `<audio>` 路径

## 桌面端不回归
- [x] 未启用 `server` feature 时 `cargo check` 通过（桌面端仍可编译）

## 飞牛（fnOS）应用包
- [x] `fnos/` 含 manifest、config/privilege、config/resource、cmd/*、app/ui/config、图标、wizard
- [x] `scripts/check-fpk.sh` 校验通过
- [x] `fnpack build` 可生成 `.fpk`，且 `app.tgz` 内含 `bin/`、`web/`、`ui/`
- [ ] Linux 二进制为 x86_64 ELF（`scripts/build-linux-docker.sh` 产物）
- [ ] `dist-fpk/bilimusic-0.4.4-x86.fpk` 使用真实 Linux 二进制重新打包
- [ ] `cmd/main` 以普通权限启动、写入 `info.log`，`status` 在未运行时返回 3

## 交付
- [ ] 代码提交并推送到 fork 的 `fnos-web` 分支
