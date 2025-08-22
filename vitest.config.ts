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
    poolOptions: {
      // uncomment the following line if you want strictly sequential runs for debugging
      // forks: { singleFork: true, },
      threads: {
        singleThread: true,
      }
    },
    sequence: { hooks: 'list', },
    // uncomment the following line to suppress all vitest output,
    // preventing our own debug output from being overwritten
    // @ts-expect-error it's okay, trust me
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

