# Independent Provider Identity Launch Audit

## A. Verdict

ASTRA AUDIT COMPLETE - PR #63 CORRECTED BUT NOT MERGED

This is not launch approval. Production execution is explicitly disabled in the
supported live CLI, before approval-file consumption, credential lookup, or a
production request. The injected-adapter entry point remains usable for tests.
There is no command-line bypass. Removing that containment is not sufficient to
qualify execution: the open findings below require implementation and proof.

## B. Scope

Reviewed the PR #63 live CLI, REST adapter, preparation reader, classifier,
manifest/write-set validator, progress ledger, completion and certification,
private-file writers, two-store freeze helpers, inactive deployment plan,
historical deployment source pins, authority namespace admission and transaction
checks, provider compatibility floor, and rollback contracts. Reviewed candidate
Rules generation and exercised its focused emulator suite.

Excluded My List, Events, boards, sprites, localization, unrelated sync, Group E
behavior, Discord implementation, and general performance. No application or
provider-runtime source was modified. This audit does not claim a completed
end-to-end secret/deploy/freeze/closeout simulation.

## C. Findings

| ID | Severity | Reachable cause and impact | Disposition |
| --- | --- | --- | --- |
| F1 | P1 | `apply-manifest` checked freeze only after identity commits; the original full CLI writes four synthetic identity documents before reporting absent freeze. | Fixed: verify both stores before inventory/write work and before each create commit. Missing/colliding output paths rejected before writes. |
| F2 | P1 | Firestore create/update/delete request bodies used HTTPS URLs as document resource names, causing the production API to reject freeze/backfill/restoration. | Fixed resource names; independent fake HTTP transport asserts create preconditions and update/delete resource names. |
| F3 | P1 | `invalidate-certification` read any existing certification and used that same value as deletion authority, including a foreign freeze. | Fixed exact locally persisted certification intent and comparison. Foreign certificates stop. Release requires certification absence. Full run binding remains R1. |
| F4 | P1 | A create committed but response-body read failed outside the ambiguous-transport catch; exact create retries sent another create even when already present. | Fixed body-read ambiguity handling, bounded requests, read-before-create exact reconciliation. |
| F5 | P1 | Namespace drift ignored migration/request records under every UID not present in the migration list. | Fixed full captured metadata baselines and complete inventory comparison. Old manifests without this baseline cannot apply. |
| F6 | P1 | Hash validation alone accepted changed classifications, write paths, and self-consistent substituted ownership mappings. | Fixed schema/count/path/document validation plus reconstruction from the bound snapshot before apply/certify. Duplicate UID references and divergent legacy auth versions block classification. |
| F7 | P2 | `undefined` Auth fields were included in the in-memory digest but omitted by JSON serialization. The saved snapshot cannot reproduce the old manifest's Auth digest. | Fixed canonical hashing to match JSON persistence. Reproduced the exact old digest by restoring omitted undefined fields. Old artifacts retained as historical only. |
| F8 | P1 | A crash after activating only one store could not use release, because release rejected an absent peer. | Fixed release of the exact existing active side without fabricating a missing record. Partial release reconciles; conflicting IDs/times and malformed states stop. |
| F9 | P2 | Completion accepted noninteger/null timestamp comparisons; certification could be regenerated at a new timestamp on restart and collide with its prior create. | Fixed timestamp validation, certification expiry checks, and fsynced exact intent before create. |
| F10 | P2 | Paths resolved through symlinked parents; output aliases could replace inputs; writers chmodded caller-supplied directories and immutable writes lacked fsync. | Fixed canonical absolute paths, symlink/hardlink rejection, permissions checks, distinct artifact paths, file and directory fsync. Assumes no concurrent hostile OS account replacing ancestor directories. |
| R1 | P1 OPEN | A 0600 phrase file still has no window ID, manifest/runtime/operator binding, action capability, issue/expiry enforcement, or sealed closeout/replay prevention. Its legacy parser accepts another manifest/date. Certification intent binds manifest/completion but not an independent run or operator authority. | Production CLI blocked. Needs ONE window-bound capability, separately valid restoration authority, and reviewed-code provenance. Do not reuse the old phrase file. |
| R2 | P1 OPEN | There is no full window orchestrator or durable monotonic 25-minute execution/10-minute reserve model. An apply error or killed process may leave active freeze until a separate manual release; corrupt progress is not an automatic emergency closeout. | Production CLI blocked. Partial-store helpers are corrected, but no safe-terminal-state guarantee is claimed. |
| R3 | P1 OPEN | New plan names current runtime and six gateways, but the invoked deploy helpers use old immutable pins: authority `ad2edab...`, gateway `129b7ad...` and TWO exports. The new plan is not consumed by those executors. | Plan now explicitly `executionReady: false`. Needs provider-specific source-pinned deployment/verification and exact inactive six-function rollback parity. Historical Group E/deployment pins were not silently repurposed. |
| R4 | P2 OPEN | Secret/API/IAM work is described in prose/metadata, not a qualified executable sequence with nonlogging key input, exact version 1 binding, privilege cleanup evidence and failure recovery. The window plan also assumes pre-first-provider state. | No secret/IAM work executed. Needs persistent fake-command rehearsal plus live read-only pre-first-account and rollback evidence binding. |

The three starting-commit reproduction tests explicitly load the original
operator at `cb816de...` and use synthetic adapters. Passing those tests means
the original defects were reproduced, not that the original operator is safe.

## D. Approval Authority

Not qualified. No actual approval was consumed. The supported CLI refuses live
execution before reading an approval file. The current phrase parser is retained
only behind containment for existing synthetic tests, not represented as a
secure capability. Normal execution expiry, emergency restoration after expiry,
copied/stale artifact rejection, and permanent closeout sealing remain R1/R2.

## E. Provenance

Starting main: `794f8dbe08ee30a7de29ca73013b5ad77070ad44`.
Main tree: `a6e14dcc7a2a8c7d0a74c2c2ec033248cbc09ea2`.
Starting PR head: `cb816de8a12b1ccbc3ed51fee50686a262d241b4`.
PR head tree: `c03bd5a2f7f52ac6df824f003671c09584309599`.

Independently reconstructed fingerprints:

| Artifact | SHA-256 |
| --- | --- |
| Current-main authority source | `a2f5fec2746ab7f324707a519103c4a9ef3a6a577ee2c7b9118817bb943f8c32` |
| Current-main gateway source | `9f9fd9e5b1fc79151f7aa2d28107d8a723ae17eaf5327795fba017cd21cce411` |
| Candidate combined Rules bytes | `9fdc2d9ab4add1df6bf3dd1d58dc4f524946e7d7ad8c8bf25ca649b973c4cbbf` |
| Rollback Rules bytes | `89aac0a7716a9cde5176ef11064abbe55eee61b1d9b56cc4d14ae4ceb0d3090e` |
| Provisioning contract bytes | `7f50fa469acc053f383dcbf08201c82b68f9ce49c9d040be130b489f4fd248e6` |
| Provisioning policy's embedded digest | `20c440c56a2fa3f723f3f6f2ad1bf30a9307e7f098c92a65b86f08ae6bcac59b` |
| Normalization source | `dfefa21345c09b7277e0e4d6bc85488b10dc2a0b2e09bfe356819da2e1e404d9` |
| Historical manifest | `0be4b4fdbbe5ac5e3258081d21eaa4cb8d7e50d499848f491040caeb2983ce64` |

Runtime source, operator source, and top-level main are distinct provenance
domains. Runtime files and Rules were not changed. Operator bytes changed and
are not adequately bound by the historical manifest. A NEW read-only
snapshot/manifest is required after an eventual qualified merge. None was
created for a merged operator in this task, because this PR is not merged.

The 35 historical private files and all directories INSIDE the specified run
have 0600/0700 modes and no symlinks. Their containing parent is 0755; it was not
silently chmodded. Content/mode inventory is kept privately and checked for
unchanged files. New audit evidence resides in a separate 0700 directory.

The old `authIndex` digest is `cd1825a...`; saved JSON and the fresh read-only
production projection both reproduce `4baea4a...`. Omitted undefined properties
explain the difference exactly. The other four snapshot root digests match.

## F. Manifest and Writes

Independent historical reconstruction: 38 Auth index entries; 58 users and 58
login-directory entries; 8 canonical accounts/handles; 20 migrations; 30 holds;
10 unpaired Auth records; zero conflicts or malformed handles. Classifications
match the historical manifest exactly. Four creates per migration plus one per
hold gives 110 documents. A historical in-memory reconstruction protects 58/58,
preserves original ownership, and reproduces coverage digest
`039837b1180ea9efe7c31bb83adf49da3de9e77bce1caf0c5d06811e98bf9d6e`.
This is not mislabeled as a production execution or full process-restart proof.

## G. Crash Recovery

The new primary fixture invokes the full `run()` CLI path in separate Node
processes with a disk-backed store, fsynced ledger, and SIGKILL interruptions:
before commit; no-commit transport interruption; committed/lost response;
post-commit/pre-checkpoint; immediately after checkpoint; between records.
Separate cases cover truncated/edited ledgers, changed committed ownership,
and initially exact state without progress. Exact committed operations have
zero resend delta. A no-commit send may retry only after a new exact absence
classification. Synthetic ownership is unchanged and final fixture coverage
is complete. Existing inner-loop restart tests remain supplementary.

## H. Freeze and Deadlines

Tested all 25 absent/active/released/foreign/malformed store combinations for
both activation and release (50 transitions), plus conflicting timestamps and
interruptions after either store mutation. No released-to-active downgrade;
exact partial activation/release reconciles. Release handles an absent peer.
Certification must be absent first. Monotonic deadlines, automatic restoration,
concurrent-run exclusion, and sealed emergency closeout are NOT qualified (R2).

## I. Completion and Certification

Exact authority path remains `authorityConfig/providerAccountCreation`.
Apply validates both active freeze records, source mapping, all metadata, and
exact per-operation readback. Certification requires complete progress and fresh
inventory matching completion; verify also rereads progress targets. Intents
are persisted before creation so restarts reuse the same certificate. Validity
is 15 minutes; expired certificates fail verification. Exact invalidation and
release ordering are covered. Independent run/operator binding remains R1.

## J. Secret, IAM, Deployment

Reviewed versioned secret-reference validators, runtime-only accessor metadata,
inactive gates, retained previous HMAC versions, and post-first-account rollback
guards. Eight selected tests cover these contracts and default-disabled
creation. No claim is made that prose-only secret provisioning or the mismatched
deployment executors form a qualified future command sequence (R3/R4).

The required correction boundary is a reviewed provider-window executor with
stdin-only secret creation, no key bytes in arguments/logs/artifacts, exact
version/accessor checks, inactive source-pinned authority plus six gateways,
pre/post-first rollback differentiation, and persistent failure simulations.
No actual key, IAM change, API enablement, deployment, or rollback occurred.

## K. Tests

- 57 focused operator/deployment-plan/classification tests, including 3 explicit
  starting-commit defect reproductions; final result recorded with the PR.
- 15 local Auth/RTDB demo emulator Rules tests passed. Run to verify the exact
  freeze/identity boundary, not to exercise the unrelated application.
- 8 selected HMAC, inactive-creation, and compatibility/rollback tests passed.
- Syntax checks for changed CommonJS code and `git diff --check`.
- A dedicated narrow PR workflow runs the operator suite without a browser,
  Firebase credentials, npm dependency installation, or deployment.

No broad suite was manually invoked. The repository's existing automatic PR
workflow did start performance checks on push: static checks completed and browser
budgets began before run `33918152122` was canceled. This was not required audit
coverage and is recorded as a test-economy exception. No full sync, Pages release,
sprites, Events, Group E, Discord or complete Functions suite was run.
The full future sequence simulation requested in phase 10 remains blocked by
R1-R4; isolated helper successes are not a substitute.

Focused CI run `33918152100` passed on code commit
`f5367fe9f27df0f5f4b9848a4959d40ae6d66ddf`. The follow-up report-only commit
does not change executable source and skips CI to avoid retriggering the broad job.

## L. PR #63

Update only the existing `ops/provider-identity-production-window` branch.
Keep draft, unmerged. No ready/merge action is authorized by this audit result.
Code correction commit: `f5367fe9f27df0f5f4b9848a4959d40ae6d66ddf`.
Final report-only commit and remote verification are recorded in the PR
description and task closeout. Old private preparation evidence is not rewritten.

## M. Repository and Production

Read-only checks at 2026-09-04T20:36:11Z: public release `2026-08-31.86`,
authority revision `e1-identity-authority-00061-jbt`, the two existing gateway
revisions unchanged, exposed activation gates false, Group E mode disabled,
Firestore/RTDB freezes absent, certification absent, Secret Manager disabled,
zero provider-only accounts. Secret absence itself cannot be independently
rechecked while its API is disabled; no secret was created by this task.
New provider gate environment entries absent on
the older deployed runtime are not falsely reported as explicit false values.

This task made no production database, secret, IAM, API, OAuth, Rules, backend,
Pages, canary or provider-account mutation. Google public entry and Discord were
not enabled. The 66 reviewed recovery records were neither read nor changed.

## N. Next Boundary

Correct and qualify R1-R4 on this same draft PR; prove the full persistent
pre-freeze/deploy/freeze/apply/certify/invalidate/release/privilege-closeout
sequence, including failure paths. Only then reconsider merge and regenerate
read-only preparation artifacts. Do NOT start a live identity window or request
its approval based on this report.

## External Contract References

Firestore document resource names are specified in the
[Firestore REST Document contract](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document).
RTDB conditional writes use ETag/If-Match in the
[Firebase REST conditional-request contract](https://firebase.google.com/docs/reference/rest/database#section-conditional-requests).
