# Trusted Functions Staging Resource Readiness

Status: local-only, non-operational, and approval-neutral. Every formal approval
remains `undecided`, with empty `approvedBy` and `approvedAt` values.

## Boundary

This checkpoint prepares private local inputs and an inventory-only future plan.
It cannot create or reserve a project, attach billing, assign IAM, configure a
budget or alert, deploy rules or Functions, register App Check, create fixtures,
enable gates, or read or write staging or production.

The private document remains only at
`functions/.local/staging-resource-inputs.json`. The directory must be mode
`0700`; the file must be mode `0600`. Alternate paths, symlinks, insecure modes,
and direct values in command arguments are rejected. Normal output contains
only booleans, aggregate counts, stable status codes, and zero-operation
counters.

## Secure Local Workflow

Run these only in a normal local Terminal from the repository root. Do not paste
private values into Codex, chat, shell arguments, logs, screenshots, or tracked
files.

```bash
cd "/Users/amityaagarwal/Documents/Codex/2026-05-21/files-mentioned-by-the-user-index/repo-trade-app"
npm run staging:resource-preflight -- create-template
npm run staging:resource-readiness -- apply-public
npm run staging:resource-readiness -- generate-suffix
npm run staging:resource-readiness -- compose-project-id
```

`generate-suffix` uses Node's cryptographically secure random source, rejects
biased bytes, stores exactly eight lowercase letters/digits, preserves mode
`0600`, and reports only `randomSuffixConfigured: true`.
`compose-project-id` stores the concrete 28-character candidate and reports only
redacted validity booleans.

Configure private fields one at a time through hidden prompts:

```bash
npm run staging:resource-readiness -- set-private BILLING_ACCOUNT
npm run staging:resource-readiness -- set-private BILLING_OPERATOR
npm run staging:resource-readiness -- set-private BILLING_ALERT_RECIPIENT
npm run staging:resource-readiness -- set-private BILLING_ESCALATION_TARGET
npm run staging:resource-readiness -- set-private RULES_OPERATOR_IDENTITY
npm run staging:resource-readiness -- set-private HUMAN_OPERATOR
npm run staging:resource-readiness -- set-private TEARDOWN_OWNER
```

The same private person may initially fill all six procedural roles, but each
value is entered separately and never copied automatically. This is not
independent two-person review.

Actual dates remain unresolved until resource-creation approval is about to be
requested. Each helper accepts a future timezone-qualified ISO-8601 start and
calculates an exact two-hour end:

```bash
npm run staging:resource-readiness -- set-window RESOURCE_CREATION_WINDOW
npm run staging:resource-readiness -- set-window SMOKE_AND_ROLLBACK_WINDOW
```

No action may begin before the start. Expired windows fail closed and require
fresh approval. No scheduler or automation is created.

## Availability Limitation

Google Cloud does not expose a reliable non-creating API that proves a globally
unique project ID is available for creation. A read can distinguish an
accessible existing project from some failures, but a not-found or inaccessible
response cannot prove future creatability or reserve the ID. The checkpoint
therefore performs no speculative cloud lookup and leaves availability
unresolved until an approved creation attempt.

The local command validates the private candidate and reports this limitation:

```bash
npm run staging:resource-readiness -- availability --check-only
```

It performs zero network calls and never prints the candidate.

## Rules And Pricing

Recompute both reviewed fixture hashes locally:

```bash
npm run staging:resource-readiness -- verify-rules
```

- Narrow-read rollback: `e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf`
- Additive candidate: `cbcea2a672e1f9b1d6a4582410bb89bca765ca307c0495c7cc80ea35f805071c`

Pricing was reverified on 2026-08-05 against the official Cloud Run, Cloud Run
functions, Firebase Realtime Database, reCAPTCHA, Cloud Build, Artifact
Registry, Google Cloud Observability, VPC networking, and Cloud Billing budget
documentation. No material guarded-model assumption changed. The USD 10/month
budget and USD 3-5 manual investigation threshold remain reasonable. The likely
first small charges remain builds and retained artifacts. reCAPTCHA Premium is
free through 10,000 monthly assessments, then uses an USD 8 tier through
100,000. Budgets and alerts remain advisory, not hard caps. Official pricing
must be rechecked again on the actual creation date.

## Redacted Validation

After private fields are completed locally:

```bash
npm run staging:resource-preflight -- validate
npm run staging:resource-preflight -- summary
```

Outputs contain aggregate completion, validity, dependency, approval, hash,
pricing-date, availability, and zero-operation fields only. Passing validation
does not approve anything.

## Inventory-Only Future Plan

Within one separately approved two-hour window, the future operator may only:

1. Create one isolated staging project.
2. Attach the privately approved billing account.
3. Apply the five reviewed staging labels.
4. Create RTDB in `us-central1`.
5. Register one staging web app.
6. Create the runtime and deployment service accounts.
7. Assign only separately approved IAM roles.
8. Create the USD 10 budget and approved alerts.
9. Prepare ignored local staging configuration.
10. Verify the exact inventory and stop.

Stop on any target, identity, billing scope, permission, hash, window, or
inventory mismatch. For partial creation, record the exact inventory and remove
only verified partial staging resources, or delete the isolated staging project
after separate confirmation. Rules, Functions, App Check, fixtures, gates,
canaries, client wiring, cohorts, preference migration, grants, and every
production action remain excluded and require later approvals.
