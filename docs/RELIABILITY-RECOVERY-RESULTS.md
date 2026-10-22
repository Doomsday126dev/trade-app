# Reliability recovery implementation — October 22, 2026

## Current outcome

All four initially confirmed findings now have local fixes on
`fix/reliability-review`, based on deployed runtime
`9d7fd6c2a93dacfa04f2eba5db5123c4741a9718` (`2026-10-20.128`). The branch remains
uncommitted, unpushed and undeployed. No production rows, rules, billing,
credentials or security configuration changed. No approval request is pending.

[Invariants and failure cases](RELIABILITY-RECOVERY-INVARIANTS.md) were recorded
before the second implementation phase. The [initial report](RELIABILITY-REVIEW-2026-10-22.md)
retains the original reproductions and first two fixes.

## Changes

### Bounded session detachment and retained intent

`runtime.stop()` still invalidates projection/session authority synchronously.
It waits up to 250ms for cleanup. If transport remains unresolved, it returns
`{ok:true,status:'detached',settled:<cleanup promise>}` so the application can
start a replacement runtime. It closes the retired journal only after controller,
startup, provider-profile and provider-publication work actually settles. The
default fast path still returns `closed`. The 250ms bound is a timer target,
subject to browser scheduling; it is not cancellation or a Saved claim.

The independent reviewer found that a journal mutation already awaiting local
storage could resume after replacement acknowledgement. Runtime shutdown now
synchronously retires that connection's writers before detaching the controller.
Every readwrite transaction uses one guarded factory; retirement aborts active
transactions and prevents new writes after awaited reads/database opens. Readonly
cleanup remains available, and the replacement has its own journal connection.
An aborted enqueue returns persistence failure, never a successful durable save.
Late journal errors from transport and malformed-response failure paths are
handled without unhandled promise rejections.

A retired controller's generic late failure cannot mark a current journal
operation failed. Existing listener/lifecycle checks reject late acknowledgement,
conflict reconciliation and further publication. Retired migration notifications
are suppressed. Same-owner replacements retain and retry the original operation
ID; different owners neither inherit nor drain those records.

Testing the replacement exposed an additional startup race: migration could
read an empty server account before pending replay committed, then accept that
old read after the listener had accepted the commit, producing a false
`remote-entity-missing`. Startup now awaits the initial retained-operation drain
before taking migration/profile reads. It does not acknowledge uncertain writes
or bypass conflict/recovery checks.

Files: `js/data/accountSyncRuntime.js`, `js/data/accountSyncController.js`,
`js/data/accountSyncJournal.js`, plus the memory harness and real IndexedDB tests.

### Cross-device public repair

The controller compares a stable key of accepted trade projections after
validated remote acceptance. A change after initial hydration creates the
existing durable publication-pending marker. The existing one-second coalescing
timer, online/listener authority, projection gate and exponential retry perform
repair using current accepted rows. A change during an in-flight publication
requests a latest-state pass. Initial startup publication remains responsible
for initial hydration.

Identical echoes and Favorite/tag-only changes do not trigger publication.
Optimistic pending rows are never included. The application still runs the
existing public product allowlist; tests independently confirm that preserved
inert legacy FT rows, Favorites, tags and recovery evidence stay out. No consent
or visibility policy, public field or backend path is added.

Files: `js/data/accountSyncController.js`, new
`tests/account-sync-public-repair.test.cjs` (included in `test:account-sync`).

### Actual late SDK publication completion

Bounded detachment creates another ordering case: an already issued old public
write may complete after the replacement published newer rows. An application
timeout also does not cancel the raw Firebase promise. Observing only retired
runtime cleanup would miss an SDK write that outlives that timeout.

Both legacy and provider public adapters now observe the raw write promise.
After successful late completion, only a current, ready same-owner/name runtime
can request canonical reconciliation. Rejected writes do not trigger this path;
normal acknowledged writes do not add a publication. The observer handles a
deadline/completion microtask race and coalesces duplicate requests. The old
runtime does not acquire authority or publish more rows itself.

The independent reviewer also reproduced a sustained slow-ACK loop: each write
that landed just after its deadline triggered another full write, leaving status
pending indefinitely. Recovery now captures the exact issued payload only after
an actual successful raw ACK. A cloned, one-use proof is bound to the current
runtime/UID/name and expires after 30 seconds. A publisher can skip rewriting
only when both this proof and public readback match its current allowlisted
snapshot, ignoring only the generated outer `updatedAt`. Readback alone cannot
mistake an offline SDK cache for proof of a newer unacknowledged write. Differing
current content still gets written. Provider transactions with `committed:false`
cannot introduce stale data and do not request late-write repair.

Files: `js/app/application.js`, `tests/normal-sync-product.spec.js`.

The pre-existing constrained-public-path test was updated to require the same
exact path, raw write, 8-second deadline, readback and uncertainty observer. Its
old assertion required the raw write to be syntactically nested directly inside
`withTimeout`, which would prevent observing the uncancelled promise. No runtime
contract was removed; behavior is also covered by the browser cases.

## Qualification and evidence

All evidence logs are in the parent task directory.

| Check | Final result | Log |
| --- | --- | --- |
| Expanded account-sync suite | 321 pass, 1 existing skip | `reliability-reviewed-account.log` |
| Desktop/mobile full product suite with isolated RTDB emulator | 34 pass | `reliability-reviewed-product-emulator.log` |
| Real Firebase SDK + publication recovery with emulator | 8 pass | `reliability-reviewed-sdk.log` |
| Real WebKit IndexedDB recovery/owner isolation | 11 pass | `reliability-reviewed-webkit.log` |
| My List/public/session/listener boundaries | 79 pass | `reliability-reviewed-boundaries.log` |
| Pages release validator/static contracts | pass, 111 tests pass | `reliability-reviewed-pages.log` |
| Broader provider-public suite | 85 pass, 2 unchanged baseline failures | `reliability-reviewed-provider.log` |
| New regressions against unchanged .128 | 2 expected failures | `reliability-phase2-baseline-proof.log` |
| Repaired observer diagnostic | public row recovered without another edit | `reliability-phase2-observer-repaired.log` |

The baseline proof uses an isolated clone of unchanged .128 with the new tests:
stop exceeds the 1500ms test limit; the observer has no publication-pending
evidence after the remote commit. The original diagnostic separately proved
that its public copy stays empty. Fixed tests exercise actual recovery, not
only status changes.

Seven runtime cases cover late commit/error/malformed response, same-owner and
different-owner replacement, stuck startup/publication and provider-profile
work. A held private operation is retried by its replacement, followed by a
newer user edit; releasing the old operation preserves that edit and one server
entity. Browser cases use real IndexedDB, the repository and application startup
flow, not only the memory harness.

Ten controller repair cases cover add/edit/delete, burst coalescing, repeated
echoes/private Favorite changes, slow concurrent publication, durable permission
failure, automatic retry, offline/reconnect and projection/session/invalid-data
fences. An observer with an unaccepted optimistic row and failing private writes
still publishes only the other device's accepted row.

Three additional browser scenarios cover raw public completion after runtime
replacement, after a simulated deadline, and a settled-deadline microtask race
with another-owner refusal. They deliberately allow the stale public write to
land, then verify actual latest public content and clear error after repair.
The sustained-slow test additionally keeps every public write slower than its
deadline: one write/one ACK converges to Saved, and a later explicit publication
still performs another write because the proof was consumed. Real Chromium and
WebKit tests hold five journal mutation reads across retirement/replacement,
abort an active enqueue and fence a delayed database open. All retain current
acknowledgements, owner isolation and pending publication evidence.

## Review and remaining limits

A fresh independent reviewer examined the full patch and reproduced the retired
journal and slow-ACK blockers. Both were corrected and independently retested,
including the malformed-response rejection branch. The report is saved in the
task directory as `reliability-independent-review.md`. The recommendation is a
staged release: small queue/provider retry fixes first, broader bounded-stop and
remote repair separately after integration gates and a Safari/PWA smoke test.

The two broader baseline failures were rerun unchanged with identical locked
dependencies. They concern an old Favorite resolver source-call signature and a
hardcoded `2026-08-31.86` asset/release expectation. Both are present on the exact
live baseline. They were not weakened or edited. The first now encounters the
explicit migration option `allowIncidentResolver:false`; that option is a
deliberate identity-resolution boundary, not evidence of a save failure. The
obsolete release check is covered by current Pages asset/version gates.

Remaining practical limits:

- An unresolved retired request may retain an old journal connection and promise
  until acknowledgement or page exit. UI/session startup no longer waits on it;
  this is intentionally not unsafe cancellation. A stalled browser/disk can also
  delay timer execution beyond 250ms.
- New replacement startup can still wait for its own canonical listener or
  retained transport while genuinely offline. This patch removes waiting on an
  unrelated retired promise; it does not promise online saving during an outage.
- Multiple healthy devices can each repair a remote change. Identical snapshots
  do not loop, and per-device bursts coalesce, but there is no cross-client
  publication lock. This adds bounded publication/readback work per open device.
  Amplification is linear in open sessions for the same owner, not in directory
  population. Unchanged echoes do not republish. A sustained real outage retains
  the existing per-active-observer retry cadence, eventually every 30 seconds.
- Public writes remain eventually reconciled, not a globally ordered distributed
  transaction. A departed device whose raw SDK acknowledgement never reaches its
  process cannot run its late-write observer. Returning/startup, another accepted
  trade update or an active current process can repair; a server-enforced
  freshness watermark requires a separate backend/rules design and authorization.
- No physical iPhone background-kill test, real production network-loss experiment,
  production write, load test or new deployment was performed. Emulator server
  reads prove synthetic persistence and rules behavior, not all production saves.

## Ordered next steps

1. Independently review the packaged diff, especially background journal lifetime,
   current-owner late-completion fences and cross-device publication traffic;
   the fresh review is now complete and its findings are addressed locally.
2. Integrate onto current main in an isolated branch; resolve baseline test
   maintenance separately, rerun all focused/release gates and allocate the next
   release version only through the approved process.
3. Obtain approval before merge/deploy. Then verify Safari/PWA replacement,
   offline/reconnect and private/public correspondence with a safe account.
4. Consider a server-side publication watermark if strict ordering after abrupt
   process death is required; measure the extra per-open-device repair traffic
   before introducing periodic reconciliation or backend coordination.
