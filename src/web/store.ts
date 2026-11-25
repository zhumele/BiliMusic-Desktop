// 浏览器 / fnOS 模式下的 @tauri-apps/plugin-store 替身（localStorage 持久化）。

export type StoreOptions = {
  autoSave?: boolean | number
  defaults?: Record<string, unknown>
  createNew?: boolean
}

const prefix = 'bilimusic-store:'

export class Store {
  private readonly storageKey: string
  private readonly options: StoreOptions

  constructor(path: string, options: StoreOptions = {}) {
    this.storageKey = `${prefix}${path}`
    this.options = options
    const defaults = options.defaults
    if (defaults && this.readRaw() === null) {
      this.writeRaw(defaults)
    }
  }

  private readRaw(): Record<string, unknown> | null {
    try {
      const text = window.localStorage.getItem(this.storageKey)
      return text ? (JSON.parse(text) as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  private writeRaw(value: Record<string, unknown>) {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(value))
    } catch {
      /* localStorage 不可用时静默降级为内存态 */
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const data = this.readRaw() ?? {}
    return data[key] as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = this.readRaw() ?? {}
    data[key] = value
    this.writeRaw(data)
  }

  async has(key: string): Promise<boolean> {
    return key in (this.readRaw() ?? {})
  }

  async delete(key: string): Promise<boolean> {
    const data = this.readRaw() ?? {}
    const existed = key in data
    delete data[key]
    this.writeRaw(data)
    return existed
  }

  async clear(): Promise<void> {
    this.writeRaw({})
  }

  async reset(): Promise<void> {
    this.writeRaw({ ...(this.options.defaults ?? {}) })
  }

  async save(): Promise<void> {
    this.writeRaw(this.readRaw() ?? {})
  }

  async reload(): Promise<void> {
    /* noop */
  }

  async close(): Promise<void> {
    /* noop */
  }

  async entries<T>(): Promise<[string, T][]> {
    return Object.entries(this.readRaw() ?? {}) as [string, T][]
  }

  async keys(): Promise<string[]> {
    return Object.keys(this.readRaw() ?? {})
  }

  async values<T>(): Promise<T[]> {
    return Object.values(this.readRaw() ?? {}) as T[]
  }

  async length(): Promise<number> {
    return Object.keys(this.readRaw() ?? {}).length
  }
}

const stores = new Map<string, Store>()

export async function load(path: string, options: StoreOptions = {}): Promise<Store> {
  const existing = stores.get(path)
  if (existing) return existing
  const store = new Store(path, options)
  stores.set(path, store)
  return store
}

export async function getStore(path: string): Promise<Store> {
  return load(path)
}

export async function createStore(path: string, options: StoreOptions = {}): Promise<Store> {
  return load(path, options)
}
