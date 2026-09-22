#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/build-permanent-legacy-allocation-candidate.cjs --check
POGO_RULES_PROJECT_ID=demo-pogo-permanent-legacy-allocation \
  npx --yes --package firebase-tools@14.12.1 firebase emulators:exec \
  --project demo-pogo-permanent-legacy-allocation \
  --config tests/firebase/firebase.permanent-legacy-allocation.json \
  --only auth,database \
  "node --test tests/firebase/permanent-legacy-allocation-rules.test.cjs"
