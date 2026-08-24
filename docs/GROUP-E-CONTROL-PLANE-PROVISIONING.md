# Group E control-plane provisioning prerequisite

This is a source-only plan. It does not authorize database creation, Rules deployment, service-account
creation, IAM mutation, backend deployment, gate enablement, authentication, or a Group E canary.

## Explicit Firebase targeting

`firebase.group-e-control.json` contains one named Firestore mapping: `e1-group-e-control` to
`functions/production/e1-group-e-control.rules`. It contains no default database, `phase-e-identity`,
Realtime Database, Functions, Hosting, Storage, Auth, hooks, aliases, or indexes.

`.firebaserc` is intentionally absent. Every future Firebase command must bind both the literal project
and the dedicated config, so ambient aliases and active projects cannot select production resources.
The only reviewed selector is `firestore:e1-group-e-control`.

The Firebase CLI is isolated under `tools/group-e-control`, pinned exactly to `15.28.1`, installed with
scripts disabled, and invoked only through its package-local executable:

```sh
npm ci --ignore-scripts --prefix tools/group-e-control
node scripts/check-group-e-control-rules-tooling.cjs
```

The planner invokes the package-local `firebase --version`, requires exact output `15.28.1`, and creates
and removes its own empty temporary XDG config directory for that check. It does not read a global
Firebase alias, login, or update-check store.

The planner prints hashes and a future command but never executes a deployment.

## Deny-all verification

The future production verifier uses unauthenticated Firestore REST requests because Admin SDK and
server-IAM clients bypass Firebase Security Rules. It is fixed to project `trade-list-a4297`, database
`e1-group-e-control`, and document `__group_e_rules_probe__/deny-all`.

The read probe is `GET`. The write-denial probe is `PATCH` with `currentDocument.exists=true` against
the same expected-absent document. Even accidentally permissive Rules therefore cannot create it.
Only HTTP 403 with `PERMISSION_DENIED` is accepted; success, not-found, precondition failure, malformed
responses, network failure, and timeout all fail closed. The verifier never cleans up because it never
creates data. Its public Web API key is accepted only from `GROUP_E_CONTROL_FIREBASE_WEB_API_KEY` and is
never printed or persisted. OAuth, ADC, Auth tokens, cookies, App Check debug tokens, redirects, retries,
list/query, create, and delete operations are absent.
The supplied public key must also match the SHA-256 of the existing production Web API key, preventing
an unrelated or invalid key's 403 response from being mistaken for Rules denial.

## Planned keyless principals

- Operator: `serviceAccount:e1-group-e-control-operator@trade-list-a4297.iam.gserviceaccount.com`
- Reviewer: `serviceAccount:e1-group-e-control-reviewer@trade-list-a4297.iam.gserviceaccount.com`
- Gateway: `serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com`
- Authority: no control-plane role

Operator and reviewer remain `NOT_CREATED`; every control-role and Token Creator binding remains
`NOT_BOUND`. Service-account keys are forbidden. A future private mode-0600 artifact must identify the
reviewed human impersonator. `roles/iam.serviceAccountTokenCreator` may be bound only on each individual
operator/reviewer service account, never on the project.

## Future authorization windows

The first window may create and verify the protected named database. A later Rules window may deploy
only the reviewed named-database Rules and run the non-privileged denial verifier. Service-account,
custom-role, per-account impersonation, and conditioned control-role bindings require another reviewed
window. Gateway access is deferred until immediately before an independently authorized inactive
backend deployment. Gates remain disabled throughout.

**NOT AUTHORIZED — DO NOT RUN YET**

```sh
gcloud firestore databases create --project=trade-list-a4297 --database=e1-group-e-control --location=us-central1 --type=firestore-native --edition=standard --delete-protection --enable-pitr
```

**NOT AUTHORIZED — DO NOT RUN YET**

```sh
tools/group-e-control/node_modules/.bin/firebase deploy --project=trade-list-a4297 --config=firebase.group-e-control.json --only=firestore:e1-group-e-control --non-interactive
```

**NOT AUTHORIZED — DO NOT RUN YET**

```sh
GROUP_E_CONTROL_FIREBASE_WEB_API_KEY='<public-web-api-key>' node scripts/verify-group-e-control-rules-deny-all.cjs --mode=production-verify --project=trade-list-a4297 --database=e1-group-e-control --expected-empty=true --confirm='VERIFY E1 GROUP E CONTROL RULES DENY ALL'
```

**NOT AUTHORIZED — DO NOT RUN YET**

```sh
gcloud iam service-accounts create e1-group-e-control-operator --project=trade-list-a4297 --display-name='E1 Group E control operator'
```

**NOT AUTHORIZED — DO NOT RUN YET**

```sh
gcloud iam service-accounts create e1-group-e-control-reviewer --project=trade-list-a4297 --display-name='E1 Group E control reviewer'
```

The human impersonator value must be loaded privately and must never be added to this document or tracked
source. No command here authorizes a cloud operation; each block requires separate explicit approval.
