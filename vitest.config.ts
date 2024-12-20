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
    globals: true,
    poolOptions: {
      threads: {
        singleThread: true,
      }
    },
    // @ts-ignore it's okay, trust me
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

