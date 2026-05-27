# Testing

## Auth-backed Playwright smoke tests

Firebase/Auth is intentionally restricted to the deployed GitHub Pages origin. Authenticated Playwright tests should run against production GitHub Pages with a dedicated test account:

```sh
PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual
```

Local URLs such as `localhost`, `127.0.0.1`, and `file://` should not be added to production Firebase/API-key restrictions just to make these tests pass. Local Playwright runs skip auth-backed flows unless a future explicit mock mode is added.

## Local visual checks

Use local runs for non-authenticated layout checks or future mock-mode tests only:

```sh
npm run visual
```

Do not commit credentials, `node_modules/`, `test-results/`, or `playwright-report/`.
