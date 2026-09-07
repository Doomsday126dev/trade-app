#!/usr/bin/env bash
set -euo pipefail

if [[ -x "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if command -v firebase >/dev/null 2>&1; then
  FIREBASE=(firebase)
else
  FIREBASE=(npx --yes --package firebase-tools@15.24.0 firebase)
fi
export NODE_PATH="$PWD/functions/legacy-pin-reset/node_modules${NODE_PATH:+:$NODE_PATH}"
node scripts/build-legacy-identity-fences.cjs --check
exec "${FIREBASE[@]}" emulators:exec --project demo-legacy-pin-reset \
  --config firebase.legacy-identity-fences.emulator.json --only auth,database \
  "node --test --test-concurrency=1 tests/firebase/legacy-identity-guard.test.cjs tests/firebase/legacy-identity-fences.test.cjs && node --test --test-name-pattern='same-UID PIN reset' tests/account-sync-runtime.test.cjs"
