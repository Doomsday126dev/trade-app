# Firebase Rules Emulator Baseline

This directory characterizes the Realtime Database rules deployed on
2026-08-03. It does not contain a production deployment configuration and must
not be used with `firebase deploy`.

`database.rules.current.json` is byte-identical to the rules read from the live
Firebase Console Rules editor at the start of this work. Its SHA-256 is locked
by the test suite. A second timestamped copy is kept in the git-ignored
`.firebase-local/` workflow for private/local rollback evidence.

The deployed rules literally contain `OWNER_USERNAME_PLACEHOLDER`. That is not
a redaction performed by this fixture. Tests use the literal deployed value so
they characterize current behavior exactly.

## Run locally

Requirements:

- Node.js 16 or newer
- Java JDK 11 or newer
- Firebase CLI, or network access on the first run so `npx` can download the
  pinned CLI and Realtime Database Emulator

Run:

```sh
npm run check:rules
```

The command uses only Node's built-in test and HTTP APIs plus the Firebase Auth
and Realtime Database emulators. It runs with the demo project ID
`demo-pogo-rules`, the config in this directory, and `emulators:exec`. It does
not connect to or write production Firebase data.

Tests prefixed with `[expected current vulnerability]` deliberately assert the
unsafe behavior of the deployed rules. They are characterization tests for the
next hardening commit, not endorsements of that behavior.
