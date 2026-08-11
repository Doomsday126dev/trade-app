# E.1 Production Hardening Contract

This document describes the production-shaped E.1 candidate. It does not authorize or perform cloud changes. The tracked production resource manifest deliberately leaves the production project number unreviewed, so the production guard cannot pass until a separate read-only review records the authoritative value.

## Explicit targets

The authority accepts only `staging`, `production`, or `emulator`. Every environment must supply `APP_ENVIRONMENT`, `FIREBASE_PROJECT_ID`, `EXPECTED_PROJECT_NUMBER`, `FIRESTORE_DATABASE_ID`, `RTDB_DATABASE_URL`, `SERVICE_REGION`, the service name, and the expected runtime identity. Staging remains pinned to the accepted isolated project. Production is pinned to `trade-list-a4297`, `phase-e-identity`, `us-central1`, and the production compatibility RTDB URL. Emulator mode requires a `demo-` project and a loopback RTDB endpoint. No target inherits another environment's values.

The production deployment guard additionally requires a private reviewed readiness file, a reviewed project number, workload identity rather than a credential file, private Cloud Run, only the gateway Invoker, no default Compute Editor grant, the exact custom-role permissions, the named-database IAM condition, and every activation gate false.

## Readiness

`/ready` verifies the runtime service-account email and numeric project ID, reads named-database metadata, and performs one exact GET of `runtimeReadiness/e1-authority-sentinel`. A missing sentinel is success. A present sentinel is also readable without affecting readiness. The probe never creates a document and never lists collections or queries data. The forbidden-permission probe explicitly includes `datastore.entities.list` and `datastore.entities.delete`.

## Firestore permissions

The proposed custom role contains exactly:

- `datastore.databases.get`
- `datastore.databases.getMetadata`
- `datastore.entities.get`
- `datastore.entities.create`
- `datastore.entities.update`

Readiness needs database get/metadata and one exact entity get. Every operation needs entity get plus create/update because its durable limiter maintains one rolling document. Reserve, repair, migration, and freeze then use the same permissions for bounded transactional evidence. `datastore.entities.update` is therefore concretely required; list and delete are not. No operation needs database administration, IAM, Rules, RTDB IAM, or Cloud Run administration.

## Durable rate limits

Rate limits are Firestore transactions, never process memory. Each operation and HMAC-keyed subject hash has one rolling `rateLimits/{operation}_{subjectHash}` document. It contains only the operation, truncated keyed subject hash, current fixed-window boundaries, a bounded array of attempt hashes, count, and expiry metadata. A new window replaces the old attempts in the same document, so requests do not create unbounded per-attempt documents. `expiresAt` is ready for a later reviewed TTL policy; correctness does not depend on TTL.

| Operation | Subject | Limit | Window | Replay behavior |
| --- | --- | ---: | --- | --- |
| readAccountFoundation | UID hash | 60 | 15 minutes | every read is an attempt |
| reserveTrainerHandle | UID hash | 5 | 15 minutes | identical request/fingerprint reuses its attempt hash and consumes no additional quota |
| repairAccountFoundation | UID hash | 3 | 24 hours | identical reviewed operation is quota-idempotent |
| applyMigrationManifest | operator hash | 10 | 1 minute | identical reviewed operation is quota-idempotent |
| freezeIdentityConflict | operator hash | 10 | 1 minute | one effective operation ID and quota-idempotent replay |

Repair also requires the configured approved time window. Migration additionally requires its manifest ID in the configured approved cohort. Limiter documents contain no raw UID, email, IP, token, trainer name, or request body.

## Repair authentication

Repair now uses the existing pinned operator verifier plus a separate subject Firebase ID token. The reviewed reference and live reciprocal legacy fingerprint remain mandatory. Subject-only, operator-only, wrong-operator, and out-of-window requests fail before mutation. The ordinary user gateway does not export repair.

## Gateway and App Check

The separate `functions/e1-gateway` codebase exports only `readE1AccountFoundation` and `reserveE1TrainerHandle`. Firebase callable verification supplies Firebase Auth and App Check. Reserve consumes a limited-use App Check token and rejects `alreadyConsumed`; reads require a regular valid App Check token. Production configuration rejects debug-token mode.

The gateway obtains a Google OIDC ID token from attached workload identity and sends it as `X-Serverless-Authorization` to private Cloud Run. The subject Firebase token is forwarded separately for re-verification. The future gateway identity receives only `roles/run.invoker` on the authority service: no Firestore, RTDB, token-creator, service-account-user, static-key, or authority-runtime impersonation permission. Persistent rate limiting remains enforced by the authority transaction boundary and a 429 is mapped to the callable resource-exhausted response.

## Production resources and PITR

The machine-readable manifest describes the APIs, named Firestore database, deny-all Rules, identities, custom role, conditional binding, private authority, gateway, Invoker, App Check, metrics, alerts, budget, gates, expected Google-managed service agents, and automatic default-Compute-Editor remediation. It creates nothing.

Production PITR remains recommended and is set to `ENABLED` in the manifest. Up to seven days of identity recovery history is worth the small storage cost for this low-volume authority database. Staging can remain without PITR.

## Rollback and cohorts

Rollback disables client foundation use, gateway invocation, reserve, repair, migration, and freeze; reads may remain enabled or be disabled separately. Emergency containment removes only the gateway's authority-service Invoker binding. Legacy username/PIN remains available and authority records are not deleted.

Rollout remains owner only with 24 hours observation, then two known-clean accounts with 48 hours observation, then at most five additional eligible accounts. Advancement requires zero conflicts, zero legacy regression, exact source fingerprints, clean logs, and a proven rollback. No production candidate classification is performed by this work.
