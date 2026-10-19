import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * The renderer's Content-Security-Policy. Scripts come only from the bundle, so
 * text that reaches the page (a finding, a file, an agent's markdown) can never
 * run as code; the network is the loopback engine and nothing else, apart from
 * the favicon service the secrets list shows logos from. Styles allow inline
 * because React style props and Monaco both set them.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * Stamp the CSP into the built page only. The dev server injects inline
 * scripts for hot reload that a strict policy would block, and dev is not what
 * ships.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'executioner-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: RENDERER_CSP }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // The app is ESM ("type":"module") and the renderer is sandboxed, so the
        // preload must be emitted as unambiguous CommonJS (.cjs) to load at all.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    server: {
      // The dev server's port is the renderer's localStorage origin, so it has to
      // be fixed and must never auto-bump: vite's default 5173 is taken by half
      // the dev tools on a machine, and a silent bump to 5174 strands every open
      // engagement, agent tab and recent in an origin the app no longer reads.
      // strictPort makes that collision a startup error instead of lost state.
      // 61337 sits above the ephemeral range (32768-60999), so it cannot be taken
      // by an outbound socket either.
      port: 61337,
      strictPort: true,
    },
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
    resolve: {
      // Monaco 0.56 ships `"./*": "./esm/vs/*.js"` as its exports map, which
      // swallows the `?worker` query and resolves to `esm/vs/...?worker.js`.
      // The alias plugin sees the id with its query attached, so match the
      // query explicitly and point straight at the real worker files.
      alias: [
        {
          find: /^monaco-editor\/(.*\.worker)\?worker$/,
          replacement: `${resolve('node_modules/monaco-editor/esm/vs')}/$1.js?worker`,
        },
      ],
    },
    optimizeDeps: {
      // Monaco's worker entry points carry a `?worker` query that Vite's dev
      // dependency optimizer cannot pre-bundle: it writes no artifact and then
      // fails with "optimized info should be defined", which breaks `dev` while
      // leaving `build` perfectly fine. Excluding monaco keeps the workers on
      // the normal resolve path in dev.
      exclude: ['monaco-editor'],
    },
    plugins: [react(), contentSecurityPolicy()],
  },
})
