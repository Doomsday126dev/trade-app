# Trade app basic traffic integration — verified collector and approved release candidate

This local patch is based on deployed `.130`, exact runtime `27c4bdc3b5266c653b7a0f88df65b90bba0bf2a8`. The parent verified the signed-in Trade dashboard, private dashboard access and Sessions enabled, and supplied explicit user approval to merge/deploy this integration. Reliability application/controller/journal/runtime code is unchanged. Do not deploy the integration/main branch or sweep in unrelated main UI/sprite changes.

Shared contract: https://github.com/Doomsday126dev/raid-iv-odds/blob/1074d20/docs/TRAFFIC-INTEGRATION.md . The HundoCheck endpoint must not be reused; each site needs its own verified collector. This implementation explicitly rejects that shared code.

## Prepared behavior

- Remove the legacy Cloudflare script, rather than retaining two analytics systems.
- Set one early `no-referrer` HTML policy before any subresources.
- Load a first-party sender independent of Firebase/account state. The configured collector is https://doomsday126dev-trade.goatcounter.com/count.
- Count at most once per visible top-level document. The only production routes are HTTPS `doomsday126dev.github.io/trade-app/` and `/trade-app/index.html`.
- A `view` query selects static `/trade-share`; every other allowed document, including signed-in/private/account/privacy views, selects static `/trade`. Raw paths, query values and fragments never enter the payload.
- Browser-direct GET to the site's exact `/count` endpoint. Only `p`, fixed `t=PoGo Trades`, and empty `r` are sent. Fetch uses no-cors, omitted credentials, no-store, no-referrer and keepalive. No external tracker JS, cookies, persistent ID, storage, screen dimensions, history/input/edit/tab hooks, retries or offline queue.
- Hidden/prerendered documents wait for visibility. Skip automation, frames, offline, local/preview hosts, DNT and GPC. Failures are silent and do not interrupt the app.
- Require an exact collector origin in a connect-src CSP meta before attempting a send. Broad wildcard/scheme collector permissions are rejected. Scoped Firebase HTTPS/WebSocket shard wildcards are infrastructure permissions and cannot authorize GoatCounter. Configuring only an endpoint is insufficient.

## Deliberate activation gates

The Trade collector and dashboard ownership are verified by the parent. The enabled candidate uses release `.131` and an early connect-src CSP. Analytics has exactly one collector origin; existing Firebase RTDB assigned shard hosts retain scoped HTTPS/WebSocket permissions. Auth, token refresh, Installations, App Check/reCAPTCHA Enterprise, callable Functions, SDK imports and event JSON have explicit service origins. No general network wildcard, GoatCounter wildcard, script permission or backend/rules/billing change is introduced.

Before publishing, pass the privacy/browser/release checks and reviewed immutable Pages control registration for the extra first-party asset and exact runtime SHA. Deploy only this isolated runtime based on `.130`, never unrelated main payload. After deployment, provide the time and generic `/trade` path of one controlled visit for the parent's private dashboard observation. A fetch/GIF response alone is not dashboard collection proof; do not claim collection until the parent verifies it. Do not test production analytics with private/share links.

## Tests

`node --test tests/traffic.test.cjs` checks payload allowlists, private sentinel values, strict endpoint/CSP validation, once-per-document behavior, visibility/prerender deferral, all eligibility exclusions and rejection without retry.

`node --test tests/traffic-browser.test.cjs` runs Chromium and Safari WebKit against intercepted requests only. Seven scenarios per engine cover synthetic private share/account/privacy URLs, blank endpoint, GPC, automation and preview host. Tests verify outgoing collector query AND headers, seeded collector-cookie omission, subresource/navigation referrer omission, no edit/history inflation, and absence of private sentinels. No live GoatCounter, production app or Firebase request is made.

`npm run check:pages-release` covers the updated exact asset inventory, service-worker cache/install behavior and current release gates. Inventory assertions increase by precisely one first-party script; exclusion/ordering checks remain intact.
