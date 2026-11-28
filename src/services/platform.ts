import { isTauri } from '@tauri-apps/api/core'
// Layout edition is independent from the native audio platform.
export const isLargeScreen = import.meta.env?.VITE_BILIMUSIC_EDITION === 'large-screen'
// 只有真正的原生外壳（Tauri WebView）才具备原生播放器；浏览器/fnOS 的 web 构建虽然也有
// 后端，但播放走 HTMLAudioElement，不能进入原生播放分支。web 构建由 vite 注入
// VITE_BILIMUSIC_SHELL='web'，其余平台保持上游的 isTauri() 判定。
export const isWebShell = import.meta.env?.VITE_BILIMUSIC_SHELL === 'web'
const nativeShell = isTauri() && !isWebShell
// OHOS ArkWeb may advertise an Android UA. The dedicated build sets this marker
// before bundling the same frontend used by the other four platforms.
export const isOHOS = nativeShell && import.meta.env?.VITE_BILIMUSIC_PLATFORM === 'ohos'
export const isAndroid = nativeShell && !isOHOS && /Android/i.test(navigator.userAgent)
const androidChromium = isAndroid && /\bChrome\/(\d+)/.exec(navigator.userAgent)
// The old car WebView can stall when video is seeked at HAVE_METADATA.
export const needsDecodedFrameBeforeVideoSeek = isLargeScreen && !!androidChromium && Number(androidChromium[1]) < 75
// iPadOS may use a desktop Safari user agent.
export const isIOS = nativeShell && !isOHOS && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
// 原生移动播放能力（Android/iOS/OHOS 插件）
export const isNativeMobile = isAndroid || isIOS || isOHOS
// 布局层面的移动端：手机/平板浏览器也应使用移动布局，即使没有原生播放器。
// 仅在 web 构建（飞牛 fnOS 浏览器访问）生效，原生四端保持上游的 isNativeMobile 语义。
const mobileUserAgent = isWebShell && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
export const isMobile = isNativeMobile || mobileUserAgent
