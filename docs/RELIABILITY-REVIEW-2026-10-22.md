# Reliability review — October 22, 2026

This records the initial review. The follow-up implementation and current
qualification are in [RELIABILITY-RECOVERY-RESULTS.md](RELIABILITY-RECOVERY-RESULTS.md).
The shutdown and observer risks below now have local fixes; neither has shipped.

## Scope and baseline

Isolated branch `fix/reliability-review`, based on deployed runtime commit
`9d7fd6c2a93dacfa04f2eba5db5123c4741a9718` (`2026-10-20.128`). The read-only
live deployment manifest still identified that release. No production list
entries, billing, credentials, security settings or rules were changed. These
changes are local, uncommitted and undeployed; release markers remain unchanged.

Review covered durable saves, canonical/public separation, stale offline queues,
publication recovery, session authority, cross-device updates, IndexedDB recovery,
SDK validation and deployed-rule behavior using isolated fixtures/emulators.
Passing mocks alone do not establish production persistence. Browser emulation
is not a physical iPhone/PWA test.

## Findings and changes

### P1: delayed legacy queue can replace a newer public list — fixed locally

`flushSyncQueue()` previously wrote the cached `publicShares/{username}` payload
directly, outside the canonical publisher's serialization. Hold this legacy
write, accept and publish a new canonical declaration, then release the old
write: the public list goes from two declarations back to one while private
sync still reports Saved. This is public data regression, not demonstrated
private canonical data loss.

The queue now asks the current owner-bound canonical runtime to publish its
current accepted projection. It removes the queued item only after an explicit
published result and rechecks runtime/session identity. Failure/defer retains
the queued evidence and canonical publication status reports the pending work.
Both desktop/mobile browser regressions pass. The stale-row test failed before
the change (one public declaration instead of two).

Files: `js/app/application.js`, `tests/normal-sync-product.spec.js`.

### P2: provider retry replays stale rows and leaves a stale error — fixed locally

After a failed provider publication, another device changes an accepted row
from priority L to H. Manual retry previously sent the stored L snapshot and
left `lastProjectionError` set even after a successful write. The regression
observed `[L, provider-public/write-timeout]` instead of `[H, ""]`.

Retry now validates durable pending evidence, then uses the controller's
canonical publisher to rebuild current accepted rows and perform normal success
and error bookkeeping. It does not chain that publication into its own provider
writer promise (which would deadlock). Existing invalid-evidence/session tests
remain passing. Provider-only public capabilities are disabled in the deployed
configuration, so this is a latent feature defect, not the established cause of
the current legacy-user complaints.

Files: `js/data/accountSyncRuntime.js`, `tests/account-sync-runtime.test.cjs`.

### P1: unresolved transport can block replacement runtime — needs design work

`accountSyncController.deactivate()` awaits every in-flight repository/publication
promise without a bound. `runtime.stop()` awaits deactivate, and
`ensureAccountSyncRuntime()` waits for the global stopping promise. A private
RTDB transaction has no application deadline. An offline queued request can
therefore detach the old listener yet prevent a replacement runtime from
starting until that request settles.

Repro: `node scripts/reliability/repro-session-shutdown.cjs`. With transport held,
the session is detached, pending count is one, and shutdown remains unresolved
after 250ms. Source inspection establishes there is no timeout; 250ms itself is
not the defect. Releasing transport allows shutdown; reopening the same journal
recovers to Saved with exactly one server entity, demonstrating existing
idempotency rather than proving data loss.

Do not fix this by marking a timed-out request saved or deleting its journal
entry: an already issued transaction may still commit. Recommended next design:
detach UI/session promptly, preserve uncertain operations durably, fence late
callbacks, and manage journal lifetime independently of replacement runtime
startup. Qualify old-to-new account and same-account reconnect separately.

### P2: a healthy observer does not repair a departed writer's public failure

Controller fixture: observer publishes empty state, writer commits a private
entry but publication fails, then writer stops. Observer receives the private
entry and reports Saved with no publication error; it does not republish. The
public copy remains empty. Publication markers are local to the writer's journal;
ordinary remote listener acceptance only schedules publication when that
controller already has pending publication work.

Repro: `node scripts/reliability/repro-observer-publication.cjs`. This is an
actual controller-level result, not a live browser or Firebase disconnect repro.
Runtime startup publication or the writer returning can repair it; the repro
specifically leaves an already-open observer running. A coordinated remote
publication watermark or carefully debounced publication on accepted remote
trade changes needs review for duplicate traffic, monotonic versions and
private-acknowledgement authority. No architecture change is included here.

## Verification

Logs are in the task directory immediately above this checkout.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run test:account-sync` | 301 pass, 1 skip | `reliability-account-suite.log` |
| Product browser suite, desktop + mobile, local RTDB emulator | 22 pass | `reliability-product-emulator.log` |
| Publication recovery + real Firebase SDK, local RTDB emulator | 8 pass | `reliability-publication-emulator.log` |
| Real WebKit IndexedDB reload/owner isolation/retry | 10 pass | `reliability-indexeddb-webkit.log` |
| My List safety/public share/session cache/listener/publication checks | 79 pass | `reliability-boundaries.log` |
| `npm run check:pages-release` | validator, 111 tests and static contracts pass | `reliability-pages.log` |
| Broader provider-public suite | 85 pass, 2 baseline failures | `reliability-provider-public-fixed.log` |
| Same provider suite on unchanged live runtime, same dependencies | identical 85 pass, 2 failures | `reliability-provider-public-baseline-with-deps.log` |

The two pre-existing provider suite failures are stale source-shape assertions:
one expects the old Favorite resolver call signature, one hardcodes release
`2026-08-31.86`. They were not weakened or changed. The initial broad run also
lacked `firebase-admin/app`; installing the locked Functions dependencies removed
those two setup failures. No claim that every repository test passes.

The product emulator case independently reads saved private/public data from
the local server and reopens IndexedDB, rather than inferring saving from UI
state. Other cases exercise failure/retry before reload, session switch during
activity write, analytics failure independence, stale profile replay and current
activity preservation. Publication cases cover normal, transient failure,
offline pause/reconnect, durable restart, slow concurrent requests and sustained
permission failure. The real SDK case also reproduces the old null-prototype
validation error and verifies the corrected ordinary object payload under
captured rules. All accounts and rows in these tests are synthetic.

## Limits and ordered next steps

1. Review this small local patch and integrate it onto current main; allocate a
   new release ID through the established release process only if approved.
2. Before release, rerun focused and release gates on that integration head;
   address the two stale provider assertions separately without weakening runtime
   contracts. Nothing in this review authorizes merge or deployment.
3. Implement bounded session detachment with durable uncertain-operation recovery,
   including delayed commit after account switch, lost acknowledgement and reload.
4. Design cross-device public freshness/reconciliation so an absent writer does
   not strand an old share. Measure duplicate publication/download effects.
5. On an approved release, verify real Safari/PWA offline/reconnect and private to
   public correspondence without editing other members' production lists.

Not verified here: current production quota/auth incidents, real network-loss
latency distribution, physical device background termination, all historical
legacy users, or a production end-to-end save using new entries. No production
load was generated. Slow public transport also shares the repository mutation
serialization with private writes; separating it warrants a dedicated authority
and ordering review rather than a speculative change in this patch.
