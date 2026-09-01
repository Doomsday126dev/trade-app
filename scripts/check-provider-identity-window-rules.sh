#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/build-legacy-provisioning-freeze-candidate.cjs --check
node scripts/build-provider-identity-window-rules.cjs --check

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
elif [[ -x "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if [[ -x "$PWD/.firebase-local/bin/firebase" ]]; then
  export HOME="$PWD/.firebase-local/home"
  FIREBASE=("$PWD/.firebase-local/bin/firebase")
else
  FIREBASE=(npx --yes --package firebase-tools@15.24.0 firebase)
fi
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$PWD/.firebase-local/emulators}"

printf -v TEST_COMMAND 'POGO_RULES_PROJECT_ID=%q FIREBASE_DATABASE_EMULATOR_HOST=%q FIREBASE_AUTH_EMULATOR_HOST=%q node --test --test-concurrency=1 %q %q' \
  "demo-pogo-provider-identity-window" "127.0.0.1:9410" "127.0.0.1:9499" \
  "tests/firebase/legacy-provisioning-freeze-rules.test.cjs" \
  "tests/firebase/provider-public-projection-rules.test.cjs"

exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-pogo-provider-identity-window \
  --config tests/firebase/firebase.provider-identity-window.json \
  "$TEST_COMMAND"
