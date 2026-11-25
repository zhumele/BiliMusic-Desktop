import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const shim = (file: string) => fileURLToPath(new URL(`./src/web/${file}`, import.meta.url))

export default defineConfig(({ mode }) => {
  const web = mode === 'web'
  return {
  plugins: [react(), ...(mode === 'large-screen' ? [{
    name: 'bilimusic-large-screen-entry',
    transformIndexHtml: { order: 'pre' as const, handler: (html: string) => html.replace('/src/main.tsx', '/src/large-screen/main.tsx') },
  }] : [])],
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
    __BILIMUSIC_BUILD_NUMBER__: Number(process.env.BILIMUSIC_BUILD_NUMBER ?? '1'),
  },
  clearScreen: false,
  server: {
    host: process.env.TAURI_DEV_HOST || '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/dist-large-screen/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: mode === 'large-screen' ? 'dist-large-screen' : 'dist',
    // Many car head units have a vendor-pinned Android WebView.
    target: mode === 'large-screen' ? 'chrome66'
      : ['windows', 'android'].includes(process.env.TAURI_ENV_PLATFORM || '') ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  }
})
