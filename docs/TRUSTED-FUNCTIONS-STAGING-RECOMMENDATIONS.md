# Trusted Functions Staging Recommendations

Status: **recommendation only; every approval and tracked value remains undecided**

This package helps an operator complete the separate staging-creation approval
sheet. It cannot create, configure, read, write, deploy, approve, or delete a
cloud resource. It does not change
`functions/staging/staging-creation.approval.example.json`; all 13 decision
values remain placeholders and all 22 approvals remain `undecided`.

## Recommended posture

Begin with `minInstances: 0`, `maxInstances: 5`, concurrency 10, and a
30-second timeout. Permit no passive page-load calls, login calls, polling, or
scheduled cleanup. Use synthetic canaries only, bounded structured logs, short
staging sessions, and Artifact Registry cleanup. Keep both server gates false
except for one explicitly approved canary window. Per-UID and per-operation
limits, App Check, idempotency, and the immediate gate-off kill switch must be
working before any later production approval.

`maxInstances: 5` limits simultaneous scale to at most 50 configured concurrent
requests at concurrency 10; it does **not** impose a hard monthly bill. A queue,
retries, repeated requests, storage, builds, logs, App Check assessments, and
database traffic can continue accumulating over time. Gates and rate limits
bound operation volume more directly than the instance cap.

## Decision recommendations

### 1. Staging project ID

- **Recommend:** `<APP_SLUG>-staging-<RANDOM_SUFFIX>` using lowercase Firebase/GCP
  project-ID syntax and a non-personal random suffix.
- **Alternative:** `<APP_SLUG>-sandbox-<RANDOM_SUFFIX>` if the organization
  reserves the word staging, with an equally conspicuous staging-only label.
- **Why:** the marker is visually obvious and the suffix reduces global naming
  collisions. Randomness does not authorize a target or replace the ignored
  production-target comparison.
- **Cost/security/complexity:** project creation alone is not workload spend;
  retained resources can be billable. Reject equality or visual confusion with
  the privately verified production project and require project-qualified
  operations. Complexity is low once the check is automated.
- **Reversibility:** a project ID is permanent; changing it requires a new
  project.
- **Still needed:** final app slug, suffix, ignored production target, and named
  operator verification. No production ID belongs in the tracked sheet.

### 2. Billing account

- **Recommend:** use the future production billing account with a separate
  staging budget when that is the only or simplest managed account.
- **Alternative:** a separate billing account when the organization already has
  the people and process to operate it; this provides stronger accounting
  isolation.
- **Why:** Gen 2 Functions and supporting services can require a billing-linked
  project even when measured use remains inside allowances. Linking enables
  billable APIs and usage beyond allowances; it is not itself a hard cap.
- **Cost/security/complexity:** compute, requests, App Check assessments, RTDB
  traffic/storage, builds, artifacts, logs, and egress are usage-driven. Retained
  artifacts can cost while no function is running. Shared billing is simpler;
  separate billing is stronger isolation with more administration. Budget
  alerts are advisory and do not stop charges.
- **Reversibility:** an authorized operator can relink or detach billing, but
  charges already incurred and resources already retained remain.
- **Still needed:** private account selection, organizational policy, current
  pricing, notification route, and a time-bounded billing operator. Only that
  operator may attach or detach billing.

### 3. RTDB location

- **Recommend:** `us-central1` as an undecided default recommendation because
  the current likely users are primarily US-based.
- **Alternative:** `europe-west1` for EU residency/geography or
  `asia-southeast1` for Singapore/Asia-Pacific geography.
- **Why:** colocating Functions and RTDB minimizes transaction latency,
  cross-region traffic, and operational variation. Do not assume production's
  location; inspect it read-only before approval only as a latency reference.
- **Cost/security/complexity:** US users will generally see lower latency in
  `us-central1`; Europe or Asia may require their corresponding locations for
  geography or residency. Global growth should be measured rather than guessed.
  Regional prices and egress must be rechecked.
- **Reversibility:** RTDB location is immutable. A late change requires database
  recreation and controlled data movement, making it the most expensive field
  to change after creation.
- **Still needed:** verified primary geography, residency policy, observed
  production location, latency targets, and current regional pricing.

### 4. Functions region

- **Recommend:** keep `FUNCTIONS_REGION=<REGION>` tracked, then resolve it to the
  approved RTDB-colocated Gen 2 region. Initially run all five callables in one
  region.
- **Alternative:** a nearby supported Gen 2 region only if exact colocation is
  unavailable and its latency/transfer impact is approved.
- **Why:** one region is easier to deploy, monitor, disable, and roll back at
  this scale.
- **Cost/security/complexity:** colocation avoids unnecessary cross-region
  transfer. The current callable declaration's `us-east1` is not approval; it
  must be parameterized before staging. Deployment must fail if `<REGION>` is
  unresolved or disagrees with the approved sheet.
- **Reversibility:** Functions can be redeployed, but endpoints, clients, logs,
  and old regional resources require explicit migration and cleanup.
- **Still needed:** RTDB decision, Node 22 Gen 2 support, pricing, source
  parameterization, and a target guard.

### 5. Staging web app

- **Recommend:** one dedicated staging Firebase web app with separate App Check
  registration, ignored local configuration, synthetic data only, and a clear
  staging banner if a browser is later wired.
- **Alternative:** run existing client code locally against an ignored staging
  config for the first canary, without a hosted staging deployment.
- **Why:** a dedicated registration separates App Check and config from
  production. Separate hosting is useful only when browser/PWA testing requires
  a stable origin.
- **Cost/security/complexity:** registration is usually usage-neutral; hosting,
  assessments, and traffic are usage-driven. Never copy production config into
  tracked files. Local-only testing is simpler; hosting adds release/cache/domain
  work.
- **Reversibility:** remove App Check first, then remove the app registration and
  any dedicated hosting resources.
- **Still needed:** private app name, approved origins/domain, local-versus-hosted
  decision, and App Check plan. No client wiring occurs in this package.

### 6. App Check provider

- **Recommend:** reCAPTCHA Enterprise, metrics-first, with enforcement
  unconfigured and both write gates false.
- **Alternative:** leave App Check unconfigured until the synthetic callable
  canary is otherwise ready.
- **Why:** Enterprise fits browser and PWA clients and provides assessment
  metrics; App Check complements rather than replaces Auth, authorization,
  rules, schemas, idempotency, or rate limits.
- **Cost/security/complexity:** the model conservatively assumes one assessment
  per request, although token reuse can reduce assessments. Debug tokens remain
  ignored, staging-only, privately assigned, and revoked after use. False
  rejection is the main rollout risk.
- **Reversibility:** with gates false, disable enforcement and revoke debug
  tokens without exposing a mutation path; unregister during teardown.
- **Still needed:** app/origins, TTL, current assessment tiers, debug-token
  custodian, and evidence from Chrome, Safari, and installed PWA.

Before enforcement, require at least 120 accepted synthetic invocations, at
least 10 valid calls per callable in each applicable browser/PWA environment,
an accepted-token rate of at least 99%, and zero unexplained rejections. Exercise
valid, missing, invalid, expired, refreshed, and consumed-token behavior. Any
valid-client rejection returns enforcement to off while gates remain false.

### 7. Runtime service account

- **Recommend:** `<APP_SLUG>-trusted-runtime-staging`, unique to these five fixed
  callables.
- **Alternative:** one runtime identity per callable after adapters or trust
  boundaries materially diverge.
- **Why:** all five currently use the same bounded mutation roots and controls;
  five service accounts add operational burden without meaningful path-level
  isolation because RTDB IAM is instance-wide.
- **Permissions/danger:** runtime-only
  `roles/firebasedatabase.admin`, `roles/firebaseappcheck.tokenVerifier`, and
  `roles/logging.logWriter`. RTDB Admin is broad and cannot express path-level
  least privilege. The account must not deploy Functions, manage IAM, administer
  Auth, or publish rules.
- **Compensating controls:** isolated staging, fixed adapters, disabled gates,
  App Check, rules, strict schemas, idempotency/rate limits, mutation-root
  monitoring, and teardown.
- **Cost/complexity/reversibility:** no direct identity fee, but its activity can
  incur service usage. Redeploy onto a replacement identity, then disable and
  remove the old account and bindings.
- **Still needed:** private name, final role review, monitoring, and removal owner.

### 8. Deployment service account

- **Recommend:** `<APP_SLUG>-trusted-deployer-staging` with grants only during an
  approved deployment window.
- **Alternative:** a named human deployer with the same time-bounded grants.
- **Why:** deploy authority stays separate from runtime authority and is
  independently auditable/revocable.
- **Permissions/danger:** `roles/cloudfunctions.developer`, resource-scoped
  `roles/iam.serviceAccountUser` for only the runtime account, and
  `roles/serviceusage.serviceUsageConsumer`. It can change Functions and act as
  the runtime identity during the window.
- **Cost/complexity/reversibility:** deployments may incur build/artifact use;
  IAM handling is medium complexity. Revoke all grants immediately afterward.
- **Still needed:** deployment mechanism, resource scopes, duration, approver,
  and revocation evidence. A custom role is worth evaluating for narrower deploy
  permissions where supported.

### 9. Rules operator identity

- **Recommend:** `<RULES_RELEASE_OPERATOR>`, a named human using a reviewed
  custom rules-release role for one atomic staging release.
- **Alternative:** a dedicated release service account if repeated staging
  releases later justify automation.
- **Why:** rules publication stays separate from Function deployment and runtime
  authority.
- **Permissions/danger:** can replace staging database rules and nothing else;
  an incorrect release can expose or deny data. Require candidate and rollback
  hashes plus post-publish verification.
- **Cost/complexity/reversibility:** no direct fee; a named one-time operator is
  simpler now. Remove the grant after verification and publish the reviewed
  rollback artifact on a stop condition.
- **Still needed:** private operator, exact custom permissions, release window,
  hash verifier, and rollback owner.

### 10. Human operator

- **Recommend:** `<NAMED_HUMAN_OPERATOR>` recorded privately, with a separate
  reviewer for rules, IAM, billing, and canary evidence when available.
- **Alternative:** one named operator for low-risk staging creation, provided
  every high-risk step retains a separate explicit approval.
- **Why:** someone must own target confirmation, pricing, gates, evidence,
  incident response, and teardown.
- **Permissions/danger:** time-bounded viewer roles only:
  `roles/cloudfunctions.viewer`, `roles/logging.viewer`, and
  `roles/monitoring.viewer`; logs remain redacted.
- **Cost/complexity/reversibility:** no direct fee. Two-person review is more
  operational work but preferable before production. Remove viewer grants when
  the review ends.
- **Still needed:** private name, availability, backup reviewer, and incident
  contact route. No personal destination is tracked.

### 11. Budget amount

- **Recommend:** USD 10/month with an operator stop/investigation threshold at
  USD 3-5.
- **Alternatives:** USD 5 for one very short canary cycle; USD 25 only after
  repeated measured staging use justifies it.
- **Why:** USD 10 accommodates tiny synthetic deployment/canary noise while
  making unexpected single-digit spend visible. USD 5 is tighter but can be
  noisy; USD 25 delays detection at this scale.
- **Cost/security/complexity:** ordinary synthetic use should remain near current
  allowances. Unexpected retained artifacts, repeated invocations, or assessment
  traffic should trigger gates off and investigation. A budget is advisory and
  is not a hard spending cap.
- **Reversibility:** amount can change without resource recreation.
- **Still needed:** billing currency, repriced allowances, private recipients,
  and an operator authorized to invoke the kill switch.

### 12. Alert thresholds

- **Recommend:** 25/50/75/90/100% plus absolute USD 1/3/5/10 alerts, and daily
  actual/forecast alerts where the billing platform supports them.
- **Alternative:** 50/75/90/100% with fewer absolute alerts to reduce noise.
- **Why:** absolute thresholds are more informative for a tiny budget, while
  percentages show acceleration.
- **Cost/security/complexity:** notifications are advisory and routing must not
  expose personal addresses in source. Test deduplication and ensure the backup
  operator receives unresolved high-severity alerts.
- **Reversibility:** routes and thresholds are replaceable; historical billing
  events remain.
- **Still needed:** `<PRIMARY_ALERT_RECIPIENT>`, `<BACKUP_ALERT_RECIPIENT>`,
  channel policy, forecast support, and private escalation ownership.

| Trigger | Placeholder recipient | Required action |
| --- | --- | --- |
| USD 1 or 25% | `<PRIMARY_ALERT_RECIPIENT>` | Check recent deployments, Function calls, and retained artifacts |
| USD 3 or 50% | `<PRIMARY_ALERT_RECIPIENT>` | Set both gates false and pause canaries pending explanation |
| USD 5 or 75% | `<PRIMARY_ALERT_RECIPIENT>`, `<BACKUP_ALERT_RECIPIENT>` | Disable invocation paths/Functions and inspect service-level costs |
| USD 10 or 100%, forecast breach, or unexplained daily spike | `<PRIMARY_ALERT_RECIPIENT>`, `<BACKUP_ALERT_RECIPIENT>` | Execute the full kill switch and teardown unless separately approved |

### 13. Synthetic fixture namespace

- **Recommend:** `<SYNTHETIC_FIXTURE_NAMESPACE>` embedded in obviously synthetic
  UIDs/keys at the actual candidate roots, backed by an allowlisted teardown
  manifest.
- **Alternative:** a staging-only parent for auxiliary fixture metadata only,
  never as a substitute for testing candidate paths.
- **Why:** nesting all data under a new parent would not exercise production-like
  rules, privacy, or adapters. Actual roots with deterministic fake identities
  test the real contract.
- **Cost/security/complexity:** keep counts and payloads tiny. Use no
  production-derived names, UIDs, emails, counts, hashes, timestamps, or list
  contents. Delete only manifest-listed records; stop on an unknown record.
- **Reversibility:** remove and verify each allowed synthetic root/Auth identity,
  then archive only aggregate evidence.
- **Still needed:** final namespace, root allowlist, fake identity convention,
  maximum fixture counts, teardown manifest, and cleanup operator.

## Modeled cost interpretation

These ranges are **sensitivity and incident-planning estimates, not expected
bills or quotes**. Registered users and MAU alone cause no callable bill; calls,
durations, retries, assessments, database traffic, logs, builds, retained
artifacts, and egress do. Official pricing was reviewed on 2026-08-05 and must
be reverified from the sources in the staging-creation approval package before
any resource is created.

| Scenario | Calls per MAU-month: handle / tag / Favorite / history / viewer | Safeguards assumed | Meaning |
| --- | --- | --- | --- |
| Guarded | `0.03 / 1 / 1 / 2 / 0.25` | Gates opened only for tested work, App Check, limits, idempotency, no passive/login/poll calls | Recommended lower-risk launch sensitivity |
| Normal | `0.05 / 2 / 2 / 8 / 0.5` | All safeguards active | Product-planning sensitivity, not a staging target |
| High | `0.1 / 10 / 15 / 60 / 3` | All safeguards active but users invoke features frequently | High legitimate-use sensitivity |
| Bounded abuse | `90 / 3,000 / 6,000 / 9,000 / 1,500` | Per-UID limits active but **every MAU reaches every daily ceiling for 30 days** | Deliberately severe incident case, not likely behavior |
| Catastrophic safeguards-disabled | effective `900 / 30,000 / 60,000 / 90,000 / 15,000` attempted demand | 10x runaway retry/automation; gates, limits, and effective App Check rejection are absent, failed, or bypassed; the instance cap is not assumed effective for the full range | Catastrophic demand envelope only |

All rows use one vCPU, 0.25 GiB, 250/180/200/350/180 ms average durations,
6/4, 4/4, 6/3, 8/4, and 7/3 RTDB reads/writes, 2 KiB per RTDB read, one
conservative App Check assessment, 1,600 log bytes, and 8 KiB egress per
invocation. They use `minInstances: 0`, `maxInstances: 5`, concurrency 10, and
a 30-second timeout. The model applies current published allowances, assumes
`us-central1` Tier 1 only as a reference while `<REGION>` remains undecided, and
models 1/2/8/30/30 monthly deployments with 0.5/0.5/1/5/5 GiB retained images.
No scheduled cleanup is assumed.

The bounded-abuse totals are internally consistent as request-volume
sensitivity: the rate ceilings are intentionally saturated for every MAU for a
month. At the modeled weighted average duration of about 293 ms, five instances
at concurrency 10 have a theoretical upper envelope of roughly 442 million
completed calls in a continuously saturated 30-day month. The 10,000-MAU
bounded row remains below that envelope. This is a capacity comparison, not a
promise of throughput or cost.

The catastrophic row multiplies demand by 10 and explicitly assumes operation
limits and the other safeguards are absent or bypassed. Its 10,000-MAU value of
about 1.959 billion attempted calls cannot all complete under an effective
five-instance, concurrency-10 cap at the modeled durations. That dollar range
is therefore an uncapped attempted-demand stress envelope, not a completed
Functions-work estimate. If the instance cap holds, completed compute is lower;
front-door requests, App Check assessments, rejected/retried traffic, builds,
storage, and logs may follow different billing units that must be reverified
officially. `maxInstances` and timeout constrain simultaneous processing and
per-attempt duration, not total attempted demand or every non-compute charge.
In an actual guarded staging launch, gates, low call rates, idempotency, and
rapid shutdown make these incident rows remote rather than expected.

| MAU | Guarded | Normal | High | Bounded abuse | Catastrophic safeguards-disabled |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | USD 0-3 | USD 0-5 | USD 0-5 | USD 1,200-1,500 | USD 13,500-15,000 |
| 1,000 | USD 0-5 | USD 8-20 | USD 8-25 | USD 13,500-15,000 | USD 136,000-150,000 |
| 10,000 | USD 8-20 | USD 15-35 | USD 640-750 | USD 136,000-150,000 | USD 1.36-1.50 million |

At normal 1,000 MAU, the model's first meaningful charge is reCAPTCHA/App Check:
12,550 conservative assessments cross the currently cited 10,000-assessment
allowance and contribute about USD 8. Modeled Cloud Run requests/compute,
RTDB download, Logging, and Build remain inside cited allowances; Artifact
Registry remains inside 0.5 GiB only if that allowance is available. The rest
of the USD 8-20 range is an explicit USD 0-12 uncertainty buffer for unresolved
region, routing, token reuse, shared allowances, and retained artifacts. It is
not a vague aggregate Firebase charge.

### Expected staging spend

These low-volume ranges are planning estimates and do not promise zero cost:

| Activity | Expected range | Assumptions |
| --- | ---: | --- |
| Project exists but unused | USD 0-1/month | No workload; retained logs, artifacts, RTDB data, or configuration may still cost |
| One small deployment | USD 0-2/event | Current build allowance available and image cleanup follows |
| One synthetic canary session | USD 0-2/session | Bounded calls, no polling/retries, gates immediately restored false |
| Several short sessions in one month | USD 0-5/month | Bounded logs, cleanup, no passive traffic, current allowances |

Cloud Build and retained Artifact Registry images are likely the first staging
charges around deployment; App Check assessments are the first likely
request-volume charge. Service attribution must be reviewed from actual billing
export data, not inferred from a generic Firebase total.

## Approval dependency order

1. Reverify all official prices and allowances.
2. Decide the staging project naming and billing strategy separately.
3. Decide the immutable RTDB location.
4. Decide the colocated Functions region and parameterize the source.
5. Decide the dedicated web app and App Check observation plan.
6. Name runtime, deployment, rules, and human identities privately.
7. Review exact IAM grants, duration, revocation, and compensating controls.
8. Decide the budget and alert/escalation routes.
9. Decide the synthetic namespace, root allowlist, and teardown manifest.
10. Reverify additive and rollback rule hashes.
11. Seek a separate resource-creation approval.

The RTDB location comes early because it cannot be changed in place. Every
later deployment, fixture, gate, and canary remains separately approved; no
recommendation here authorizes an operation.

## Recommendation summary

| Decision | Recommended placeholder/choice | Confidence | Still needed |
| --- | --- | --- | --- |
| `STAGING_PROJECT_ID` | `<APP_SLUG>-staging-<RANDOM_SUFFIX>` | High | app slug, suffix, private target check |
| `BILLING_ACCOUNT` | future production account plus staging budget | Medium | private account/policy/operator |
| `RTDB_LOCATION` | `us-central1` recommendation only | Medium | geography, residency, pricing, verification |
| `FUNCTIONS_REGION` | `<REGION>` colocated with RTDB | High after RTDB | source parameterization and supported region |
| `STAGING_WEB_APP_NAME` | `<APP_SLUG> staging web` | High | origins and local-versus-hosted choice |
| `APP_CHECK_PROVIDER` | reCAPTCHA Enterprise metrics-first | Medium | app, TTL, pricing, browser/PWA evidence |
| `RUNTIME_SERVICE_ACCOUNT` | `<APP_SLUG>-trusted-runtime-staging` | Medium | role review, monitoring, removal owner |
| `DEPLOYMENT_SERVICE_ACCOUNT` | `<APP_SLUG>-trusted-deployer-staging` | High | scope, window, revocation evidence |
| `RULES_OPERATOR_IDENTITY` | `<RULES_RELEASE_OPERATOR>` | High | named private operator and custom role |
| `HUMAN_OPERATOR` | `<NAMED_HUMAN_OPERATOR>` | High | private assignment and backup |
| `BUDGET_AMOUNT` | USD 10, operator stop at USD 3-5 | Medium | currency, recipients, repricing |
| `BUDGET_ALERT_THRESHOLDS` | 25/50/75/90/100% and USD 1/3/5/10 | High | private routes and forecast support |
| `SYNTHETIC_FIXTURE_NAMESPACE` | actual roots with `<SYNTHETIC_FIXTURE_NAMESPACE>` IDs | High | root allowlist and teardown manifest |

## Monetization boundary

Infrastructure cost and authorization remain independent from payment. Basic
privacy and security controls cannot become paid-only, and billing status must
never grant private-share access. Future premium features may invoke these
callables only when they deliver recurring product value; tier and price design
remains deferred until retention, operation volume, infrastructure cost, and
user demand are measured.

## Safety boundary

This candidate creates no project, billing link, IAM identity, App Check
configuration, budget, alert, rule release, Function, fixture, credential,
alias, HTTP adapter, or deployment command. It performs no staging or
production read or write. Both client flags and both server write gates remain
false or absent. Private review state remains `confirmed_valid_identity: 3`,
`unreviewed: 49`, and `seedEligibleTrueCount: 0`.
