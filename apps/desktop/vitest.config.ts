import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Monaco's worker entry points are multi-megabyte bundles jsdom cannot run,
    // and nothing under test uses the language services they provide. The build
    // config aliases these at the real files; here they resolve to a stub.
    alias: [
      {
        find: /^monaco-editor\/.*\.worker\?worker$/,
        replacement: resolve(__dirname, 'src/renderer/lib/monaco-worker-stub.ts'),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})
