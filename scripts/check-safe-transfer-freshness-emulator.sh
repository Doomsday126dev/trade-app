#!/usr/bin/env bash
set -euo pipefail
if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"; export PATH="$JAVA_HOME/bin:$PATH"; fi
if [[ -x "$PWD/.firebase-local/bin/firebase" ]]; then
  export HOME="$PWD/.firebase-local/home"; FIREBASE=("$PWD/.firebase-local/bin/firebase")
elif command -v firebase >/dev/null 2>&1; then FIREBASE=(firebase)
else FIREBASE=(npx --yes --package firebase-tools@14.12.1 firebase); fi
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$PWD/.firebase-local/emulators}"
exec "${FIREBASE[@]}" emulators:exec --only database --project demo-pogo-safe-transfer-freshness --config tests/firebase/firebase.safe-transfer.json "node scripts/run-safe-transfer-freshness-emulator.cjs"
