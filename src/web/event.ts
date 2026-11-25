// 浏览器 / fnOS 模式下的 @tauri-apps/api/event 替身（同页 BroadcastChannel + 本地派发）。

export type UnlistenFn = () => void

export type Event<T> = {
  event: string
  id: number
  payload: T
}

type Handler = (event: Event<unknown>) => void

const listeners = new Map<string, Set<Handler>>()
let nextEventId = 1
let bus: BroadcastChannel | null | undefined

function ensureBus(): BroadcastChannel | null {
  if (bus !== undefined) return bus
  try {
    bus = new BroadcastChannel('bilimusic-web')
    bus.onmessage = (message) => {
      const data = message.data as { event?: string; payload?: unknown } | undefined
      if (data?.event) dispatch(data.event, data.payload)
    }
  } catch {
    bus = null
  }
  return bus
}

function dispatch(event: string, payload: unknown) {
  const handlers = listeners.get(event)
  if (!handlers) return
  for (const handler of [...handlers]) {
    handler({ event, id: nextEventId++, payload })
  }
}

export async function listen<T>(
  event: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const handlers = listeners.get(event) ?? new Set<Handler>()
  handlers.add(handler as Handler)
  listeners.set(event, handlers)
  return () => {
    handlers.delete(handler as Handler)
  }
}

export async function once<T>(
  event: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const unlisten = await listen<T>(event, (payload) => {
    unlisten()
    handler(payload)
  })
  return unlisten
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  dispatch(event, payload)
  ensureBus()?.postMessage({ event, payload })
}

export async function emitTo(_target: string, event: string, payload?: unknown): Promise<void> {
  return emit(event, payload)
}
