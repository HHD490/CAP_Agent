import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Windows Nitro HTTP smoke is opt-in: npx vitest run tests/smoke
    setupFiles: ['tests/helpers/setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, '.'),
      '@': resolve(__dirname, '.')
    }
  }
})
