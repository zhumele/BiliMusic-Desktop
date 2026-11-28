import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fnOS / 浏览器模式的 Tauri API 替身（src/web/*.ts）
const shim = (file: string) => fileURLToPath(new URL(`./src/web/${file}`, import.meta.url))

function frontendProvenance(edition: string): Plugin {
  let target: string | string[] | false
  let publicDir = ''
  async function publicFiles(directory: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(entries.map(entry => {
      const name = prefix + entry.name
      return entry.isDirectory() ? publicFiles(join(directory, entry.name), name + '/') : [name]
    }))
    return files.flat()
  }
  return {
    name: 'bilimusic-frontend-provenance',
    apply: 'build',
    configResolved(config) {
      target = config.build.target
      publicDir = config.build.copyPublicDir ? config.publicDir : ''
    },
    async writeBundle(options, bundle) {
      if (!options.dir) throw new Error('Missing frontend output directory')
      const folder = options.dir
      const copiedFiles = publicDir ? await publicFiles(publicDir) : []
      const filenames = [...new Set([...Object.keys(bundle), ...copiedFiles])].sort()
      const files = Object.fromEntries(await Promise.all(filenames.map(async name => [
        name,
        createHash('sha256').update(await readFile(join(folder, name))).digest('hex'),
      ])))
      await writeFile(join(folder, 'frontend-build.json'), JSON.stringify({
        edition,
        platform: process.env.TAURI_ENV_PLATFORM || process.env.VITE_BILIMUSIC_PLATFORM || 'shared',
        target,
        files,
      }, null, 2))
    },
  }
}

const androidWebViewPreflight: Plugin = {
  name: 'bilimusic-android-webview-preflight',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      const entry = /<script type="module" crossorigin src="([^"]+)"><\/script>/
      if (!entry.test(html)) throw new Error('Missing module entry for Android WebView preflight')
      return html
        .replace(entry, '<meta name="bilimusic-android-entry" content="$1">')
        .replace(/<link rel="modulepreload"[^>]*>/g, '')
    },
  },
}

export default defineConfig(({ mode }) => {
  // web 模式：飞牛 fnOS 通过 HTTP 反向代理访问，Tauri API 换成浏览器实现。
  const web = mode === 'web'
  return {
    plugins: [react(), frontendProvenance(mode === 'large-screen' ? 'large-screen' : 'standard'), ...(mode === 'large-screen' ? [{
      name: 'bilimusic-large-screen-entry',
      transformIndexHtml: { order: 'pre' as const, handler: (html: string) => html.replace('/src/main.tsx', '/src/large-screen/main.tsx') },
    }] : process.env.TAURI_ENV_PLATFORM === 'android' ? [androidWebViewPreflight] : [])],
    resolve: {
      // web 构建：把 Tauri API 替换为浏览器实现（fnOS / 手机网页模式）
      alias: web ? {
        '@tauri-apps/api/core': shim('core.ts'),
        '@tauri-apps/api/event': shim('event.ts'),
        '@tauri-apps/api/window': shim('window.ts'),
        '@tauri-apps/plugin-store': shim('store.ts'),
        '@tauri-apps/plugin-dialog': shim('dialog.ts'),
      } : {},
    },
    base: web ? './' : '/',
    define: {
      'import.meta.env.VITE_BILIMUSIC_EDITION': JSON.stringify(mode === 'large-screen' ? 'large-screen' : 'standard'),
      // web 构建（飞牛 fnOS）没有原生外壳，platform.ts 用它排除原生播放分支。
      'import.meta.env.VITE_BILIMUSIC_SHELL': JSON.stringify(web ? 'web' : 'native'),
      __BILIMUSIC_BUILD_NUMBER__: Number(process.env.BILIMUSIC_BUILD_NUMBER ?? '1'),
    },
    clearScreen: false,
    server: {
      host: process.env.TAURI_DEV_HOST || '127.0.0.1',
      port: 1420,
      strictPort: true,
      // The Tauri build owns src-tauri. Watching target/ crashes Vite on Windows
      // when Cargo replaces a locked .exe (EBUSY) and is wasted work everywhere else.
      watch: { ignored: ['**/artifacts/**', '**/dist-large-screen/**', '**/src-tauri/**'] },
    },
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
      outDir: mode === 'large-screen' ? 'dist-large-screen' : 'dist',
      // Many car head units have a vendor-pinned Android WebView. fnOS serves the
      // app to ordinary browsers, so it keeps the standard (least restrictive) target.
      target: mode === 'large-screen' ? 'chrome66'
        : process.env.TAURI_ENV_PLATFORM === 'android' ? 'chrome91'
          : process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
      sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    },
  }
})
