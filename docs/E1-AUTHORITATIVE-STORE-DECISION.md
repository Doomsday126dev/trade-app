# E.1 authoritative-store architecture decision

Status: implemented and proven with synthetic identities in the isolated staging project. All mutation gates are disabled after the acceptance run. No production resource, identity, provider, Rules, IAM, or data operation has occurred.

## Decision

Use a **dedicated, private identity-authority service backed by a dedicated named Cloud Firestore database** for E.1 and E.2. Keep legacy/product data in Realtime Database. Do not grant Firestore or RTDB data permissions to ordinary application Functions.

The authority service is a separate trust domain, source artifact, Cloud Run service, and service account. The ordinary callable gateway receives a Firebase ID token and App Check token, invokes the private authority service using its own Google-signed service identity, and forwards the original Firebase ID token separately. The authority service verifies the Firebase token again and derives the UID from it. It never accepts an owner UID for user operations.

The authority service uses its own Firestore credential only against a named `phase-e-identity` database. Staging uses a database-resource IAM condition on `roles/datastore.user`; it grants data-plane authority within that one database but no project/database administration. Firestore IAM does not constrain individual documents or fixed operations, so the service boundary, transaction contracts, private invocation boundary, and deployment controls enforce the fixed-operation API. The current source candidate has six operations; deployed `.86` revisions retain the historical five-operation inventory. This broader in-database role is a residual risk to review before production.

Legacy identity verification uses the caller's Firebase ID token against exact RTDB REST paths. Existing RTDB Rules authorize the exact `authIndex/{uid}` and reciprocal `users/{username}` reads. Neither the ordinary runtime nor the authority service receives `firebasedatabase.instances.get` or `firebasedatabase.instances.update`.

No browser reads the identity database directly in E.1. The authority service returns a redacted account-foundation view. Firestore Rules for the named identity database remain deny-all. E.3/E.4 should use a separate `phase-e-state` database or separately reviewed user-token Rules so compromise of high-churn sync code cannot rewrite identity authority.

## Threat model

Threat: the ordinary application runtime is compromised.

Required outcome: that component cannot rewrite arbitrary account ownership, claim arbitrary trainer handles, change migration state, merge accounts, or reassign established UIDs merely because it normally initiates one E.1 operation.

Assumptions:

- Firebase Auth signing keys, Google service identity, Firestore, Cloud Run isolation, and deployed Rules behave as documented.
- The attacker controls ordinary Function code and its runtime identity, including its ability to invoke services allowed to that identity.
- The attacker does not automatically compromise the separately deployed identity-authority image or service account.
- A captured end-user Firebase ID token can authorize only that UID until token expiry. It does not become an operator identity.
- Deployment and offline migration operators are separate from both runtimes and have bounded, temporary access.

Residual risk: compromise of the identity-authority service itself can create or update any document in `phase-e-identity`, because Firestore IAM is database-scoped, not document-scoped. This architecture deliberately makes that component tiny, private, separately deployed, non-enumerating, and free of generic path methods. Cloud SQL stored procedures can enforce a narrower database-level API, but their standing cost and operational burden are not justified at current scale.

## Trust domains

| Domain | Standing capability | Explicitly absent |
| --- | --- | --- |
| Browser | Firebase ID token; current RTDB exact reads allowed by Rules | Firestore identity access, operator access, broad RTDB access |
| Ordinary application Functions | Invoke only the private authority service; no data role | Firestore/RTDB data IAM, authority service-account impersonation, token minting |
| E.1 identity-authority service | Fixed six-operation source API; conditionally scoped `roles/datastore.user` on the exact named Firestore database | Project/database admin; RTDB IAM; Auth user administration; generic data API export |
| Offline migration operator | Temporary invocation of operator endpoints with reviewed manifest hash | Standing runtime role; arbitrary browser use; automatic account merge |
| Config operator | Temporary exact config operation after separate approval | Runtime data role; migration authority |
| Deployer/build identities | Deploy/act-as/build only for their reviewed artifact | Datastore data access and runtime invocation unless separately required |

For private Cloud Run service-to-service calls, the gateway places its Google OIDC identity in `X-Serverless-Authorization` and preserves the end-user Firebase token in `Authorization`. Cloud Run authenticates the gateway; the service independently verifies the Firebase token.

## Fixed authority API

The source candidate exposes only:

1. `readAccountFoundation`: exact caller UID; redacted result.
2. `createProviderAccountFoundation`: current Google-linked caller; atomic provider-only account, handle, provider-subject, and idempotency foundation after namespace certification.
3. `reserveTrainerHandle`: caller UID from verified token; canonical handle and request ID only.
4. `repairAccountFoundation`: caller UID from verified token; handle derived from reciprocal legacy binding, never request input.
5. `applyMigrationManifest`: separately authenticated operator; reviewed UID/handle manifest and SHA-256 fingerprint.
6. `freezeIdentityConflict`: separately authenticated operator; bounded reason code and request ID.

There is no generic read, write, set, update, delete, list, query, collection, document, ref, path, bulk, merge, UID-reassignment, or token-minting operation.

## Data model

All paths below are in the dedicated named identity database.

```text
accounts/{uid}
  schemaVersion, uid, canonicalTrainerName, normalizedTrainerName,
  handleKey, legacyUsername, legacyAuthVersion, status, revision,
  createdAt, updatedAt

trainerHandles/{v1_<utf8 hex of normalized handle>}
  schemaVersion, uid, canonicalTrainerName, normalizedTrainerName,
  state, revision, claimedAt, updatedAt

operationRequests/{uid}/requests/{requestId}
  schemaVersion, operation, fingerprint, bounded result, createdAt

identityMigrations/{uid}/operations/{requestId}
  schemaVersion, uid, handleKey, operation, fingerprint,
  manifestFingerprint when applicable, status, createdAt

identityConflicts/{uid}/events/{requestId}
  schemaVersion, uid, reasonCode, fingerprint, status, createdAt

authorityConfig/e1
  independently reviewed gates; no browser read or write
```

The Firebase UID is the immutable account document ID and is repeated in the document for validation/audit. The normalized handle is never accepted as an owner credential. A reverse handle document is the unique claim. The handle key is the deterministic `v1_`-prefixed UTF-8 hex encoding already used by the E.1 authorization contract. There is no automatic merge path.

## Atomic handle-claim proof

`functions/e1-authority-service/firestoreE1AuthorityAdapter.js` is the canonical adapter and runs one Firestore transaction that reads the exact account, handle, and idempotency documents before creating all three. The Functions-side module only re-exports this implementation for local architecture proofs. A repair also includes the exact migration operation document. Firestore retries transactions when a read document changes and never partially applies transaction writes.

The local Firestore emulator proof races UID A and UID B for the same normalized handle:

- exactly one transaction succeeds;
- the handle points to the winner;
- only the winner account exists;
- only the winner idempotency record exists;
- the loser has no partial account, migration, or request state;
- identical replay returns the stored result;
- a reused request ID with a changed fingerprint fails.

The deny-all Firestore Rules fixture also proves a normal Firebase-authenticated browser cannot read the identity database.

## Architecture comparison

### A. Existing RTDB plus `databaseAuthVariableOverride`

Security: the override is a useful honest-session Rules downscope and browser clients cannot forge it. However, the underlying server credential needs instance-wide RTDB IAM. Compromised runtime code can initialize a second Admin app without the override and bypass Rules.

Blast radius: all data in existing RTDB instances reachable by the credential, including legacy/product paths. Boundary enforcement is runtime convention plus Rules only while the override is retained. This fails the threat model.

Atomicity/testability: excellent local proof; multi-location updates are atomic. Cost and operational simplicity are favorable. The security failure is decisive.

### B. Firestore in ordinary application Functions

Firestore improves data modeling, transactions, exact-document operations, emulator support, future preference/history fit, and database isolation. A named database can be isolated with an IAM condition.

It does **not** solve the boundary when the ordinary runtime uses the server SDK. Server libraries bypass Firestore Security Rules. `datastore.entities.get/create/update` apply across documents in the authorized database; IAM can be database-scoped but not collection/document-scoped. A compromised runtime could create or update arbitrary identity documents. This version fails the threat model.

Firebase-ID-token REST requests are different: Firestore evaluates Security Rules for them. That is viable for future self-service operations, but privileged repair/migration still requires a separate authority. E.1 therefore keeps the browser denied and uses the service boundary consistently.

### C. Dedicated authority service with the existing RTDB

Service separation is meaningful if ordinary Functions have no RTDB IAM and can only invoke a private fixed API. It is not meaningful if the service shares source, deployment, or runtime identity with ordinary Functions.

The authority service would still need instance-wide RTDB write authority. Compromise of the authority service could modify legacy/product data as well as identity state. A secondary RTDB instance isolates data logically, but the documented RTDB IAM write permission remains broad and does not provide the same documented per-database conditional binding available to Firestore. This option improves the ordinary-runtime boundary but leaves the authority blast radius unnecessarily large.

### D. Dedicated authority service plus named Firestore (recommended)

Ordinary Functions have no datastore role. Their compromise yields only the ability to invoke fixed user endpoints with a valid user token. They cannot forge a UID, invoke operator endpoints, access Firestore directly, or access RTDB through IAM. The service re-verifies the user token and derives the UID. A bounded legacy-mapping reader is still required before `reserveTrainerHandle` can be activated; the authority runtime is not granted broad RTDB access and currently fails closed when no approved mediator is injected.

The authority service credential can affect data in the named identity database, so service compromise remains serious. Database-level IAM isolation, a six-operation source API, separate deployment, max-instance limits, idempotency, redacted logging, and no generic SDK export materially reduce exposure. App Check remains a future gateway requirement; it is not part of the private staging shell.

### E. Cloud SQL PostgreSQL with stored procedures

A dedicated PostgreSQL login granted only `EXECUTE` on carefully written stored procedures, with no table DML, can make the database enforce the operation boundary. A unique index and transaction provide one-winner handle claims. This is the strongest credential boundary considered.

It also introduces an always-on database, SQL migrations, connection management/pooling, backups, patch/version operations, and a second operational model. It is materially more expensive at current scale and less compatible with planned Firebase client state. Keep it as the fallback if the authority-service trust domain is later judged insufficient; do not create it now.

## Security and blast-radius matrix

| Option | Compromised credential/capability | Maximum ordinary-runtime blast radius | Enforcement | Bypass from ordinary code? | Decision |
| --- | --- | --- | --- | --- | --- |
| A RTDB override | Instance-wide RTDB Admin credential | All reachable RTDB data | Override + Rules when used | Yes, omit override | Reject |
| B Firestore server SDK in ordinary Functions | Named-database entity create/update/get | Any identity document in that database | Database IAM only | Yes, call SDK directly | Reject |
| C private service + RTDB | `run.invoker` for ordinary runtime | Fixed API for valid user tokens | Cloud Run IAM + service code | No direct DB bypass; authority service remains broad over RTDB | Viable, inferior |
| D private service + named Firestore | `run.invoker` for ordinary runtime | Fixed API for observed valid user tokens; no arbitrary UID/operator action | Cloud Run IAM, token verification, service code, named-DB IAM | No direct DB bypass | Recommend |
| E PostgreSQL procedures | Procedure `EXECUTE` | Procedure-defined operations | Database grants, procedures, constraints | No table bypass if grants are correct | Strong but disproportionate |

## Decision matrix (5 is best)

| Option | Security | Implementation simplicity | Operational simplicity | Firebase compatibility | Migration simplicity | Testability | Rollback | E.3/E.4 fit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A RTDB override | 1 | 4 | 4 | 5 | 5 | 5 | 4 | 3 |
| B Firestore in ordinary Functions | 2 | 4 | 4 | 4 | 3 | 5 | 4 | 5 |
| C private service + RTDB | 3 | 3 | 3 | 5 | 4 | 4 | 4 | 3 |
| D private service + named Firestore | 4 | 3 | 3 | 4 | 3 | 5 | 4 | 5 |
| E PostgreSQL procedures | 5 | 1 | 1 | 2 | 2 | 4 | 3 | 4 |

## Client read model

Recommendation: the client does not directly read the identity database in E.1/E.2. `readAccountFoundation` returns only the caller's redacted foundation state. Benefits:

- migration manifests, conflict evidence, operation fingerprints, provider-subject claims, and operator state remain non-client data;
- identity Rules stay deny-all and easy to audit;
- no query/enumeration surface is created;
- schema changes remain behind a stable response contract.

Cost is one service invocation and one exact document read. At this scale, that is negligible. E.3 preference data has a different read/write shape and should be separately reviewed for direct user-token Rules access in `phase-e-state`.

## E.2-E.4 fit

### E.2 provider linking and recovery

Add `accounts/{uid}/providers/{provider}` and globally unique `providerSubjects/{providerAndSubjectHash}` documents in `phase-e-identity`. Reserve both with exact idempotency evidence in one authority-service transaction. Provider data must come from a fresh verified provider exchange/Admin Auth observation bound to the authenticated UID, never client identity fields. Google (`google.com`) is the first admitted contract provider; Discord (`discord.com`) is representable but its OAuth exchange is not part of the foundation contract. Email link is deferred because Firebase reports email/password and email-link under the same `password` provider ID, so they cannot be treated as independent provider links without a separately reviewed migration. Recovery and unlink remain separate operator/reauth flows. No provider can replace the account UID.

### E.3 Favorites, tags, preferences, and Recents

Use `phase-e-state`, not the identity database. Favor exact per-owner documents/subcollections, monotonic revisions, tombstones, bounded Recents, and user-token Rules or a separately isolated state service. Many small writes are natural for Firestore. Keep identity-authority service credentials out of the state database unless a reviewed operation needs them.

### E.4 list revisions and viewer baselines

Use immutable or monotonic list revision documents and exact viewer-baseline documents in `phase-e-state`. Transactions support revision acknowledgement and compare-current semantics. Bounded snapshots can be split into deterministic chunks; queries must be owner/viewer constrained and Rules are not filters. Added/removed/changed summaries are derived from stable fingerprints; baseline advancement is an explicit exact-document write after successful display, never automatic on failed reads.

## Cost model

Assumptions for comparison: 300 Firestore document reads, 100 writes, and 5 lightweight authority calls per MAU/month once E.3/E.4 are active; small documents; same-region service/database; Cloud Run request billing with minimum instances set to zero; bounded logs without payloads. E.1 alone is much lower. Named Firestore databases do not receive the free database quota, so operation charges start immediately.

| MAU | Named Firestore data | Cloud Run authority | Storage/network/logging | Expected total/month |
| ---: | ---: | ---: | ---: | ---: |
| Current (about 1-2) | <$0.01 | $0 within typical free usage | ~$0 | ~$0 |
| 100 | <$0.01 | $0 | <$0.10 | <$0.25 |
| 1,000 | about $0.02 | $0 | <$0.25 | <$1 |
| 10,000 | about $0.18 | $0 to low single dollars | <$1 | about $1-$5 |
| 100,000 | about $18 | usually low single dollars at this request volume | about $1-$10 | about $20-$40 |

At representative current US Firestore Standard rates, 100,000 reads are roughly $0.03 and 100,000 writes roughly $0.09; location changes pricing. Cloud Run scales to zero with no idle compute charge when minimum instances are zero. Logging can dominate if request payloads or verbose traces are retained, so logs must stay redacted and sampled.

RTDB plus a dedicated service is likely also near $0 at current scale, but its cost advantage is not worth the larger authority blast radius. Firestore in ordinary Functions has approximately the same datastore cost as the recommendation but fails security. Cloud SQL has a standing instance/storage/backup cost commonly in the tens of dollars per month before meaningful traffic and can rise into hundreds at 100,000 MAU; exact sizing requires a selected region/tier.

## Failure modes and rollback

| Failure | Behavior | Rollback |
| --- | --- | --- |
| Handle race | One transaction wins; loser receives deterministic conflict | No cleanup; loser has no writes |
| Reused request ID, changed input | Fingerprint mismatch, no writes | Issue a new reviewed request ID only |
| Partial legacy binding | Repair denied | Keep legacy login/list state unchanged; operator review |
| Authority service unavailable | E.1 operation unavailable; legacy app continues | Route no new E.1 calls; keep gates false |
| Wrong project/database | Deployment guard rejects | No data operation |
| Service credential misuse | Named identity database at risk | Disable service identity, set gate false, route traffic to prior revision, review immutable audit/manifests |
| Migration conflict | Freeze exact UID; never merge automatically | Offline review; no baseline advancement |

Rollout is additive. Legacy username/PIN login, reciprocal RTDB bindings, username-keyed list paths, and public shares remain authoritative for existing behavior until each account migration is verified. Rollback disables E.1 gates and service traffic; it does not delete migrated data or rewrite legacy lists.

## Migration from the RTDB E.1 plan

1. Retain the RTDB proof as evidence that the proposed Rules scope was internally coherent and that the IAM boundary was not.
2. Do not deploy `database.rules.durable-auth.json` or `firebaseDurableAuthAdapter.js`.
3. Adapt the staging target guard to require the named Firestore database ID, database location, authority service name, gateway service account, authority service account, and false gates.
4. Package the authority boundary separately from existing callable Functions. Do not import it from `functions/src/index.js`.
5. Use the current reviewed identity manifest format as offline migration input; add a manifest fingerprint and operator-only application route.
6. Test in the Firestore emulator, then in isolated staging with synthetic UIDs only.
7. Keep the browser unwired and all gates false until staging IAM, App Check, concurrency, redaction, rollback, and audit checks pass.

## Existing local-file disposition

### Reusable regardless of datastore

- `functions/src/domain/runtimePolicy.js`: explicit environment/project/region targeting; extend with authority database/service identifiers.
- `functions/src/index.js`: explicit region bootstrap only; the authority service must remain separate.
- `functions/test/common-callable.test.cjs` and `functions/test/safety-contract.test.cjs`: target and fail-closed checks.
- `functions/staging/e1DeploymentGuard.cjs`, `functions/scripts/check-e1-staging-target.cjs`, and `functions/test/e1-deployment-guard.test.cjs`: redacted local guard framework; adapt expected resources.
- `package.json` and `functions/package.json`: local test entry points only.

### RTDB-specific but useful evidence

- `docs/E1-LEAST-PRIVILEGE-RUNTIME-PROOF.md`: accepted proof and rejection rationale.
- `functions/src/domain/e1RuntimeAuthorization.js` and `functions/test/e1-runtime-authorization.test.cjs`: operation-scoped override evidence.
- `scripts/build-durable-auth-additive-rules.cjs` and `scripts/check-durable-auth-rules.sh`: reproducible RTDB candidate evidence.
- `tests/durable-auth-runtime-readiness.test.cjs`.
- `tests/firebase/database.rules.durable-auth.json`, `tests/firebase/durable-auth-rules.test.cjs`, and `tests/firebase/firebase.durable-auth.json`.

### Obsolete as deployable implementation if this decision is adopted

- `functions/src/adapters/firebaseDurableAuthAdapter.js`: do not wire or deploy; retain locally as the rejected RTDB implementation proof.
- The generated durable-auth RTDB Rules candidate is not a deployment candidate. Its files remain evidence until the architecture decision is reviewed and committed.

No proof file should be deleted during this decision milestone.

## Narrow-read 16/17 classification

This is a **stale emulator test/fixture pairing**, not an E.1 failure and not a current production regression.

`tests/firebase/narrow-read-rules.test.cjs` includes one future-path test expecting `shareDirectory`, `trainerShares`, `shareVisibility`, `shareAccess`, `userPreferences`, and `accounts`. Its configured Rules file, `database.rules.narrow-read.json`, is the intentional rollback/narrow-read baseline and contains none of those later additive roots. The roots exist in `database.rules.share-visibility.json`.

Therefore:

- the rollback fixture is not stale; its hash remains the accepted live baseline;
- the future-path assertion is stale for that fixture;
- no active production behavior regressed;
- the mismatch must be fixed in a separate test-maintenance change by running that assertion against the additive share-visibility fixture or removing it from the rollback suite;
- it must not alter the E.1 recommendation or its test counts.

## Staging acceptance checkpoint

The isolated staging implementation now uses:

- project `trainer-hub-staging-37ib4wct` (`391359988648`), with no production target;
- named Firestore Standard database `phase-e-identity` in `us-central1`, deletion protection enabled, PITR disabled, and deny-all client Rules;
- private Cloud Run service `e1-identity-authority` with dedicated runtime identity `e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com`;
- a database-resource conditional `roles/datastore.user` binding for that runtime identity and no RTDB IAM, static keys, token-creator grant, service-account-user grant, public Invoker, or ordinary-Functions Invoker;
- an exact-read, write-denied staging RTDB compatibility fixture whose runtime access uses each synthetic caller's Firebase token rather than authority IAM.

The five-operation image was deployed privately and exercised only with synthetic staging identities. Repair restored account-only and handle-only partial foundations; manifest application migrated one eligible identity, recognized one exact already-migrated identity without a revision bump, rejected changed replay and conflicting mappings, and froze one reviewed conflict without changing account ownership. Firestore transactions covered every multi-document mutation. Exact replay was idempotent, reused operation IDs with changed inputs were rejected, and repeated concurrency races produced one consistent winner with no partial state.

After acceptance, revision `e1-identity-authority-00019-lgm` serves the immutable image digest `sha256:3bdc76692636cec5d5c178e7aecfb9af53efa920a1f42a7ac501bac0a160da29` with:

```text
READ_ACCOUNT_FOUNDATION_ENABLED=true
RESERVE_HANDLE_ENABLED=false
REPAIR_FOUNDATION_ENABLED=false
APPLY_MIGRATION_ENABLED=false
FREEZE_CONFLICT_ENABLED=false
```

The retained synthetic authority state has 4 accounts, 4 handles, 6 operation requests, 4 migration-evidence records, and 1 frozen conflict event. It has no orphan account/handle, duplicate handle document, unexpected collection, or revision drift. The RTDB fixture remained unchanged during authority operations. Legacy login, exact username-keyed compatibility reads, and the current client boundary remained functional; browser Firestore access remained denied.

## Next review boundary

No further staging or production action is implied by this document. A separate production-activation review must resolve the residual named-database `roles/datastore.user` blast radius, define the production project/database/service identities and temporary deployer permissions, review synthetic-to-production migration selection, establish gateway/App Check and observability requirements, rehearse rollback, and approve each production resource or data operation explicitly. E.2, E.3, and E.4 remain excluded.

## Official references

- Firestore server libraries bypass Security Rules: https://firebase.google.com/docs/firestore/security/rules-conditions
- Firestore REST with Firebase ID tokens uses Security Rules: https://firebase.google.com/docs/firestore/use-rest-api
- Firestore IAM permissions and per-database conditions: https://cloud.google.com/firestore/docs/security/iam and https://cloud.google.com/firestore/docs/manage-databases
- Firestore transaction atomicity/retries: https://firebase.google.com/docs/firestore/manage-data/transactions
- Cloud Run service-to-service authentication: https://cloud.google.com/run/docs/authenticating/service-to-service
- Cloud Run service identity: https://cloud.google.com/run/docs/securing/service-identity
- RTDB IAM permission breadth: https://firebase.google.com/docs/projects/iam/permissions
- RTDB auth-variable override: https://firebase.google.com/docs/database/admin/start#authenticate-with-limited-privileges
- Firestore pricing: https://cloud.google.com/firestore/pricing
- Cloud Run pricing/scale-to-zero: https://cloud.google.com/run/pricing
