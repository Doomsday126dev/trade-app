# Trusted Functions Staging Decision Summary

Status: proposal-only, non-operational, and local candidate.

This document records selected proposed values from the three conversational
decision groups. It does not record formal execution approval. Every
`approvalStatus` remains `undecided`; every `approvedBy` and `approvedAt` value
remains empty. No proposal triggers an operation.

## Foundation

- Project pattern: `<APP_SLUG>-staging-<RANDOM_SUFFIX>`.
- Billing: the future production billing account, with an isolated staging
  project, labels, budget, and alerts. Its identifier stays private.
- RTDB location: proposed `us-central1`.
- Functions region: proposed `us-central1` for all four callables.
- Existing `us-east1` callable declarations are unapproved technical debt.
  Parameterization requires a separate reviewed implementation.

## Staging Client And App Check

- Use one dedicated staging Firebase web app.
- A first local canary is permitted only with ignored configuration, separate
  storage, production-target rejection, synthetic data, and operator-only use.
- Provider: proposed `recaptcha-enterprise`.
- Rollout: metrics first with the default TTL initially, at least 100 synthetic
  calls, at least 99% legitimate acceptance, and zero unexplained legitimate
  client rejection. Enforcement requires separate approval.
- Debug tokens stay staging-only, revocable, ignored, and absent from tracked
  files, logs, screenshots, chat, and documentation.

## Identities And IAM

- Use one dedicated staging runtime identity for the four callables.
- Use a separate deployment identity through short-lived impersonation. Do not
  generate downloadable service-account keys.
- The same named human may initially perform separately recorded reviewer and
  operator steps. This is a two-step solo process, not independent review.

Proposed runtime roles:

- `roles/firebasedatabase.admin`
- `roles/firebaseappcheck.tokenVerifier`
- `roles/logging.logWriter`

Proposed deployment roles:

- `roles/cloudfunctions.developer`
- `roles/serviceusage.serviceUsageConsumer`

Temporary operator grants:

- `roles/iam.serviceAccountTokenCreator` on the deployment identity.
- `roles/iam.serviceAccountUser` on the specific runtime identity.
- `roles/firebasedatabase.admin` for atomic rules publication, smoke, and
  rollback only.

The reviewer has no mutation role. RTDB Admin is broad, instance-wide, and not
path-level least privilege. Admin SDK access bypasses RTDB Security Rules, so
the isolated project, synthetic-only data, fixed adapters, disabled gates,
strict contracts, tests, rate limits, redacted logs, and mutation-root
monitoring remain mandatory.

## Budget And Alerts

- `BUDGET_AMOUNT=USD 10/month`.
- `MANUAL_INVESTIGATION_THRESHOLD=USD 3-5/month`.
- Actual alerts: USD 1, 2.50, 3, 5, 7.50, 9, and 10.
- Forecast alerts: 50%, 75%, and 100%.
- Alert recipients remain private placeholders.

Budgets and alerts are advisory and are not hard caps. Current official pricing
must be reverified immediately before resource creation. Preview spend caps are
outside the initial design.

## Synthetic Fixtures

Functional fixtures use production-like candidate roots with unmistakably
synthetic identities:

- `accounts/{syntheticUid}`
- `shareVisibility/{syntheticUid}`
- `trainerShares/{syntheticUid}`
- `userPreferences/{syntheticUid}`

`stagingFixtureRuns/{fixtureRunId}` records exact fixture ownership,
fingerprints, and teardown status. No production-derived value, wildcard
teardown, collection-wide deletion, or deletion of changed or unknown records
is permitted.

## Rules Artifacts

Preferred narrow-read rollback:

`e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf`

Additive visibility/preferences candidate:

`cbcea2a672e1f9b1d6a4582410bb89bca765ca307c0495c7cc80ea35f805071c`

These hashes are proposed values only. Future publication requires immediate
hash recomputation, staging-target verification, confirmation that both write
gates are false, complete-file atomic replacement, smoke testing, and a ready
complete-file rollback. Fragment merging and live-editor improvisation are
forbidden.

## Unresolved Private Values

The app slug, random suffix, staging project ID, billing account and operator,
web-app name, runtime and deployment account names, human identities, alert
recipients, fixture identity formats, fixture-run format, record cap, retention
period, root allowlist, approval window, and rollback window remain unresolved
placeholders. None may be inferred or invented from production information.

Immediately before resource creation, privately resolve those values, verify
the target cannot be mistaken for production, reverify pricing and Gen 2 IAM,
recompute both rules hashes, confirm both client flags and server gates are
false, and record the operator, preflight, smoke, stopping, and rollback plans.

## Resource-Creation Boundary

`RESOURCE_CREATION_APPROVAL=undecided`

A future explicit resource-creation approval may create the isolated project,
attach the private billing account, apply labels, create RTDB in `us-central1`,
register one web app, create the two service accounts, assign separately
approved IAM, create the USD 10 budget and alerts, prepare ignored local
configuration, verify the inventory, and stop.

It does not authorize rules or Functions deployment, App Check registration or
enforcement, fixtures, either write gate, canaries, client wiring, cohort
selection, preference migration, Approved Viewer grants, or production action.

## Separate Approvals

The following 11 approvals remain independently required:

1. Staging resource creation.
2. Additive staging-rules deployment.
3. Functions staging deployment.
4. App Check registration.
5. Synthetic fixture creation.
6. Share-visibility write-gate enablement.
7. Trainer-preferences write-gate enablement.
8. Synthetic canary execution.
9. App Check enforcement.
10. Staging client wiring.
11. Any production action.

Each future approval must define the exact target, permitted resources or
mutations, artifact hashes, operator, approval-window duration, preflight,
smoke, stopping criteria, and rollback.

## Current Safety State

- `SHARE_VISIBILITY_MODEL_ENABLED=false`.
- `SYNCED_TRAINER_PREFERENCES_ENABLED=false`.
- Both server write gates remain false or absent.
- Private review: `confirmed_valid_identity: 3`, `unreviewed: 49`, and
  `seedEligibleTrueCount: 0`.
- No cohort is selected.
- No staging or production read or write is performed by this package.
