# Reviewed checkpoint reconciliation and demo server import

This bounded milestone follows the independently reviewed `f05d338c` checkpoint.
It is source qualification only. Discord/reminder paths remain default-off; no
provider, credential, deployment, PIN, production database or permission changes
are made. No new application endpoint exports the recovery executor.

## Reconcile a proven completed auth operation

The auth gate now records a uniquely identified local outcome receipt after a
verified SDK sign-in/sign-out succeeds, before settling the shared IndexedDB
checkpoint. If the final checkpoint write fails, the successful auth result
remains truthful and further mutations remain blocked. The receipt permits a
specific recovery case: the SDK finished, its receipt was durably stored, and
only final checkpoint settlement was interrupted.

A host may inject a trusted `verifyCurrentAuth` verifier and expose
`prepareCheckpointRecovery()` followed by
`confirmCheckpointRecovery(ticket, {accepted: true})`. Preparation reads the
pending checkpoint and completed receipt under the same Web Lock, waits for
Firebase initialization, matches operation ID, revision, kind, previous UID and
result UID, and requires fresh verification of the actual current user. It
returns a review ticket showing the operation and UID without changing auth or
storage. Confirmation repeats those checks under the lock, requires the exact
in-memory ticket/evidence and explicit acceptance, then settles the checkpoint.
The host clears its warning only after successful settlement. Its configured
canary UID remains mandatory. Reload requires a new review; two competing reviews
cannot both succeed. There is no expiration, reset button or arbitrary UID override.

The production application does not supply that verifier or a recovery UI, so
this flow remains unavailable there. A future host must use trusted server ID-token
verification (including revocation/disabled-user checks), never trust a supplied
UID or file checksum. The pinned Firebase SDK emulator test exercises actual
custom-token sign-in, a failed settlement write, a recreated gate, fresh admin
ID-token verification and explicit recovery. Browser tests independently cover
real IndexedDB persistence/reload and Web Lock arbitration in two tabs.

A crash before the completed receipt, a missing receipt, an interrupted preserve
operation (link/unlink/password change), a mismatched user, failed verification,
or changed checkpoint stays blocked. Local receipts do not prove backend provider
linkage or confer identity/permissions. Recovery of these unknown outcomes and
production UI/server-verifier binding remain unimplemented; no automatic repair
is claimed. The existing all-host/cooperative-tab rollout requirement still applies.

## Server-authorized additive import, emulator only

`functions/src/prototype/recoveryImportEmulator.js` is disabled by default and
requires the exact `demo-pogo-discord` project plus loopback Auth and Firestore
emulators. It writes only `recoveryImportSandboxes`, `recoveryImportReviews` and
`recoveryImportReceipts`, not canonical production collections. The tests use the
actual access-authority verifier, Auth tokens, reciprocal account/handle records,
Firestore transactions and existing domain validation/merge models.

Preparation verifies current account authority and the source UID, reads the
server target, computes a fresh dry run and stores a bounded five-minute review.
Confirmation requires its exact digest and explicit acceptance, verifies current
authority again, transactionally checks the account foundation and unchanged
target, revalidates the plan, checks Favorite target foundations, and atomically
writes additive content plus a durable receipt. Only own canonical generation-1
trade entries, Favorites and tags can be added. Existing entities, tombstones and
conflicting lifecycle content require separate review. Duplicate/concurrent
confirmation or process restart reuses the receipt. It never reapplies content
removed after the original commit. A verified readback is distinct from a
committed receipt: unavailable readback returns `committed-readback-unavailable`;
changed content returns `committed-content-changed`. Neither reports a rollback.

Sandbox limits are 128 KiB per reviewed record/bundle and 50 additions. Bundles
with no supported additions are refused without rewriting the target. This is a
bounded qualification executor, not a production import service. Cross-UID
recovery is refused even when the file checksum is valid.

Unsupported import sections are all noncanonical data: legacy-only lists,
profile, local ordering, journal/history, preferences, groups/memberships,
permissions/admin status, shared URL/ownership references and related evidence.
They are inventoried in the dry run and left untouched. Export collectors for
enabled provider-only, share-visibility and synced-preference features still fail
closed until their dedicated adapters exist. This milestone does not claim full
recovery fidelity or preservation of old shared URLs across a new account.

## Qualification and remaining approval boundary

Regression coverage includes rejected confirmation, unknown auth outcomes,
wrong UID, changed review, failed verification/storage, reload, competing tabs,
actual pinned SDK authentication, revoked/disabled import authority, stale target,
concurrent/restarted import, permission preservation, readback outage and later
content removal. CI also runs Google, account-sync, release, performance and
function contract suites.

The staging approval package remains in `DISCORD-BACKEND-DECISION.md`: owner/team
and dedicated canary selection are unresolved. No existing admin-config 403 was
retried or bypassed. Discord application/callback, identify-only grant, managed
secrets, narrow runtime permissions, TTL and reviewed staging deployment each
remain pending explicit action-time approval. Production writer activation,
unknown-outcome reconciliation, cross-UID ownership recovery, remaining collectors
and visible recovery UX need further implementation/review; they are not made
safe merely by supplying provider credentials.
