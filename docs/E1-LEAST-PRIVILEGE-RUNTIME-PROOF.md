# E.1 least-privilege runtime proof

Status: historical local proof for the rejected RTDB-write design. It is retained as authorization-boundary evidence only. The active E.1 staging architecture is the private Cloud Run and named Firestore design in `E1-AUTHORITATIVE-STORE-DECISION.md`; production remains untouched.

## Emulator-proven authorization model

The E.1 data plane uses a Firebase Admin app initialized per operation with `databaseAuthVariableOverride`. The Admin credential establishes a trusted server connection; the override replaces the unrestricted Rules auth variable with a narrow, immutable context for that database session. The candidate uses contract version `1`, one fixed runtime UID per role, an explicit environment, and operation scope:

- `handle-reservation`: one subject UID and one encoded handle key.
- `foundation-repair`: one subject UID, one encoded handle key, and one operation ID.
- `config-read`: exact `durableAuthConfig` read only.
- `configuration-operator`: an offline, separately controlled config writer recognized by Rules but deliberately unavailable from the runtime session factory.

One Functions runtime service account can create these logically separate sessions because RTDB Rules evaluate every session using its fixed override. Separate service accounts would improve process and credential isolation, but they do not provide finer RTDB path authorization than the override.

Browser clients cannot inject this override. The wire protocol accepts `authvar` only on a connection already authenticated with an Admin credential. A normal Firebase ID token is issued by Firebase Auth and cannot acquire the reserved runtime UID or E.1 token fields from sign-up payloads, URL/hash changes, local storage, or request headers. The emulator proof creates a real ordinary Auth user, verifies attempted custom fields are absent from its ID token, and confirms an override-shaped browser header remains denied.

## Exact path matrix

| Persona / operation | Exact reads | Exact writes |
| --- | --- | --- |
| `reserveTrainerHandle` | `authIndex/{subjectUid}`, matching `users/{username}`, `loginDirectory/{username}`, `durableAuthConfig/handleReservationEnabled`, `accounts/{subjectUid}`, `trainerHandles/{handleKey}` | `accounts/{subjectUid}`, `trainerHandles/{handleKey}` |
| `repairAccountFoundation` | `authIndex/{subjectUid}`, matching `users/{username}`, `durableAuthConfig/foundationRepairEnabled`, `accounts/{subjectUid}`, `trainerHandles/{handleKey}`, `identityMigrations/{subjectUid}` | `accounts/{subjectUid}`, `trainerHandles/{handleKey}`, `identityMigrations/{subjectUid}/operations/{operationId}` |
| `readDurableAuthConfig` | `durableAuthConfig` | none |
| offline `configuration-operator` | none required | `durableAuthConfig` only |
| ordinary authenticated client | `durableAuthConfig/clientFoundationEnabled`; own `accounts/{uid}` only while enabled | none at E.1 roots |
| protected Admin | exact account, handle, migration, and config reads | none at E.1 roots |

No E.1 persona can enumerate `accounts`, `trainerHandles`, or `identityMigrations`. No persona receives username-list, public-share, preferences, Admin, community, or root write authority.

## Rules candidate and atomicity

`tests/firebase/database.rules.durable-auth.json` is generated from the live rollback file whose SHA-256 is `e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf`. Removing the four E.1 roots and restoring the two narrow legacy-read clauses produces the baseline object exactly.

Reservation uses one RTDB multi-location `update()` containing the exact account and handle leaves. Repair adds one exact migration-operation leaf. RTDB applies a multi-location update atomically: if any leaf fails Rules, no leaf commits. This avoids downloading or transacting over the root. The adapter exposes no generic path API and never uses a root transaction. Rules bind every permitted leaf to the session UID, handle, role, environment, gate, and (for repair) operation ID. The fixed adapter is responsible for always supplying the complete pair/triple; emulator collision tests prove failed writes do not leave a partial foundation.

## Configuration authorization

`clientFoundationEnabled` is the only anonymous-readable configuration field. An owner can read only its exact account while this flag is true. Handle and repair sessions can read only their own gate and environment fields; the config-reader can read the exact config node. Protected Admin can read the exact config node. Ordinary Functions runtime personas cannot write configuration. A separately reviewed offline `configuration-operator` override is the only candidate Rules writer and is not constructible through the runtime factory.

All E.1 gates remain false when configuration is eventually initialized unless separately approved: client foundation, handle reservation, and foundation repair.

## Explicit runtime target

The existing Functions bootstrap now requires an explicit environment, project, database URL, and Functions region outside the emulator. Emulator defaults are allowed only for a `demo-` project on loopback. Staging requires a `-staging-` project marker and a matching Firebase RTDB host. Production has no implicit fallback.

The local staging guard additionally requires a fixed ignored readiness file, exact expected project number, exact project ID, matching RTDB URL, and `staging` environment. It rejects production-similar IDs before any command can proceed. Its output is redacted and it performs zero cloud operations. A future command must run this guard before a separate, explicitly approved deploy command; no deploy command is included here.

## IAM derivation and cloud stop

RTDB IAM has no path-scoped writer permission. The documented `firebasedatabase.instances.get` permission includes read-only access to all data in an instance, while `firebasedatabase.instances.update` includes full read/write access to all data. An Admin SDK writer therefore needs an underlying credential with authority that is broader than the Rules override. Runtime code holding that credential could initialize another Admin app without `databaseAuthVariableOverride` and bypass the intended path boundary.

That makes the override an effective honest-session downscope, but not a hard least-privilege credential boundary against compromised runtime code. The emulator proof is valid, yet this model is **rejected for cloud E.1 writes** under the current security requirement. Do not grant Editor, Owner, Firebase Admin, Firebase Realtime Database Admin, or a custom role containing `firebasedatabase.instances.update` to the runtime.

The next local design checkpoint must evaluate a trusted Firebase Auth principal or another mediator whose credential cannot omit Rules enforcement. Any custom-token approach must separately address the broad authority to mint arbitrary Firebase identities and claims; moving broad privilege from RTDB to Auth is not automatically acceptable.

For completeness, the control-plane separation remains:

- Runtime identity: no RTDB data permission is approved. Function execution alone is insufficient for E.1 writes until a hard Rules-enforced credential model is proven.
- Functions deployer: narrowly scoped Functions deploy/update, service-account act-as for the chosen runtime identity, and build submission permissions during an approved window.
- Build identity: artifact build/write and log write only; no RTDB data role.
- Rules operator: RTDB Rules deployment uses `firebasedatabase.instances.update`, which the IAM reference also defines as full data read/write authority. There is no honest "Rules-only" custom role from that permission. If deployment is later approved, bind it only to the reviewed operator for the bounded two-hour window, verify the Rules hash, and revoke it immediately; do not grant it to runtime or build identities.
- Offline configuration operator: no standing cloud identity yet. If created, it must be separate from ordinary runtime and used only for the exact config write.

No unavoidable broad runtime IAM permission has been accepted. Because the documented write permission is broad, there is no runtime IAM canary to approve for this model.

## App Check sequence

1. Deploy the gated callable with all E.1 data gates false.
2. Validate the staging debug-token CI path against synthetic-only identities.
3. Validate the normal staging web path with a genuine App Check token.
4. Prove missing, invalid, replayed, and wrong-app tokens are rejected.
5. Review logs and rollback readiness.
6. Enable App Check enforcement only after a separate approval.

Enforcement remains disabled because no ordinary-Functions gateway or production E.1 client is deployed.

## Revised staging resources

Individually inert resources such as service-account objects without roles, a CLI alias, budget alerts, empty secret containers, and log-metric definitions could be created without data access. A proposed "Rules custom role" is removed from the safe list because its necessary RTDB update permission is also broad data authority. This checkpoint does not recommend a new cloud creation approval while runtime authorization is unresolved.

Not safe: runtime IAM binding, deployer/build bindings, Rules custom-role binding, Rules deployment, Functions deployment, `durableAuthConfig`, HMAC secret value, synthetic users/fixtures, App Check enforcement, client wiring, or any gate change. Configuration and fixtures are staging writes and require a replacement authorization model plus explicit write approval.

## Cost classes

- Expected near `$0` / free quota when idle: empty service accounts and IAM role definitions, CLI alias, inactive App Check registration, and low-volume RTDB metadata.
- Potentially billable by use: Functions invocations, outbound networking, RTDB storage/downloads, Cloud Build minutes, Artifact Registry storage, Secret Manager active versions/accesses, log ingestion/retention, log-based metrics, and reCAPTCHA Enterprise assessments beyond free allowances.
- Recurring storage: container images/build artifacts, retained logs, RTDB bytes, and secret versions.
- Event-driven usage: synthetic tests, callable invocations, App Check/reCAPTCHA assessments, metric time series, and alert notifications.

Budget alerts do not cap spending. The staging project must keep teardown ownership, low max instances, bounded test windows, artifact retention, and explicit cost review before unattended schedules are introduced.

## Rollback

Rules rollback is the exact live baseline hash above. Functions rollback is deletion or traffic rollback of the new gated callable while all E.1 gates remain false. Config rollback keeps every E.1 gate false. IAM rollback removes temporary bindings and disables the runtime identity. No migration baseline advances until synthetic staging verification is complete.
