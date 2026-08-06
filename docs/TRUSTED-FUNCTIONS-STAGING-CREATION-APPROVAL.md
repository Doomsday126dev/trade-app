# Trusted Functions Staging Creation Approval

Status: **local approval package only; every decision is undecided**

This package records the choices and approvals required before creating an
isolated synthetic-only Firebase staging environment. It has no Firebase,
Google Cloud, IAM, billing, HTTP, credential, deployment, or mutation adapter.
It does not authorize resource creation. Complete an ignored copy of
`functions/staging/staging-creation.approval.example.json`; never put real
project, billing, identity, credential, alert-destination, or debug-token values
in source control.

## Required decisions

| Decision | Purpose, allowed format, and placeholder | Security and cost effect | Change/recreation |
| --- | --- | --- | --- |
| `STAGING_PROJECT_ID` | Dedicated project; Google project-ID syntax ending in `-staging` or containing `-staging-`; `<STAGING_PROJECT_ID>` | Must differ from the privately verified production project; all usage is billable to its linked account | ID is permanent; changing it requires a new project |
| `BILLING_ACCOUNT` | Billing account identifier selected privately; `<BILLING_ACCOUNT>` | Enables paid usage; attachment alone is not a hard cap | Relinkable with billing authority; resources remain |
| `RTDB_LOCATION` | Exactly `us-central1`, `europe-west1`, or `asia-southeast1`; `<RTDB_LOCATION>` | Controls latency, residency, and possible cross-region transfer | Immutable; changing it recreates the database |
| `FUNCTIONS_REGION` | Valid Gen 2 region colocated with RTDB; `<REGION>` | Cross-region calls add latency and may add transfer cost | Change requires Functions redeployment, not database recreation |
| `STAGING_WEB_APP_NAME` | Human-readable staging-only app label; `<STAGING_WEB_APP_NAME>` | Separates App Check and browser configuration from production | Replaceable by registering a new app; old registration must be removed |
| `APP_CHECK_PROVIDER` | Approved web provider identifier; `<APP_CHECK_PROVIDER>`; candidate is reCAPTCHA Enterprise | Assessments can become billable and token TTL affects volume | Provider/config can be replaced after a reviewed rollout |
| `RUNTIME_SERVICE_ACCOUNT` | Google service-account ID chosen privately; `<RUNTIME_SERVICE_ACCOUNT>` | Fixed adapters still receive instance-wide RTDB authority | Replaceable with Functions redeployment; revoke old identity afterward |
| `DEPLOYMENT_SERVICE_ACCOUNT` | Distinct Google service-account ID; `<DEPLOYMENT_SERVICE_ACCOUNT>` | Temporary deploy/impersonation authority | Replaceable; revoke permissions after each deployment window |
| `RULES_OPERATOR_IDENTITY` | Named human or dedicated release identity; `<RULES_OPERATOR_IDENTITY>` | Can replace reviewed staging rules | Replaceable; revoke after the rules window |
| `HUMAN_OPERATOR` | Named accountable operator in private approval; `<HUMAN_OPERATOR>` | Confirms targets, hashes, billing, and evidence | New operator requires a new recorded approval, no resource recreation |
| `BUDGET_AMOUNT` | Positive currency amount; `<BUDGET_AMOUNT>`; candidate USD 10/month | Advisory alerts only; billing continues after thresholds | Changeable without recreating resources |
| `BUDGET_ALERT_THRESHOLDS` | Ordered percentages/absolute amounts; `<BUDGET_ALERT_THRESHOLDS>`; candidate 25/50/75/90/100% and USD 1/3/5/10 | Detects unexpected spend; does not disable services | Changeable |
| `SYNTHETIC_FIXTURE_NAMESPACE` | Firebase-safe staging prefix with no production-derived material; `<SYNTHETIC_FIXTURE_NAMESPACE>` | Bounds validation and teardown | New namespace requires old teardown and fresh approval |

Every field and each approval in the example remain `undecided`. An approval
for one item does not imply any other approval.

## Location decision

Firebase documents three RTDB locations. The database location cannot be
changed after provisioning, so inspect the production database location
read-only in Firebase Console only to inform latency expectations; do not copy
data or configuration.

| RTDB choice | Colocated Functions choice | Tradeoff |
| --- | --- | --- |
| `us-central1` | `us-central1` | US data location and lowest transaction latency for a US RTDB |
| `europe-west1` | `europe-west1` | EU data location |
| `asia-southeast1` | `asia-southeast1` | Singapore data location |

The callable source currently declaring `us-east1` does not approve that
region. Keep `<REGION>` until RTDB location, latency, residency, and cost are
reviewed. Functions can later be redeployed; RTDB relocation requires database
recreation and controlled data movement.

## Pricing verification

Official pricing was reviewed on **2026-08-05**. Prices, allowances, billing
units, and product names can change, so re-open every source immediately before
resource creation and record the new verification date privately:

- Cloud Run/Functions Gen 2 compute and requests: https://cloud.google.com/run/pricing
- Firebase and RTDB allowances: https://firebase.google.com/pricing
- RTDB billing behavior: https://firebase.google.com/docs/database/usage/billing
- App Check web provider behavior: https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- reCAPTCHA assessments: https://docs.cloud.google.com/recaptcha/docs/billing-information
- Cloud Build: https://cloud.google.com/build/pricing
- Artifact Registry: https://cloud.google.com/artifact-registry/pricing
- Logging and Monitoring: https://cloud.google.com/products/observability/pricing
- Cloud Scheduler: https://cloud.google.com/scheduler/pricing
- Billing budgets: https://docs.cloud.google.com/billing/docs/how-to/budgets

At the verification date, the relevant published allowances included 2 million
Cloud Run requests, 180,000 vCPU-seconds, and 360,000 GiB-seconds monthly; RTDB
listed 1 GiB stored and 10 GiB downloaded monthly; reCAPTCHA listed 10,000
assessments monthly before its next tier; Cloud Build listed 2,500 build minutes
per billing account; Artifact Registry listed 0.5 GiB-month storage; and Logging
listed 50 GiB ingestion monthly. These are assumptions, not promises or a bill.

Resources that may retain cost while idle include Artifact Registry images,
extended log retention, retained RTDB data, and any manually created Scheduler
job. `minInstances: 0` avoids configured warm-instance compute but does not make
builds, storage, logs, network, App Check, or database use free. Project
creation and billing attachment do not themselves represent workload usage.
Budget alerts are advisory and do not cap spend.

## Workload model

These are **modeled sensitivity ranges, not expected bills**. User count alone
does not cause the modeled spend; operation frequency and failed safeguards do.
All calculations are editable constants in
`functions/staging/stagingCreationApproval.cjs`.

| Scenario | Handle / tag / history / viewer calls per MAU-month | Retry factor | Rate limiting | Deploys / retained images |
| --- | --- | ---: | --- | --- |
| guarded launch | `0.03 / 1 / 2 / 0.25` | 1x | active | 1 / 0.5 GiB |
| normal | `0.05 / 2 / 8 / 0.5` | 1x | active | 2 / 0.5 GiB |
| high | `0.1 / 10 / 60 / 3` | 1x | active | 8 / 1 GiB |
| bounded abuse | `90 / 3,000 / 9,000 / 1,500` | 1x | active at every per-UID daily ceiling for 30 days | 30 / 5 GiB |
| catastrophic | effective `900 / 30,000 / 90,000 / 15,000` | 10x | absent or bypassed | 30 / 5 GiB |

The bounded-abuse case assumes every MAU drives every operation at its daily
limit for an entire month. The catastrophic case adds a 10x runaway retry or
automation loop and assumes gates, per-UID rate limiting, and effective App
Check rejection have failed, been bypassed, or not yet been enabled. Those
figures warn about unbounded automation; they do not model ordinary usage.

Every row assumes one conservative App Check assessment per callable request,
although token reuse may reduce actual assessment count; one vCPU; 0.25 GiB
memory; durations of 250/180/200/350/180 ms for handle/tag/Favorite/history/viewer calls;
6/4, 4/4, 6/3, 8/4, and 7/3 RTDB reads/writes respectively; 2 KiB downloaded per
RTDB read; 1,600 structured-log bytes and 8 KiB egress per invocation; no
cleanup Scheduler job; `maxInstances: 5`; and concurrency 10. Dollar ranges
apply published free allowances and use `us-central1` Tier 1 only as a pricing
reference. Deployment region remains `<REGION>` and must be repriced after
selection.

| MAU | Activity | Calls | vCPU-s | GiB-s | RTDB reads / writes / MiB downloaded | App Check | Logs MiB | Egress MiB |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | normal | 1,255 | 367 | 92 | 8,780 / 4,770 / 18 | 1,255 | 2 | 10 |
| 100 | high | 8,810 | 2,637 | 660 | 63,160 / 33,440 / 124 | 8,810 | 14 | 69 |
| 100 | bounded abuse | 1,959,000 | 518,250 | 129,563 | 13,104,000 / 7,086,000 / 25,594 | 1,959,000 | 2,990 | 15,305 |
| 1,000 | normal | 12,550 | 3,663 | 916 | 87,800 / 47,700 / 172 | 12,550 | 20 | 99 |
| 1,000 | high | 88,100 | 26,365 | 6,592 | 631,600 / 334,400 / 1,234 | 88,100 | 135 | 689 |
| 1,000 | bounded abuse | 19,590,000 | 5,182,500 | 1,295,625 | 131,040,000 / 70,860,000 / 255,938 | 19,590,000 | 29,892 | 153,047 |
| 10,000 | normal | 125,500 | 36,625 | 9,157 | 878,000 / 477,000 / 1,715 | 125,500 | 192 | 981 |
| 10,000 | high | 881,000 | 263,650 | 65,913 | 6,316,000 / 3,344,000 / 12,336 | 881,000 | 1,345 | 6,883 |
| 10,000 | bounded abuse | 195,900,000 | 51,825,000 | 12,956,250 | 1,310,400,000 / 708,600,000 / 2,559,375 | 195,900,000 | 298,920 | 1,530,469 |

`verifyTrainerHistory` dominates normal/high compute and database work. Under
abuse, App Check assessments, compute, RTDB traffic, logs, and egress can all
become material. The rate-limit design, disabled gates, App Check, `maxInstances:
5`, mutation-root alerts, and synthetic-only staging are mandatory controls.
Revisit monetization only as a product decision after measured usage; payment
must never become identity or authorization evidence.

Approximate monthly sensitivity ranges below apply the published allowances and
reCAPTCHA tiers reviewed above, then add a buffer for region-dependent compute,
network, RTDB download, build, artifact, and logging behavior. They are planning
ranges, not quotes:

| MAU | Guarded | Normal | High | Bounded abuse | Catastrophic safeguards-disabled |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | USD 0-3 | USD 0-5 | USD 0-5 | USD 1,200-1,500 | USD 13,500-15,000 |
| 1,000 | USD 0-5 | USD 8-20 | USD 8-25 | USD 13,500-15,000 | USD 136,000-150,000 |
| 10,000 | USD 8-20 | USD 15-35 | USD 640-750 | USD 136,000-150,000 | USD 1.36-1.50 million |

The guarded launch assumes write gates enabled only for tested operations,
active per-UID limits, no passive page-load or login calls, no polling, no
scheduled cleanup, unchanged-history short-circuiting, `maxInstances: 5`,
bounded logs, one monthly deployment, 0.5 GiB retained images with cleanup, and
billing alerts. Its raw monthly calls are 428, 4,280, and 42,800 at 100, 1,000,
and 10,000 MAU respectively.

### Why normal 1,000 MAU is USD 8-20

The model produces 12,550 calls: 50 handle, 2,000 tag, 2,000 Favorite, 8,000
history, and 500 viewer operations. Conservatively assigning one reCAPTCHA/App
Check assessment to every request puts it 2,550 assessments above the current 10,000 allowance.
At the pricing verified above, the 10,001-100,000 assessment tier contributes
approximately USD 8. If real token reuse causes fewer assessments, this portion
may remain within allowance.

| Service | Modeled contribution |
| --- | --- |
| reCAPTCHA/App Check | About USD 8 under the conservative assessment assumption |
| Cloud Run requests/CPU/memory | USD 0: 12,550 requests, 3,663 vCPU-s, and 916 GiB-s remain below cited allowances |
| RTDB | USD 0: about 172 MiB downloaded remains below the cited 10 GiB allowance; no incremental stored-data charge modeled |
| Logging | USD 0: about 20 MiB remains below the cited ingestion allowance |
| Cloud Build | USD 0: two modeled deployments remain far below the cited build-minute allowance |
| Artifact Registry | USD 0 when its 0.5 GiB allowance is available; retained/shared-account usage can change this |
| Egress/region/rounding buffer | USD 0-12 because `<REGION>`, routing, token reuse, shared allowances, and retained artifacts are unresolved |

The range therefore is not a generic “Firebase” charge: approximately USD 8 is
the conservative App Check tier and USD 0-12 is an explicit uncertainty buffer.

App Check is likely the first meaningful charge and the first allowance crossed;
history verification is the main normal/high compute driver. Excess logs can
cross Logging allowances, repeated deployments consume Build minutes, stale
images retain Artifact Registry storage, and retries multiply every component.
Measure by operation code only, without identity or content. Revisit the free
product/future fair-freemium model when measured MAU, operation volume,
infrastructure spend, retention, and evidence of demand for advanced features
all justify it. Registered-user count alone is insufficient. The free core,
privacy, and basic visibility remain useful and unpaywalled; payment never grants
private access or causes an otherwise unnecessary backend call.

## IAM approval matrix

| Identity | Exact candidate roles and reason | Danger / narrower role | Duration and revocation |
| --- | --- | --- | --- |
| Runtime | `roles/firebasedatabase.admin` for transactions, `roles/firebaseappcheck.tokenVerifier` for consumed tokens, `roles/logging.logWriter` for redacted events | RTDB Admin is instance-wide, not path-level least privilege; a custom role cannot constrain RTDB data paths | Runtime only; disable/delete Functions, then revoke roles and account |
| Deployment | `roles/cloudfunctions.developer` to deploy, scoped `roles/iam.serviceAccountUser` to attach runtime identity, `roles/serviceusage.serviceUsageConsumer` for enabled APIs | Can replace/delete Functions and impersonate the scoped runtime account; narrower resource-scoped/custom grants are realistic and required where supported | Deployment window only; revoke immediately afterward |
| Rules operator | reviewed custom rules-release publisher for one atomic rules replacement | Can replace database rules; a narrow custom release role is realistic | Single rules window; revoke after hash verification |
| Human reviewer | `roles/cloudfunctions.viewer`, `roles/logging.viewer`, `roles/monitoring.viewer` for evidence | Can view operational metadata/logs; custom log view can narrow exposure | Review period only; remove when no longer required |

The runtime identity cannot deploy, manage IAM, administer Auth users, or
publish rules. A custom RTDB role cannot provide true path-level restriction;
the compensating controls are an isolated staging database, fixed adapters,
disabled gates, App Check, rules, bounded schemas, mutation-root monitoring,
and immediate teardown.

## App Check approval

The staging web/PWA recommendation is a separate reCAPTCHA Enterprise-backed
App Check registration. Before registration, decide the staging web app, Google
Cloud configuration, site/domain allowlist, token TTL, limited-use token
consumption, and assessment billing tier. Test Chrome, Safari, and installed-PWA
token acquisition/refresh separately.

Debug tokens remain ignored, staging-only, privately assigned to named test
devices, absent from logs/docs/chat, and revoked after testing. Begin with both
write gates false and metrics-only observation. Exercise valid, missing, invalid,
expired, refreshed, and consumed tokens. An enforcement approval requires zero
unexplained false rejections across the browser/PWA matrix and healthy aggregate
denial/latency metrics. If valid clients fail, restore gates false and disable
staging enforcement while diagnosing. App Check supplements Auth, authorization,
rules, schemas, idempotency, and rate limits; it replaces none of them.

## Rules and fixtures

Rules prerequisite:

- Live narrow-read baseline: `e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf`
- Additive disabled candidate: `ba7322a59a4c3cf6b503dc52b1394313ac9421106a6c05fc6835200d49e3e72d`
- Reconfirm the visibility emulator matrix: 45 passed, 0 failed.

Deploy the additive rules to staging before Functions, with both write gates
false. Verify anonymous/ordinary/admin reads, root denial, disabled future
paths, non-enumerability, and rollback SHA. Functions must reject disabled
operations before acquiring idempotency records.

Resource creation and staging deployment readiness are distinct from preference
sync activation readiness. The local narrow Favorite callable now enforces the
strict 100-active-record limit, but its deployment, synthetic canary, and gate
activation still require separate approvals.

Fixtures use only `<SYNTHETIC_FIXTURE_NAMESPACE>`, deterministic fake identities,
`example.invalid` addresses, and synthetic list data. No production export,
count, timestamp, name, UID, hash, report, or share content is permitted. Fixture
creation is a separate approval after project and rules verification.

## Production-target prevention

1. Store the exact production project ID only in ignored local configuration.
2. Compare `<STAGING_PROJECT_ID>` against it before any future operation; exact
   equality is a hard stop.
3. Require `-staging` in the project ID and require the named operator to verify
   the Console project header, project number, RTDB instance, and billing link.
4. Run only project-qualified commands from the approved commit. Never create a
   `.firebaserc` alias and never rely on a CLI default project.
5. Verify both write gates false before rules, Functions, fixture, or canary work.
6. Stop on an unresolved placeholder, unexpected resource, production-derived
   fixture, hash mismatch, IAM drift, or billing mismatch.

Review-only command shapes (do not run from this package):

```sh
firebase projects:list
firebase use --clear
firebase deploy --only database --project <STAGING_PROJECT_ID>
firebase deploy --only functions --project <STAGING_PROJECT_ID>
```

Actual commands require a separate reviewed operator runbook. This repository
contains no deploy script, project alias, credential, or operation adapter.

## Billing kill switch

Alerts at 25%, 50%, 75%, 90%, 100%, and small absolute-dollar thresholds notify
operators but do not stop charges. The manual response order is:

1. Set both server write gates false.
2. Disable every staging client invocation path.
3. Disable or delete the five staging Functions.
4. Disable App Check enforcement if it blocks diagnosis.
5. Stop scheduled resources if any were separately created.
6. Inspect and prune Artifact Registry storage.
7. Inspect Cloud Logging volume and retention.
8. Inspect RTDB storage/download/connection traffic.
9. Tear down synthetic resources when containment is insufficient.

Disabling gates does not stop builds, storage, logging, database reads, retained
images, or scheduled work. No automated billing-triggered shutdown is included.

## Teardown

| Category | Action | Immediate? | Retained billing/log data and verification |
| --- | --- | --- | --- |
| Functions | Disable gates, delete five staging Functions | Invocation stop is prompt; deletion is asynchronous | Images/logs may remain; verify no callable endpoint |
| RTDB synthetic data | Delete only approved fixture roots | Data deletion is prompt | Usage records remain; verify namespace absent and unrelated data untouched |
| Auth synthetic users | Delete only fixture UIDs | Prompt | Audit records may remain; verify fixture Auth count zero |
| App Check registration and debug tokens | Revoke tokens and unregister staging app/provider | Revocation is prompt | Historical metrics may remain; verify no active token/provider |
| Service accounts | Disable, delete keys, then delete accounts | Disable first; deletion may propagate | Audit logs remain; verify accounts/keys absent |
| IAM bindings | Remove deployment, runtime, rules, and reviewer grants | Propagation is not instantaneous | Audit logs remain; verify policy diff matches preflight |
| Artifact Registry images | Delete images/repository if dedicated | Deletion is asynchronous | Storage charges can continue until deletion; verify zero staging images |
| Cloud Build artifacts | Delete retained staging build artifacts | Varies by backing storage | Build history may remain; verify no billable staging artifact |
| Logs and log sinks | Remove custom sinks; retain only approved incident evidence | New routing stops after propagation | Existing retention can cost; verify no sink/extended retention |
| Monitoring dashboards and alerts | Delete staging policies and dashboards | Prompt | Metric history may remain; verify no staging policy |
| Budgets | Delete staging budget/notifications | Prompt | Billing history remains; verify budget absent |
| Staging web app | Remove App Check, then app registration | Prompt | Does not delete project data; verify app absent |
| Firebase project | Delete only after all evidence/resource checks | Has a recovery window | Some billing/audit records remain; record deletion state |
| Linked billing account | Unlink after teardown if policy permits | Prompt after authorization | Prior charges remain payable; verify no staging linkage |

Teardown stops immediately on a target mismatch or any non-synthetic record.
Some retained artifacts can outlive Functions, so deletion verification is part
of completion rather than an optional cleanup.

## Approval checklist

All 22 items begin `undecided`: project creation, billing attachment, RTDB
location, Functions region, web app registration, App Check provider, runtime
identity, deployment identity, IAM roles, rules operator, human operator, budget,
alert thresholds, fixture namespace, additive rules SHA, rollback rules SHA,
Functions deployment, fixture creation, each write gate, canary execution, and
retention cleanup.

Operator order after future approvals:

1. Reverify official pricing and record the date.
2. Complete all decisions and name the human operator.
3. Approve project and billing separately; create only the isolated project.
4. Choose the immutable RTDB location, then choose the colocated Functions region.
5. Register the staging web app and App Check provider with gates false.
6. Create separate identities and assign only approved, time-bounded roles.
7. Verify both rule hashes and deploy additive staging rules with gates false.
8. Re-run 45/45 rules tests and disabled-path canaries.
9. Deploy five Functions with gates false and verify disabled responses create no idempotency rows.
10. Create deterministic synthetic fixtures only after a separate approval.
11. Enable one gate for one bounded canary group, restore false, and review evidence.
12. Tear down using the full checklist or seek a new approval for retained staging.

No step authorizes production use, production-derived fixtures, client wiring,
cohort selection, identity repair, seeding, or simultaneous gate activation.
