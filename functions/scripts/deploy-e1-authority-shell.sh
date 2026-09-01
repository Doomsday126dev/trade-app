#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: deploy-e1-authority-shell.sh" >&2
  exit 64
fi

PROJECT="trainer-hub-staging-37ib4wct"
PROJECT_NUMBER="391359988648"
REGION="us-central1"
DATABASE="phase-e-identity"
SERVICE="e1-identity-authority"
RUNTIME_SA="e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com"
BUILD_SA_EMAIL="e1-authority-builder@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com"
BUILD_SA="projects/$PROJECT/serviceAccounts/$BUILD_SA_EMAIL"
ARTIFACT_REPOSITORY="cloud-run-source-deploy"
IMAGE_URI="$REGION-docker.pkg.dev/$PROJECT/$ARTIFACT_REPOSITORY/$SERVICE"
RTDB_URL="https://trainer-hub-staging-37ib4wct-e1.firebaseio.com"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../e1-authority-service" && pwd)"
: "${FIREBASE_WEB_API_KEY:?FIREBASE_WEB_API_KEY is required}"
: "${EXPECTED_OPERATOR_EMAIL_HASH:?EXPECTED_OPERATOR_EMAIL_HASH is required}"
: "${EXPECTED_OPERATOR_SUBJECT_HASH:?EXPECTED_OPERATOR_SUBJECT_HASH is required}"

export APP_ENVIRONMENT="staging"
export FIREBASE_PROJECT_ID="$PROJECT"
export EXPECTED_PROJECT_NUMBER="$PROJECT_NUMBER"
export FIREBASE_PROJECT_NUMBER="$PROJECT_NUMBER"
export EXPECTED_STAGING_PROJECT_NUMBER="$PROJECT_NUMBER"
export SERVICE_REGION="$REGION"
export FIRESTORE_DATABASE_ID="$DATABASE"
export AUTHORITY_SERVICE_NAME="$SERVICE"
export AUTHORITY_RUNTIME_SERVICE_ACCOUNT="$RUNTIME_SA"
export RTDB_DATABASE_URL="$RTDB_URL"
export READ_ACCOUNT_FOUNDATION_ENABLED="true"
export CREATE_PROVIDER_ACCOUNT_ENABLED="false"
export RESERVE_HANDLE_ENABLED="false"
export REPAIR_FOUNDATION_ENABLED="false"
export APPLY_MIGRATION_ENABLED="false"
export FREEZE_CONFLICT_ENABLED="false"
export EXPECTED_OPERATOR_EMAIL_HASH
export EXPECTED_OPERATOR_SUBJECT_HASH

node "$(dirname "${BASH_SOURCE[0]}")/check-e1-staging-target.cjs"

[[ "$(gcloud config get-value project)" == "$PROJECT" ]]
[[ "$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]]
[[ "$(gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$BUILD_SA_EMAIL AND bindings.role:roles/run.builder" --format='value(bindings.role)')" == "roles/run.builder" ]]
for api in run.googleapis.com storage.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com; do
  [[ "$(gcloud services list --enabled --project="$PROJECT" --filter="config.name=$api" --format='value(config.name)')" == "$api" ]]
done

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" \
  --project="$PROJECT" \
  --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --project="$PROJECT" \
    --location="$REGION" \
    --repository-format="docker" \
    --description="Trainer Hub staging Cloud Run source artifacts" \
    --labels="environment=staging,application=trainer-hub,lifecycle=temporary" \
    --quiet
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
BUILD_RESULT="$TEMP_DIR/build.json"
BUILD_CONFIG="$TEMP_DIR/cloudbuild.yaml"
SERVICE_SPEC="$TEMP_DIR/service.json"

cat >"$BUILD_CONFIG" <<EOF
steps:
- name: gcr.io/k8s-skaffold/pack
  entrypoint: pack
  args: [config, default-builder, gcr.io/buildpacks/builder:latest]
- name: gcr.io/k8s-skaffold/pack
  entrypoint: pack
  args: [build, $IMAGE_URI, --network, cloudbuild, --publish]
- name: gcr.io/cloud-builders/docker
  entrypoint: docker
  args: [pull, $IMAGE_URI]
images:
- $IMAGE_URI
options:
  logging: CLOUD_LOGGING_ONLY
EOF

gcloud builds submit "$SOURCE_DIR" \
  --project="$PROJECT" \
  --region="$REGION" \
  --service-account="$BUILD_SA" \
  --config="$BUILD_CONFIG" \
  --format=json \
  --quiet >"$BUILD_RESULT"

BUILD_ID="$(node -e 'const b=require(process.argv[1]); process.stdout.write(b.id || "")' "$BUILD_RESULT")"
IMAGE_DIGEST="$(node -e 'const b=require(process.argv[1]); process.stdout.write(b.results?.images?.[0]?.digest || "")' "$BUILD_RESULT")"
[[ -n "$BUILD_ID" ]]
[[ "$IMAGE_DIGEST" == sha256:* ]]

# The previous guarded raw-source revision left no-build source annotations
# that current gcloud source-deploy validation cannot transition atomically.
# Build with the same Google buildpack, then replace the template once using
# the immutable digest while removing only that obsolete source metadata.
gcloud run services describe "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format=json | node -e '
    const fs = require("node:fs");
    const service = JSON.parse(fs.readFileSync(0, "utf8"));
    const image = process.argv[1];
    const operatorEmailHash = process.argv[2];
    const operatorSubjectHash = process.argv[3];
    delete service.status;
    for (const key of ["creationTimestamp", "generation", "resourceVersion", "selfLink", "uid"])
      delete service.metadata?.[key];
    const annotations = service.spec?.template?.metadata?.annotations || {};
    delete annotations["run.googleapis.com/sources"];
    delete annotations["run.googleapis.com/base-images"];
    delete service.spec?.template?.spec?.runtimeClassName;
    const containers = service.spec?.template?.spec?.containers || [];
    if (containers.length !== 1) throw new Error("Expected exactly one service container");
    containers[0].image = image;
    delete containers[0].command;
    delete containers[0].args;
    const environment = containers[0].env || (containers[0].env = []);
    for (const [name, value] of [
      ["EXPECTED_PROJECT_NUMBER", "391359988648"],
      ["EXPECTED_OPERATOR_EMAIL_HASH", operatorEmailHash],
      ["EXPECTED_OPERATOR_SUBJECT_HASH", operatorSubjectHash]
    ]) {
      const current = environment.find((entry) => entry.name === name);
      if (current) current.value = value;
      else environment.push({ name, value });
    }
    process.stdout.write(JSON.stringify(service, null, 2));
  ' "$IMAGE_URI@$IMAGE_DIGEST" "$EXPECTED_OPERATOR_EMAIL_HASH" "$EXPECTED_OPERATOR_SUBJECT_HASH" >"$SERVICE_SPEC"

gcloud run services replace "$SERVICE_SPEC" \
  --project="$PROJECT" \
  --region="$REGION" \
  --dry-run \
  --quiet >/dev/null

gcloud run services replace "$SERVICE_SPEC" \
  --project="$PROJECT" \
  --region="$REGION" \
  --quiet

printf '{"buildId":"%s","image":"%s@%s"}\n' "$BUILD_ID" "$IMAGE_URI" "$IMAGE_DIGEST"
