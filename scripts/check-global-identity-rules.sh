#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "Firebase Realtime Database Emulator requires Java JDK 11 or newer." >&2
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
if [[ -z "$NODE_BIN" && -x /usr/local/bin/node ]]; then
  NODE_BIN=/usr/local/bin/node
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]] || ! "$NODE_BIN" -e "require('node:test')" >/dev/null 2>&1; then
  echo "Global identity rules checks require Node.js with node:test support." >&2
  exit 1
fi

NODE_VERSION="$("$NODE_BIN" --version)"
echo "Global identity rules test Node: $NODE_BIN ($NODE_VERSION)"
echo "WARNING: emulator-only candidate; unsafe to deploy while authenticated root read remains enabled."
"$NODE_BIN" scripts/check-global-identity-contract.js
printf -v NODE_TEST_COMMAND '%q --test %q' "$NODE_BIN" "tests/firebase/global-identity-rules.test.cjs"

exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-pogo-global-identity \
  --config tests/firebase/firebase.global-identity.json \
  "$NODE_TEST_COMMAND"
