# Firebase Rules Emulator Baseline And Hardening Candidate

This directory characterizes the Realtime Database rules deployed on
2026-08-03. It does not contain a production deployment configuration and must
not be used with `firebase deploy`.

`database.rules.current.json` remains byte-identical to the rules read from the
live Firebase Console Rules editor at the start of this work. Its SHA-256 is
locked by the test suite. A second timestamped copy is kept in the git-ignored
`.firebase-local/` workflow for private/local rollback evidence.

`database.rules.hardened.json` is the commit-2 candidate. The emulator config
loads this candidate while the baseline remains available for exact diff and
rollback review. The candidate is not deployed by this test setup.

The captured deployed rules literally contain `OWNER_USERNAME_PLACEHOLDER`.
That is not a redaction performed by the baseline fixture. The hardened
candidate removes authorization dependence on that value.

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

The hardened tests require UID-bound `authIndex` initialization, immutable
privileged user flags for ordinary users, and `/admins/{uid}` authority for
community writes. Broad authenticated root read behavior remains unchanged and
is still characterized explicitly.

## Emulator-only global identity contract

`database.rules.global-identity.json` and `firebase.global-identity.json` are a
separate, inactive design contract for the trainer-first global app. Run them
with:

```sh
npm run check:global-rules
```

This suite uses only the demo project `demo-pogo-global-identity`. It proves
that all new writes are denied while `globalIdentityConfig/writesEnabled` is
missing or false, then uses an emulator-only enabled state to test UID ownership,
handle uniqueness, contact/list projection allowlists, anonymous point reads,
and admin authority.

**Do not deploy this fixture.** The current root authenticated read grant still
overrides child privacy rules. A named characterization test proves that an
ordinary authenticated user can currently read the proposed private nodes.
No global identity data may be seeded until narrow production reads are live
and that isolation has been verified.
