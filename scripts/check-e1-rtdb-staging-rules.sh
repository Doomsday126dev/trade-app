#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
FIREBASE=(npx --yes --package firebase-tools@15.24.0 firebase)
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$PWD/.firebase-local/emulators}"
printf -v TEST_COMMAND '%q --test --test-concurrency=1 %q' "$(command -v node)" "functions/test/e1-rtdb-staging-rules-emulator.test.cjs"
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-e1-rtdb-staging \
  --config tests/firebase/firebase.e1-rtdb-staging.json \
  "$TEST_COMMAND"
