#!/usr/bin/env bash
set -euo pipefail
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$HOME/.cache/firebase/emulators}"
export DISCORD_FIRESTORE_EMULATOR=1
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
exec npx --yes --package firebase-tools@15.24.0 firebase emulators:exec \
  --only auth,firestore --project demo-pogo-discord \
  --config tests/firebase/firebase.discord-prototype.json \
  'node --test --test-concurrency=1 functions/test/firestore-discord-store.test.cjs tests/provider-auth-sdk-emulator.test.cjs tests/provider-auth-browser-emulator.test.cjs'
