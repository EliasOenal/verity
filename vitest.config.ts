import { defineConfig } from 'vitest/config'
import rawPlugin from 'vite-raw-plugin'

import { DefaultReporter } from 'vitest/reporters';

class silent extends DefaultReporter {
  onFinished() {
    // Override this to suppress final output
  }
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/browser/**/*.playwright.test.ts'],
    globals: true,
    pool: 'forks',
    // Enforce at least 4 workers; allow override with VITEST_MAX_WORKERS (never below 4)
    minWorkers: 4,
    maxWorkers: Math.max(4, Number(process.env.VITEST_MAX_WORKERS || 4)),
    poolOptions: {
      // uncomment the following line if you want strictly sequential runs for debugging
      // forks: { singleFork: true, },
      threads: {
        singleThread: true,
      }
    },
    sequence: { hooks: 'list', },
  // Uncomment the following lines to suppress all vitest output,
  // preventing our own debug output from being overwritten
  // reporters: [silent],
  },
  plugins: [
    rawPlugin({
      fileRegex: /\.(html|css)$/,
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
        target: "esnext",
    },
  },
})

