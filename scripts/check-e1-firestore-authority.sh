#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
elif [[ -x "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "E.1 Firestore authority proof requires Java JDK 11 or newer." >&2
  exit 1
fi
FIREBASE=(npx --yes --package firebase-tools@15.24.0 firebase)
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$PWD/.firebase-local/emulators}"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "E.1 Firestore authority proof requires Node.js." >&2
  exit 1
fi
echo "WARNING: local E.1 architecture proof only; do not deploy or seed."
printf -v TEST_COMMAND '%q --test --test-concurrency=1 %q' "$NODE_BIN" "functions/test/e1-firestore-authority-emulator.test.cjs"
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,firestore \
  --project demo-pogo-e1-authority \
  --config tests/firebase/firebase.e1-authority.json \
  "$TEST_COMMAND"
