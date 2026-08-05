#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]] || [[ "$($NODE_BIN -p 'process.versions.node.split(`.`)[0]')" != "22" ]]; then
  echo "Trusted Functions emulator checks require Node.js 22.x; current: ${NODE_BIN:-missing} $(${NODE_BIN:-false} --version 2>/dev/null || true)." >&2
  echo "Activate Node 22, reinstall functions dependencies under Node 22, and rerun this command." >&2
  exit 1
fi

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "Trusted Functions emulator checks require Java JDK 11 or newer." >&2
  exit 1
fi
# The standalone Firebase CLI bundles Node 18 and cannot validate a Node 22
# Functions runtime. Always launch npm firebase-tools through the active Node 22.
FIREBASE=(npx --yes --package firebase-tools@15.24.0 firebase)
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$PWD/.firebase-local/emulators}"
export TRUSTED_CALLABLE_EMULATOR_APP_CHECK_BYPASS=true
echo "WARNING: demo-project emulator candidate only; no production credentials or deployment capability."
printf -v EMULATOR_TEST_COMMAND '%q --test --test-concurrency=1 %q' \
  "$NODE_BIN" "functions/test/emulator-contract.test.cjs"
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database,functions \
  --project demo-pogo-trusted-functions \
  --config firebase.trusted-functions.emulator.json \
  "$EMULATOR_TEST_COMMAND"
