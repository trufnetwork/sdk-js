// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    includeSource: [''],
    setupFiles: ['disposablestack/auto'],
    maxConcurrency: 1, // Disable concurrency to avoid nonce errors
    fileParallelism: false,
    projects: [
      {
        test: { // Inner test config for node project
          name: 'node',
          environment: 'node',
          include: [
            'src/**/*.test.ts',
            'src/**/*.spec.ts',
            'tests/**/*.test.ts',
            'tests/**/*.spec.ts',
          ],
          exclude: [
            'src/**/*.browser.test.ts',
            'src/**/*.browser.spec.ts',
            'tests/**/*.browser.test.ts',
            'tests/**/*.browser.spec.ts',
          ],
        }
      },
      {
        test: { // Inner test config for browser project
          name: 'browser',
          browser: {
            enabled: true,
            provider: 'playwright',
            instances: [
              { browser: 'chromium', headless: true },
            ],
          },
          include: [
            'src/**/*.browser.test.ts',
            'src/**/*.browser.spec.ts',
            'tests/**/*.browser.test.ts',
            'tests/**/*.browser.spec.ts',
          ],
        }
      },
    ],
  },
})
