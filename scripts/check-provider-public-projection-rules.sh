#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
elif [[ -x "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 || ! java -version 2>&1 | head -1 | grep -Eq 'version "(2[1-9]|[3-9][0-9])'; then
  echo "Provider public-projection Rules proof requires Java JDK 21 or newer." >&2
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
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Provider public-projection Rules proof requires Node.js." >&2
  exit 1
fi
echo "WARNING: local provider public-projection candidate only; do not deploy or seed."
printf -v TEST_COMMAND 'POGO_RULES_PROJECT_ID=%q FIREBASE_DATABASE_EMULATOR_HOST=%q FIREBASE_AUTH_EMULATOR_HOST=%q %q --test --test-concurrency=1 %q' \
  "demo-pogo-provider-public" "127.0.0.1:9210" "127.0.0.1:9309" "$NODE_BIN" \
  "tests/firebase/provider-public-projection-rules.test.cjs"
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project demo-pogo-provider-public \
  --config tests/firebase/firebase.provider-public-projection.json \
  "$TEST_COMMAND"
