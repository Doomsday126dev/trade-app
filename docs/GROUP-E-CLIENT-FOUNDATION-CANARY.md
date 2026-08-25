# Group E client-foundation canary

This is an inactive source contract. It does not authorize a production run, create a resource,
grant IAM, enable a gate, authenticate a subject, or call the canary.

## Scope and terminology

The canary is limited to synthetic D3 slots A and B and the existing
`readE1AccountFoundation` path. The security property is **durable at-most-once admission**:
after a slot's create-only marker commits, no later request for that slot may reach the authority.
The marker may be consumed even when the authority call never completes. No stronger delivery
guarantee is asserted.

Normal startup, authentication, navigation, RTDB hydration, Group C proof mode, and provider
linking remain outside this controller. Group E performs no phase-e-identity, RTDB user-data, or
ordinary-user write.

## Planned control plane

The reviewed control database is planned, not deployed:

- project: `trade-list-a4297`
- database: `e1-group-e-control`
- location: `us-central1`
- type and edition: `FIRESTORE_NATIVE`, `STANDARD`
- deletion protection: enabled
- PITR: enabled
- TTL: absent
- mobile/web rules: deny all
- current status: `NOT_CREATED`

The production adapters use the stable `@google-cloud/firestore` server package with an explicit
`databaseId`. The production resource manifest deliberately does not claim this database, its
IAM, a key, a run, or subject bindings exist. Separate deployed-control evidence is mandatory
before an activation guard can pass.

Every control record is create-only beneath one validated UUID run:

- `runs/{runId}`
- `runs/{runId}/consumptions/A`
- `runs/{runId}/consumptions/B`
- `runs/{runId}/reconciliations/A`
- `runs/{runId}/reconciliations/B`
- `runs/{runId}/closeouts/final`

Path constructors accept only a validated run ID and literal slot `A` or `B`. No subject or
request value becomes a path.

## Responsibility boundaries

The private operator validates evidence and provenance, owns the ephemeral Ed25519 private key,
creates the run, durably commits local dispatch state before signing, creates reconciliations and
the final closeout, can terminally abort a pristine pre-enable run, and prepares unconditional restoration.

The browser receives one signed non-secret capability. It verifies public integrity and exact
same-session Auth/slot binding, acquires one limited-use App Check token, makes one terminal
callable attempt, and retains no capability, token, key, result, runtime nonce, or ledger in
persistent browser storage. Browser terminality is defense in depth and is not the replay
authority. Runtime matching is trusted-operator evidence and browser defense in depth, not
cryptographic browser attestation.

The A-to-B sequence is same-page-runtime only. On module initialization the browser generates one
256-bit nonce with `crypto.getRandomValues()`, keeps the raw bytes only in module closure, and
exposes only a domain-separated digest over schema, origin, pathname, Firebase app-ID hash, and
that nonce. A reload, page replacement, crash, or close creates a different runtime identity. Once
A has run, loss of that exact runtime permanently forbids B for the run; local tooling records
`RUNTIME_INSTANCE_LOST`, restores gates, and closes blocked. The raw nonce is never persisted or
recoverable, so cross-runtime continuation is intentionally unsupported.

The gateway is the server admission boundary. It verifies Auth, limited-use App Check, the
Ed25519 signature, exact runtime/provenance/subject/budget/dependency fields, and freshness. It
then atomically creates the slot marker. Only after the transaction commits does it derive the
safe admission receipt and make one non-retrying authority attempt.

The authority remains private and gateway-only. In Group E mode it requires and validates the
safe admission receipt and binds that digest to its response and structured logs. It does not
read the control database and does not claim to independently verify marker commitment.

The local reconciler validates control, gateway, authority, state, write, gate, IAM, privacy, and
runtime evidence. Browser output alone is never authoritative.

The browser evidence helper must derive UID and trainer hashes through
`PogoServices.e1ClientFoundationCanary.subjectHash()`. That helper and the gateway use the exact
`group-e-client-foundation` domain. Historical Group C/D3 evidence uses a different domain and is
never accepted as Group E evidence.

Before any live run is created or any gate is enabled, the focused
`npm run check:e1-production-client-foundation` rehearsal must reach `READY_TO_ENABLE`. It assembles
synthetic schema-v2 evidence, replay and immutable-ledger digests, an in-memory Ed25519 run, JIT,
guard result, dispatch-bound capability envelope, exact five-to-four browser projection, and
browser `open()` validation. The rehearsal performs no IAM, cloud, Firebase SDK, callable, or
private-artifact operation. Live raw evidence is never an input to this local rehearsal.

## Signed capability

The run stores exact schema, environment, project, run ID, slots and hashed bindings, cohort and
Firebase-app digests, Ed25519 key ID and public SPKI, Pages/gateway/authority/tooling provenance,
D3 closeout and 32-document baseline, admission and replay evidence digests, initial ledger
digest, issue/expiry times, maximum two admitted claims, and its canonical digest.

The key ID is a domain-separated SHA-256 digest over the exact DER SPKI bytes. The private key
exists only in a mode-0600 ignored operator artifact. It is never logged, tracked, sent to the
browser, or sent to a service.

Each capability is signed over one exact domain-separated ordered JSON array. The payload binds:

- production project/environment, run, slot, unique JTI, and distinct generation
- exact UID/trainer/cohort, Firebase app, stable browser-context, ephemeral runtime-instance digest,
  safe-integer session generation, canonical session-generation digest, and attempt hash
- exact Pages, gateway, authority, tooling, D3 closeout, baseline, admission, and replay provenance
- the dispatch-committed local-ledger digest
- issue/expiry times, remaining budget, run-manifest digest, and key ID
- null A dependencies, or B's exact A reconciliation and verified session-boundary digests

The browser request has exactly `schemaVersion`, raw request-scoped `attemptId`, `capability`,
and a strict base64url signature. Missing/extra fields, malformed encoding, modified payloads,
wrong keys, stale windows, and mismatched runtime values fail closed. Public source and arbitrary
values cannot forge the signature.

Slow browser evidence collection and operator preparation happen before the short execution
clock. After all evidence is assembled, the pre-enable rehearsal passes first; fresh JIT and run
times are then created as late as possible. The JIT admission proof remains limited to 15 minutes
and authorizes the single durable `ENABLEMENT_STARTED` transition while it is fresh. Once that
transition is committed, JIT expiry alone does not invalidate the already-started activation; the
same immutable run, evidence, source, key, subject, and budget bindings remain fixed and the existing
45-minute run/activation envelope becomes the deadline. An expired JIT cannot create that transition,
replace it, or start another enablement. Each A or B capability
is issued only after its durable dispatch and remains valid for at most 15 minutes. This ordering
provides a fresh per-slot window without extending replay exposure or starting the JIT clock during
manual evidence collection.

The one session-generation digest contract is the ordered array
`[1, "group-e-session-generation", schemaVersion, environment, projectId, runId, cohortDigest,
slot, uidHash, trainerHash, generationId, sessionGeneration, firebaseAppIdHash,
browserContextDigest, runtimeInstanceDigest]`. Dispatch tooling and server admission recompute it;
the browser recomputes the same array from the signed context, its actual session generation, and
its module-private runtime identity before importing the Functions SDK. A syntactically valid
caller-supplied digest is never authoritative.

The runtime-instance digest contract is
`[1, "group-e-browser-runtime-instance", origin, pathname, firebaseAppIdHash, nonceHex]`, where
`nonceHex` represents the module-private 32-byte nonce. Only the resulting digest may enter
evidence or capabilities. The raw nonce is never an operator input, DOM value, URL value, log,
diagnostic, browser-storage value, or local artifact.

## Durable admission

The gateway control-store transaction uses `maxAttempts: 3`; its callback has no external side
effect, logging dependency, randomness, file write, token acquisition, signature generation, or
authority call.

For A, the transaction validates the run, capability, runtime identity, and absent A marker, then
creates `consumptions/A`. For B it additionally reads and validates canonical
`reconciliations/A` against the exact signed prior-A digest; the same signed B capability separately
commits the canonical session-boundary digest before `consumptions/B` is created.

After commitment, the gateway derives a receipt from immutable marker fields and makes at most
one authority HTTP attempt with library retries disabled. Timeout, connection failure, malformed
response, or ambiguous outcome is terminal. A committed marker survives a process restart and
causes every replay, fresh controller, or fresh App Check token to fail before authority use.

Expected healthy behavior is two browser attempts, two gateway invocations, two admitted claims,
two authority calls, two successful foundation reads, six control writes, and zero application
writes. The server-enforced maximum is one admitted A claim, one admitted B claim, and at most one
authority call after each accepted marker. Rejected gateway requests are not claimed to be
prevented; they are rejected before authority use.

## Immutable control records and reconciliation

All records use exact fields, schema version 1, domain-separated canonical digests, extra-field
rejection, safe hashed identifiers, and create-only semantics. Raw UIDs, trainer names, tokens,
credentials, private keys, application data, and raw capability signatures are forbidden.

A reconciliation binds the A marker, admission receipt, unique gateway and authority records,
response/result, active foundation status, unchanged `32 = 8+8+8+8` baseline, zero
migrations/conflicts/writes, exact gates/IAM/privacy/runtime evidence, one remaining claim, and
no future session-boundary reference. That null future reference makes the dependency graph
acyclic so the boundary can commit the exact immutable A reconciliation digest.

The immutable local boundary stores the exact canonical A dispatch reference, exact canonical A
reconciliation digest, terminal/closed/result-cleared/sign-out observations, and full
before/after session contexts. `before` must equal A's committed integer, stable browser context,
runtime-instance digest, and session digest. `after` must use that same runtime-instance digest, a
strictly later safe integer for the independently bound B subject, and a distinct B controller
generation. Its digest is recomputed from that exact context. A different or missing runtime
identity fails before B dispatch. The boundary digest commits the ordered evidence, and B's signed
capability commits the exact A reconciliation digest, boundary digest, exact B integer,
runtime-instance digest, and exact B session-generation digest. This directed ordering avoids a
circular hash while binding every dependency.

B admission and reconciliation require that exact A record. B reconciliation binds zero
remaining claims. The final closeout control record is created before the local ledger may close,
and only after canonical restoration and an accepted passive observation of 30 through 75 minutes.
Healthy closeout requires B reconciliation.
Blocked closeout records the containment reason and may preserve only verified completed
evidence. Both require restored gates, unchanged state, zero prohibited writes, and zero
additional admitted calls.

A pristine `A_READY` run may instead create exactly one `group-e-pre-enable-abort` record at
`runs/{runId}/closeouts/final`. It requires disabled gates, no A dispatch, no A/B consumption or
reconciliation, zero prohibited writes, and a bounded reason such as
`TIMING_EXPIRED_BEFORE_ENABLEMENT`. The local ledger then enters terminal `PRE_ENABLE_ABORTED`
with zero remaining budget. This is not `CLOSED_BLOCKED`, does not claim a post-enable lifecycle,
and requires no passive observation because no gate or callable boundary was crossed.

## Immutable local ledger

The private ledger is a mode-0700 directory containing a mode-0700 `snapshots` directory,
mode-0600 immutable transition snapshots, and a mode-0600 `HEAD.json`. Each snapshot binds its
sequence, prior transition digest, completed prefix, exact stage/next action/budget, control
paths, run/provenance references, terminal and reconciliation evidence, gate state, and
domain-separated transition digest.

Stages are:

1. `A_READY`
2. `ENABLEMENT_STARTED`
3. `A_DISPATCH_COMMITTED`
4. `A_TERMINAL_UNRECONCILED`
5. `A_RECONCILED_SESSION_BOUNDARY_PENDING`
6. `A_RECONCILED_B_PENDING`
7. `B_DISPATCH_COMMITTED`
8. `B_TERMINAL_UNRECONCILED`
9. `AB_RECONCILED_RESTORATION_REQUIRED`
10. `RESTORED_OBSERVATION_PENDING`
11. `CLOSED_HEALTHY`

The pristine terminal branch is `PRE_ENABLE_ABORTED`. Any contained post-start path uses
`BLOCKED_RESTORATION_REQUIRED` and `CLOSED_BLOCKED`. Apply mode takes
an exclusive atomic lock, rereads and validates the complete chain, compares the expected prior
digest, writes the next snapshot with `O_EXCL`, fsyncs it, atomically replaces and fsyncs HEAD,
and fsyncs containing directories where supported. It fails closed on stale writers, live or
unknown locks, rewind, fork, gaps, corruption, truncation, missing history, and orphan files.
Plan mode writes nothing.

Dispatch is durably committed before capability signing or exposure. Once A or B reaches
`*_DISPATCH_COMMITTED`, that operation can never be reconstructed as a restart action.
Uncertain capability delivery blocks the run; the capability is never regenerated or reissued.
The full accepted session boundary is retained in every later ledger snapshot. After restart,
the only valid B dispatch is the exact boundary-after generation ID, safe-integer generation,
browser context, runtime-instance digest, subject/run/cohort context, and canonical digest;
unrelated 64-hex values fail before signing. A restarted operator may reconcile A, but it cannot
substitute a new page runtime. If the original page runtime no longer exists, only the explicit
runtime-loss block and unconditional restoration paths are valid.

## IAM and containment

Planned gateway and operator roles contain only database get/getMetadata and entity get/create.
The reviewer contains only database get/getMetadata and entity get. Every binding is conditioned
to the exact `e1-group-e-control` database resource. Entity list/update/delete and database
create/update/delete are excluded, as are phase-e-identity, RTDB, Auth, provider-linking, and
impersonation permissions.

IAM is still database-wide inside the control database, so exact paths and operation allowlists
remain reviewed-code boundaries. Gateway runtime exports only marker consumption; it cannot
create runs, reconciliations, or closeouts. The authority has no control-database role.

Restoration is immediate containment and never changes IAM. It is available from every
post-enable stage without fresh evidence, JIT, activation-window validity, a readable ledger,
control-database availability, A/B success, or reconciliation success, and it never calls the
canary. IAM revocation may occur only after a separately accepted closeout.

## Immutable source and activation boundary

This source change is Commit A only. It intentionally changes the gateway source inventory while
leaving `e1-gateway-source-manifest.json` pinned to the prior four-file source. Deployment
eligibility must therefore fail closed until Commit A is immutable and a separate reviewed
Commit B pins Commit A's exact six-file source SHA and fingerprint.

No release ID, service-worker version, Pages selector, tag, authority revision/image, resource,
IAM binding, key, run, private evidence, or gate is advanced by this candidate. Provisioning the
named database and narrow roles, deploying the reviewed authority/gateway source, producing real
private evidence, and any canary execution each require separate authorization.
