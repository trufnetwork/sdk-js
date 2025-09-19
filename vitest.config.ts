// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    includeSource: ['src/**/*.{js,ts}'],
    setupFiles: ['dotenv/config', 'disposablestack/auto'],
    maxConcurrency: 1, // Disable concurrency to avoid nonce errors
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    hookTimeout: 300000, // 300 seconds for setup hooks (Docker containers in CI)
  },
  ssr: {
    noExternal: ['@trufnetwork/kwil-js'],
  },
})
