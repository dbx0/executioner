import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    // Connections, secrets, skills and saved agents are user-level. Point the
    // whole suite at a throwaway directory so a test run never reads — or
    // writes — the real ~/.executioner.
    setupFiles: ['./scripts/test-setup.ts'],
  },
})
