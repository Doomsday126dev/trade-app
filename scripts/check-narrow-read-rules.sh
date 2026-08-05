#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "Narrow-read emulator checks require Java JDK 11 or newer." >&2
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
  echo "Narrow-read checks require Node.js with node:test support." >&2
  exit 1
fi
echo "Narrow-read rules test Node: $NODE_BIN ($("$NODE_BIN" --version))"
echo "WARNING: emulator-only root-read cutover candidate; do not deploy."
printf -v NODE_TEST_COMMAND '%q --test %q' "$NODE_BIN" "tests/firebase/narrow-read-rules.test.cjs"
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-pogo-narrow-read \
  --config tests/firebase/firebase.narrow-read.json \
  "$NODE_TEST_COMMAND"
