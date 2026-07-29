import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/** Dedicated config so Windows Nitro smoke is discoverable via `npm run test:smoke`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/smoke/**/*.test.ts'],
    setupFiles: ['tests/helpers/setup.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, '.'),
      '@': resolve(__dirname, '.')
    }
  }
})
