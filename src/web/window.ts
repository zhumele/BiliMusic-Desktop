// 浏览器 / fnOS 模式下的 @tauri-apps/api/window 替身。
// 网页里没有原生窗口，返回一个"哑"窗口对象，避免小窗/悬浮歌词逻辑报错。

const noop = async () => undefined

export type WebWindow = {
  label: string
  [key: string]: unknown
}

function createWindow(label = 'main'): WebWindow {
  const base: WebWindow = { label }
  return new Proxy(base, {
    get(target, property) {
      if (property === 'then') return undefined
      if (property in target) return target[property as string]
      if (property === 'isVisible') return async () => true
      if (property === 'isFullscreen') return async () => false
      if (property === 'theme') return async () => null
      if (property === 'onCloseRequested' || property === 'listen' || property === 'once') {
        return async () => () => undefined
      }
      return noop
    },
  })
}

export function getCurrentWindow(): WebWindow {
  return createWindow('main')
}

export function getAllWindows(): WebWindow[] {
  return [createWindow('main')]
}

export function getCurrentWebviewWindow(): WebWindow {
  return createWindow('main')
}
