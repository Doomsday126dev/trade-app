#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "Share visibility emulator checks require Java JDK 11 or newer." >&2
  exit 1
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
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]] || ! "$NODE_BIN" -e "require('node:test')" >/dev/null 2>&1; then
  echo "Share visibility checks require Node.js with node:test support." >&2
  exit 1
fi
echo "Share visibility rules test Node: $NODE_BIN ($("$NODE_BIN" --version))"
echo "WARNING: emulator-only narrow-read candidate; do not deploy or seed."
printf -v NODE_TEST_COMMAND 'POGO_RULES_PROJECT_ID=%q FIREBASE_DATABASE_EMULATOR_HOST=%q FIREBASE_AUTH_EMULATOR_HOST=%q %q --test --test-concurrency=1 %q %q' \
  "demo-pogo-share-visibility" "127.0.0.1:9200" "127.0.0.1:9299" "$NODE_BIN" \
  "tests/firebase/narrow-read-rules.test.cjs" "tests/firebase/share-visibility-rules.test.cjs"
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-pogo-share-visibility \
  --config tests/firebase/firebase.share-visibility.json \
  "$NODE_TEST_COMMAND"
