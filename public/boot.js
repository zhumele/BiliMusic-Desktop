// Paint the stored theme before the module loads. Keep this in sync with
// src/domain/theme.ts: anything that is not light/dark/system is dark, and a
// `system` preference resolves through the media query when the WebView has one.
try {
  var preference = localStorage.getItem('bilimusic-theme')
  var theme = preference === 'light' ? 'light' : 'dark'
  if (preference === 'system' && typeof window.matchMedia === 'function') {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)')
    if (scheme.media !== 'not all') theme = scheme.matches ? 'dark' : 'light'
  }
  document.documentElement.dataset.theme = theme
} catch (_) {}

// 飞牛/fnOS 通过局域网 HTTP 访问时不是安全上下文，crypto.randomUUID 不存在。
// src/shared/randomUuid.ts 已在应用代码里兜底，这里再补一个全局实现，避免第三方
// 代码调用 randomUUID 时抛错把页面卡在启动画面。getRandomValues 不受该限制。
try {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID !== 'function') {
    var __bilimusicUUID = function () {
      var bytes = new Uint8Array(16)
      if (typeof window.crypto.getRandomValues === 'function') {
        window.crypto.getRandomValues(bytes)
      } else {
        for (var i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      var hex = ''
      for (var j = 0; j < 16; j += 1) hex += (bytes[j] + 0x100).toString(16).slice(1)
      return (
        hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
      )
    }
    try {
      window.crypto.randomUUID = __bilimusicUUID
    } catch (_) {
      try {
        Object.defineProperty(window.crypto, 'randomUUID', { value: __bilimusicUUID, configurable: true })
      } catch (_) {}
    }
  }
} catch (_) {}

document.addEventListener('DOMContentLoaded', function () {
  var entry = document.querySelector('meta[name="bilimusic-android-entry"]')
  if (!entry) return
  var chromium = /(?:^|\s)Chrome\/(\d+)\./.exec(navigator.userAgent)
  if (chromium && Number(chromium[1]) >= 91) {
    var script = document.createElement('script')
    script.type = 'module'
    script.crossOrigin = 'anonymous'
    script.src = entry.content
    document.head.appendChild(script)
  } else {
    var splash = document.getElementById('app-bootstrap')
    splash.removeAttribute('aria-label')
    splash.setAttribute('data-webview-upgrade', '')
    document.getElementById('app-webview-upgrade').hidden = false
  }
})
