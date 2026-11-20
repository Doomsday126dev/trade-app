#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
POGO_RULES_PROJECT_ID=demo-google-orphan-recovery \
  npx --yes --package firebase-tools@14.12.1 firebase emulators:exec \
  --project demo-google-orphan-recovery \
  --config tests/firebase/firebase.google-orphan-credential.json \
  --only auth \
  "node --test tests/firebase/google-orphan-credential-emulator.test.cjs"
