import { defineConfig } from 'vitest/config'
import rawPlugin from 'vite-raw-plugin'

export default defineConfig({
  test: {
    include: ['vitest/**/*.test.ts'],
    globals: true,
    poolOptions: {
      threads: {
        singleThread: true,
      }
    }
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

