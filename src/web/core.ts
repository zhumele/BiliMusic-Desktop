// 浏览器 / fnOS 模式下的 @tauri-apps/api/core 替身。
// 通过 HTTP 调用 Rust 服务端的命令分发器。

export type InvokeArgs = Record<string, unknown>

export type PluginListener<T = unknown> = {
  plugin: string
  event: string
  channelId: number
  unregister(): Promise<void>
}

let nextChannelId = 1

/** 桌面专属命令在 web 模式下的兜底返回值，避免页面报错。 */
const unsupported: Record<string, unknown> = {
  desktop_media_update: null,
  tray_player_snapshot: null,
  tray_player_action: null,
  desktop_mini_state: false,
  desktop_mini_set: null,
  desktop_mini_panel: null,
  floating_lyrics_snapshot: null,
  floating_lyrics_update: null,
  floating_lyrics_enable: null,
  floating_lyrics_control: null,
  floating_lyrics_configure: null,
  floating_lyrics_unlock: null,
  floating_lyrics_unlock_ready: null,
  global_shortcuts_apply: null,
  global_shortcuts_show: null,
  window_close_to_tray: false,
  app_check_update: null,
  app_download_update: null,
  app_install_update: null,
  app_open_download_page: null,
  diagnostics_save_report: null,
  diagnostic_environment: null,
  download_track: false,
  local_playlist_pick: null,
  mobile_download_directory: '',
  batch_match_snapshot: null,
  batch_match_commit: null,
  lyric_match_version: '',
  linked_batch_match_job: null,
  linked_batch_match_start: null,
  linked_batch_match_update: null,
  sync_status: {
    config: {
      enabled: false,
      provider: 'webdav',
      uid: '',
      url: '',
      history: false,
      statistics: false,
      initialized: false,
      deviceId: '',
    },
    records: 0,
    bytes: 0,
    trackRepair: null,
  },
  sync_devices: [],
  sync_retire_device: null,
  sync_background: null,
  sync_diagnostics: [],
  sync_connect: null,
  sync_pause: null,
  sync_disconnect: null,
  sync_now: { conflicts: [], records: 0, bytes: 0, changed: false, skipped: true },
  sync_conflict_options: [],
  sync_import_guest: null,
  sync_hydrate_sources: null,
  sync_current_track: null,
  sync_export: null,
  sync_delete_cloud: null,
  sync_archive_invalid_track_references: null,
  listening_sync: null,
  listening_sync_configure: null,
  // 浏览器/fnOS 没有第二个 WebView：网易云只能走扫码登录，网页登录与
  // Android 专属的下载目录在 web 模式下直接兜底。
  netease_web_login_cancel: null,
  android_download_destination: null,
  ios_player_start: null,
  ios_player_stop: null,
  android_player_start: null,
  android_player_stop: null,
}

/**
 * 浏览器/fnOS 模式下会被拒绝的命令：照抄 Rust 端非桌面平台的返回值，
 * 让界面显示同样的提示，而不是静默成功。
 */
const rejected: Record<string, string> = {
  // 上游 iOS/OHOS 分支：没有第二个 WebView，只能扫码。
  netease_web_login: '当前平台请使用扫码登录',
}

export function isTauri(): boolean {
  return true
}

export function convertFileSrc(path: string): string {
  return path
}

export const TAURI_BUNDLE_TYPE = 'web'

export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  // 浏览器里没有系统 opener：直接开新标签页，等价于桌面端点「前往 B 站」。
  if (command === 'bili_open_verification_page') {
    window.open('https://www.bilibili.com/', '_blank', 'noopener,noreferrer')
    return undefined as T
  }
  if (Object.prototype.hasOwnProperty.call(rejected, command)) {
    throw { code: 'UNSUPPORTED_WEB', message: rejected[command], retryable: false }
  }
  if (Object.prototype.hasOwnProperty.call(unsupported, command)) {
    return unsupported[command] as T
  }
  const response = await fetch(`/api/invoke/${encodeURIComponent(command)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  })
  const text = await response.text()
  if (!response.ok) {
    let payload: unknown = { code: 'INVOKE_ERROR', message: text || response.statusText, retryable: false }
    try {
      payload = text ? JSON.parse(text) : payload
    } catch {
      /* keep raw text as message */
    }
    throw payload
  }
  return (text ? JSON.parse(text) : null) as T
}

export class Channel<T = unknown> {
  readonly id: number
  onmessage?: (message: T) => void

  constructor(onmessage?: (message: T) => void) {
    this.id = nextChannelId++
    this.onmessage = onmessage
  }

  toJSON(): Record<string, unknown> {
    return { __channel__: this.id }
  }
}

export async function addPluginListener<T = unknown>(
  plugin: string,
  event: string,
  _handler: (payload: T) => void,
): Promise<PluginListener<T>> {
  return {
    plugin,
    event,
    channelId: nextChannelId++,
    unregister: async () => undefined,
  }
}
