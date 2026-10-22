# Queue/retry release boundary and broader browser qualification

## Minimal candidate — approval pending

Separate checkout: `../queue-retry-work`.

- Release branch: `fix/public-queue-retry`.
- Local commit: `645d8f7787493d7c52a5e79e64eb1db0d1be851c`.
- Exact parent: deployed `.128` runtime
  `9d7fd6c2a93dacfa04f2eba5db5123c4741a9718`.
- Clean working tree; exactly four files, 70 additions and 6 deletions.
- Includes only canonical routing of legacy public queue replay, provider retry
  rebuilding current accepted rows/status, and their regression tests.
- Excludes bounded shutdown, journal retirement, remote observer publication,
  late-ACK proof/recovery, PWA harness changes and unrelated main changes.

Minimal diff: `../queue-retry-minimal.patch`.
SHA-256: `0ae9adf51881797082d41d2b490d0765aaf100b667f95b640c6b1bdf4c9aebd9`.
Machine-readable evidence: `../queue-retry-release-evidence.json`.

The parent is awaiting deployment approval. No push/deployment was attempted.
Release markers are deliberately still `.128`; allocating the next release ID
and applying release-control/version changes are separate pre-deployment steps.
No production data, billing, credentials, rules or security changes are included.

## Do not confuse the integration branch with the minimal deployment source

Read-only fetch confirmed current main is
`a5c8f576ab77f2219421a6673f413a9ad8f5f037`. It contains unrelated pre-existing
changes absent from the actual deployed runtime. A separate local branch,
`fix/public-queue-retry-integration`, commit
`d1da1596ba8783e5d2b093c3db6e53ce8917ed52`, applies the same small diff to main.
That branch is for integration review, not the scope-limited release candidate.
Deploying it would also include those unrelated main changes.

## Minimal qualification

| Check | Result | Task-root evidence |
| --- | --- | --- |
| Account-sync suite | 301 pass, 1 existing skip | `queue-retry-account.log` |
| Desktop/mobile product and local rules/server readback | 22 pass | `queue-retry-product-emulator.log` |
| Release gates | validator/static checks + 111 tests pass | `queue-retry-pages.log` |

A fresh independent reviewer confirmed the clean four-file boundary and absence
of broader recovery code. Prior independent provider baseline comparison still
has the same two source-assertion failures; no tests were hidden to prepare this
branch. The optional plain browser run also passed 18 cases with four emulator
cases skipped; the subsequent emulator run passed all 22.

## Broader recovery remains separate

The complete corrected recovery implementation stays uncommitted in
`reliability-work`, branch `fix/reliability-review`. Its prior independent review
and results are in `RELIABILITY-RECOVERY-RESULTS.md` and the task-root
`reliability-independent-review.md`. Nothing from that checkout is part of the
minimal commit above.

`playwright.reliability.config.cjs` runs Chromium, desktop Safari WebKit and
iPhone WebKit simulations. `tests/reliability-pwa-shell.spec.js` uses the real
service worker/cache and real IndexedDB in a fresh browser context. It caches
the app shell, persists synthetic pending intent, refuses local HTTP sockets,
reloads from cache, reopens the same owner-bound journal and verifies the same
operation ID/input hash, checks another owner sees no pending record, then
restores transport. Firebase endpoints are not cached; no production list write
is performed.

The first WebKit run using `context.setOffline(true)` failed navigation with
`WebKit encountered an internal error`. A minimal independent service-worker
control reproduces that error, while the same WebKit control succeeds under
actual local socket failure. Chromium succeeds under both. This is recorded as
a browser automation limitation, not waived as an app pass. The final outage
smoke uses local socket failure consistently in all engines and passes all three.
Evidence: `reliability-offline-control.log`, `reliability-pwa-socket-smoke.log`.

Full corrected browser qualification passed **54 cases**: 17 product cases plus
one PWA case in each of Chromium, desktop Safari WebKit and iPhone WebKit.
Evidence: `reliability-safari-pwa-isolated-final.log`. The first full run had two
WebKit anonymous-viewer fixture failures: an inherited controlling service worker
bypassed page-level SDK stubs and reached real App Check/reCAPTCHA. A fresh
anonymous context with service workers blocked corrected the fixture; unchanged
anonymous emulator reads and reload assertions pass. The preserved trace and
independent review establish a harness issue, not a production App Check fix.

Earlier fixture boot did make incidental real attestation requests; no production
list mutation occurred, but those runs must not be described as entirely free
of production service traffic. Subsequent qualification hardens tests only:
normal product cases block service workers and install context-wide production
backend/attestation/Auth/analytics abort routes before navigation. The dedicated
real-worker PWA fixture retains workers and adds a same-origin CSP on its local
test server, preventing external SDK/attestation startup even if a worker bypasses
page routes. Production CSP, App Check and rules are untouched. Final PWA checks
also require an actual refused request and a new document after reload, with HTTP
cache disabled so cache fallback cannot be confused with a stale page.
Evidence: `reliability-pwa-csp-final.log` and
`queue-retry-and-safari-independent-review.md` in the task directory.

This PWA test qualifies cached shell/journal persistence under transport failure.
It does not establish authenticated offline save replay, installed iOS standalone
behavior, physical-device background termination or production persistence. The
separate product/emulator tests cover save/replay/public correspondence with
synthetic identities. A real safe-account Safari/PWA smoke remains appropriate
before releasing the broader recovery change.

## Approved staged releases, October 22

Both stages were explicitly approved. Focused runtime c13d6728 is release .129; the separate .130 candidate is based on that exact runtime and adds only the reviewed recovery implementation, regression fixtures and exact read-contract metadata. Unrelated main changes remain excluded. Release evidence is recorded separately; approval does not imply deployment completion.
