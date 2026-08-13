#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if [[ -x "$PWD/.firebase-local/bin/firebase" ]]; then
  export HOME="$PWD/.firebase-local/home"
  FIREBASE=("$PWD/.firebase-local/bin/firebase")
elif command -v firebase >/dev/null 2>&1; then
  FIREBASE=(firebase)
else
  FIREBASE=(npx --yes --package firebase-tools@15.24.0 firebase)
fi
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$PWD/.firebase-local/emulators}"
NODE_BIN="$(command -v node)"
printf -v TEST_COMMAND '%q --test %q' "$NODE_BIN" tests/firebase/request-access-candidate-rules.test.cjs
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-pogo-request-access-candidate \
  --config tests/firebase/firebase.request-access-candidate.json \
  "$TEST_COMMAND"
