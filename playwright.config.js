const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4174';
const useLocalServer = !process.env.PLAYWRIGHT_BASE_URL;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: useLocalServer ? {
    command: 'python3 -m http.server 4174',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000
  } : undefined,
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        browserName: 'chromium'
      }
    }
  ]
});
