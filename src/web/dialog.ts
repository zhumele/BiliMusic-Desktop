// 浏览器 / fnOS 模式下的 @tauri-apps/plugin-dialog 替身。
// 服务端无法弹出本机目录选择框，统一返回"未选择"，由后端使用默认下载目录。

export type OpenDialogOptions = {
  directory?: boolean
  multiple?: boolean
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

export type SaveDialogOptions = {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

export async function open(_options?: OpenDialogOptions): Promise<null> {
  return null
}

export async function save(_options?: SaveDialogOptions): Promise<null> {
  return null
}

export async function message(_message: string, _options?: unknown): Promise<void> {
  /* noop */
}

export async function ask(_message: string, _options?: unknown): Promise<boolean> {
  return false
}

export async function confirm(_message: string, _options?: unknown): Promise<boolean> {
  return false
}
