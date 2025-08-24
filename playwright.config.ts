import { defineConfig, devices } from '@playwright/test';

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './test/browser',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry */
  retries: 1,
  /* Ensure at least 4 workers everywhere. Allow override via PW_WORKERS env var, but never below 4. */
  workers: Math.max(4, Number(process.env.PW_WORKERS || 4)),
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Global test timeout - max 20 seconds */
  timeout: 20 * 1000,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:11985',
    
    /* Shorter navigation timeout */
    navigationTimeout: 5 * 1000,
    
    /* Shorter action timeout */
    actionTimeout: 3 * 1000,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // We can add more browsers later if needed
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run test server before starting the tests */
  webServer: {
    command: 'npm run test:server',
    url: 'http://localhost:11985',
    reuseExistingServer: true, // Always reuse existing server
    timeout: 120 * 1000,
  },
});