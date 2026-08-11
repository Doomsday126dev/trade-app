#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^(disabled|repair|migration|freeze)$ ]]; then
  echo "Usage: set-e1-authority-operation-gate.sh disabled|repair|migration|freeze" >&2
  exit 64
fi

PROJECT="trainer-hub-staging-37ib4wct"
PROJECT_NUMBER="391359988648"
REGION="us-central1"
DATABASE="phase-e-identity"
SERVICE="e1-identity-authority"
RUNTIME_SA="e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com"
RTDB_URL="https://trainer-hub-staging-37ib4wct-e1.firebaseio.com"
MODE="$1"

export APP_ENVIRONMENT="staging"
export FIREBASE_PROJECT_ID="$PROJECT"
export FIREBASE_PROJECT_NUMBER="$PROJECT_NUMBER"
export EXPECTED_STAGING_PROJECT_NUMBER="$PROJECT_NUMBER"
export SERVICE_REGION="$REGION"
export FIRESTORE_DATABASE_ID="$DATABASE"
export AUTHORITY_SERVICE_NAME="$SERVICE"
export AUTHORITY_RUNTIME_SERVICE_ACCOUNT="$RUNTIME_SA"
export RTDB_DATABASE_URL="$RTDB_URL"
export READ_ACCOUNT_FOUNDATION_ENABLED="true"
export RESERVE_HANDLE_ENABLED="false"
export REPAIR_FOUNDATION_ENABLED="false"
export APPLY_MIGRATION_ENABLED="false"
export FREEZE_CONFLICT_ENABLED="false"
unset E1_ALLOWED_MUTATION_GATE || true

case "$MODE" in
  repair)
    export REPAIR_FOUNDATION_ENABLED="true"
    export E1_ALLOWED_MUTATION_GATE="REPAIR_FOUNDATION_ENABLED"
    ;;
  migration)
    export APPLY_MIGRATION_ENABLED="true"
    export E1_ALLOWED_MUTATION_GATE="APPLY_MIGRATION_ENABLED"
    ;;
  freeze)
    export FREEZE_CONFLICT_ENABLED="true"
    export E1_ALLOWED_MUTATION_GATE="FREEZE_CONFLICT_ENABLED"
    ;;
esac

node "$(dirname "${BASH_SOURCE[0]}")/check-e1-staging-target.cjs" >/dev/null
[[ "$(gcloud config get-value project)" == "$PROJECT" ]]
[[ "$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
BEFORE="$TEMP_DIR/before.json"
SPEC="$TEMP_DIR/service.json"

gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json >"$BEFORE"
node - "$BEFORE" "$SPEC" "$RUNTIME_SA" \
  "$READ_ACCOUNT_FOUNDATION_ENABLED" "$RESERVE_HANDLE_ENABLED" "$REPAIR_FOUNDATION_ENABLED" \
  "$APPLY_MIGRATION_ENABLED" "$FREEZE_CONFLICT_ENABLED" <<'NODE'
const fs = require('node:fs');
const [input, output, runtimeServiceAccount, ...gateValues] = process.argv.slice(2);
const service = JSON.parse(fs.readFileSync(input, 'utf8'));
if (service?.spec?.template?.spec?.serviceAccountName !== runtimeServiceAccount) throw new Error('runtime identity mismatch');
if (service?.metadata?.name !== 'e1-identity-authority') throw new Error('service mismatch');
delete service.status;
for (const key of ['creationTimestamp', 'generation', 'resourceVersion', 'selfLink', 'uid']) delete service.metadata?.[key];
const containers = service.spec?.template?.spec?.containers || [];
if (containers.length !== 1 || !String(containers[0].image || '').includes('@sha256:')) throw new Error('immutable image required');
const gates = ['READ_ACCOUNT_FOUNDATION_ENABLED', 'RESERVE_HANDLE_ENABLED', 'REPAIR_FOUNDATION_ENABLED', 'APPLY_MIGRATION_ENABLED', 'FREEZE_CONFLICT_ENABLED'];
const environment = containers[0].env || (containers[0].env = []);
for (const [index, name] of gates.entries()) {
  const entry = environment.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`missing gate ${name}`);
  entry.value = gateValues[index];
}
fs.writeFileSync(output, JSON.stringify(service, null, 2));
NODE

gcloud run services replace "$SPEC" --project="$PROJECT" --region="$REGION" --dry-run --quiet >/dev/null
gcloud run services replace "$SPEC" --project="$PROJECT" --region="$REGION" --quiet >/dev/null

gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json | node -e '
  const fs = require("node:fs");
  const service = JSON.parse(fs.readFileSync(0, "utf8"));
  const container = service.spec.template.spec.containers[0];
  const environment = Object.fromEntries(container.env.map((entry) => [entry.name, entry.value]));
  const gates = ["READ_ACCOUNT_FOUNDATION_ENABLED", "RESERVE_HANDLE_ENABLED", "REPAIR_FOUNDATION_ENABLED", "APPLY_MIGRATION_ENABLED", "FREEZE_CONFLICT_ENABLED"];
  process.stdout.write(`${JSON.stringify({
    revision: service.status.latestReadyRevisionName,
    traffic: service.status.traffic,
    image: container.image,
    runtimeServiceAccount: service.spec.template.spec.serviceAccountName,
    gates: Object.fromEntries(gates.map((gate) => [gate, environment[gate]]))
  }, null, 2)}\n`);
'
