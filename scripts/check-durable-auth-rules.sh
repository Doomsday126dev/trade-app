#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "Durable Auth emulator checks require Java JDK 11 or newer." >&2
  exit 1
fi
FIREBASE=(npx --yes --package firebase-tools@15.24.0 firebase)
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$PWD/.firebase-local/emulators}"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Durable Auth checks require Node.js." >&2
  exit 1
fi
echo "WARNING: local E.1 authorization proof only; do not deploy or seed."
node scripts/build-durable-auth-additive-rules.cjs
printf -v TEST_COMMAND '%q --test --test-concurrency=1 %q' "$NODE_BIN" "tests/firebase/durable-auth-rules.test.cjs"
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-pogo-durable-auth \
  --config tests/firebase/firebase.durable-auth.json \
  "$TEST_COMMAND"
