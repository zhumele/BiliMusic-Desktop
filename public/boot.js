try { document.documentElement.dataset.theme = localStorage.getItem('bilimusic-theme') === 'light' ? 'light' : 'dark' } catch (_) {}

// 局域网 HTTP 访问不是安全上下文，crypto.randomUUID 不存在，这里补一个实现。
// getRandomValues 不受安全上下文限制，仍然用它生成随机数。
if (!(window.crypto && typeof window.crypto.randomUUID === 'function')) {
  var __bilimusicUUID = function () {
    var bytes = new Uint8Array(16)
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
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
