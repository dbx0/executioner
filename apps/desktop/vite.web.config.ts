import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { RENDERER_CSP } from './renderer-csp.js'

/** Stamp the shared renderer CSP into the portable page. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'executioner-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: RENDERER_CSP }, injectTo: 'head-prepend' },
    ],
  }
}

/** Browser build of the desktop renderer, emitted into team-server/public. */
export default defineConfig({
  root: 'src/renderer',
  base: '/',
  build: {
    // Portable UI assets served by team-server at `/`.
    outDir: resolve('../team-server/public'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/renderer/index.html') },
  },
  resolve: {
    alias: [
      {
        find: /^monaco-editor\/(.*\.worker)\?worker$/,
        replacement: `${resolve('node_modules/monaco-editor/esm/vs')}/$1.js?worker`,
      },
    ],
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
  },
  plugins: [react(), contentSecurityPolicy()],
})
