#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/build-legacy-provisioning-freeze-candidate.cjs --check
POGO_RULES_PROJECT_ID=demo-pogo-legacy-provisioning-freeze \
  npx --yes --package firebase-tools@14.12.1 firebase emulators:exec --project demo-pogo-legacy-provisioning-freeze \
  --config tests/firebase/firebase.legacy-provisioning-freeze.json \
  --only auth,database \
  "node --test tests/firebase/legacy-provisioning-freeze-rules.test.cjs"
