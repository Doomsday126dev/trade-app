#!/usr/bin/env bash
set -euo pipefail

if [[ -x "$PWD/.firebase-local/jdk/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="$PWD/.firebase-local/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "SEC-02 production Rules checks require Java JDK 11 or newer." >&2
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
NODE_BIN="$(command -v node)"
PROJECT_ID=demo-pogo-sec02-production
printf -v NARROW_COMMAND 'POGO_RULES_PROJECT_ID=%q %q --test %q' "$PROJECT_ID" "$NODE_BIN" tests/firebase/narrow-read-rules.test.cjs
printf -v REQUEST_COMMAND 'POGO_RULES_PROJECT_ID=%q %q --test %q' "$PROJECT_ID" "$NODE_BIN" tests/firebase/request-access-candidate-rules.test.cjs
printf -v ACCOUNT_SYNC_COMMAND 'POGO_RULES_PROJECT_ID=%q %q --test %q' "$PROJECT_ID" "$NODE_BIN" tests/firebase/account-sync-rules.test.cjs
exec "${FIREBASE[@]}" emulators:exec \
  --only auth,database \
  --project "$PROJECT_ID" \
  --config tests/firebase/firebase.sec02-production.json \
  "$NARROW_COMMAND && $REQUEST_COMMAND && $ACCOUNT_SYNC_COMMAND"
