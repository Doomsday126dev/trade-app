# Google existing-account delivery

Source continuation from main `07ee65bb6f20b0c009098489171bd01909cd0d3c`, release
`2026-09-08.103`. No merge, deployment, provider configuration, namespace operation
or real account mutation is part of this change. The .103 product UI is retained.

## Reused implementation and completed source path

PRs #54/#55 supply the provider registry, operation lease, two-click popup link,
Firebase Google adapter, same-UID and account-boundary checks, collision/cancel
handling, continuation privacy, and unlink protection. PRs #61/#62 supply canonical
identity reads, separate provider-only creation, UID-rooted profile/sync and public
projection. The later PIN reset, immutable binding, obsolete UID and publication
session fences remain in place. No old PR is rebased or deployed.

The current-source regression was a `legacy-migration-required` rejection after a
successful canonical **missing** response and exact reciprocal legacy mapping.
Returning Google login now accepts that healthy existing account without writing a
foundation. A migrated account still requires its canonical foundation and exact
legacy reciprocity. A provider-only account still requires the validated canonical
provider identity and never acquires a synthetic PIN or legacy mapping. Canonical
read failure, malformed/frozen identity, mismatched UID/name and lifecycle drift
fail closed; none becomes an onboarding or legacy fallback.

The link operation remains `linkWithPopup(currentUser, provider)`. Signed-out login
remains a separate `signInWithPopup` operation. Link fingerprints now include current
wants declarations and special requirements as well as lists, Favorites/Groups,
canonical entities, journal/migration generation, recovery evidence, public and
trainer identity, and listener authority. The controller rechecks Auth after its
asynchronous post-link snapshot. Restoring persistence does not fabricate a recent
reauthentication timestamp. Failed account resolution releases only that attempt's
Google session, leaving a fresh explicit retry possible.

PIN transition corrections were reproduced before changing source:

- Reconnect used the old cached verifier even after a same-UID admin password reset.
  Bound-account reconnect now asks Firebase to validate the current credential.
- A cached verifier alone advertised PIN availability after the password provider
  was absent. Settings/unlink now also require the current password provider.
- The reset adapter rejected every canonical account. A separate reset-only evidence
  check now accepts an exact active migrated legacy account/handle pair with matching
  legacy version and no conflict. Its full evidence digest is bound to inspect,
  reservation and postcondition. Provider-only, retired-access, held, conflicting and
  incomplete identities remain blocked. The obsolete-slot `legacyOnly` check is
  unchanged. Reset still updates only the existing Auth password, never identity,
  Google linkage, product data or recovery records.

## Fresh baseline evidence

Remote main and the public `js/domain/clientRelease.js` both matched .103 during
this task. Read-only deployment metadata returned:

- Authority `e1-identity-authority-00061-jbt`, URL
  `https://e1-identity-authority-wrywkbfzya-uc.a.run.app`, runtime identity
  `e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com`.
- Only `readE1AccountFoundation`, `reserveE1TrainerHandle`, and `ownerResetLegacyPin`
  were listed as active Gen 2 functions.
- `READ_ACCOUNT_FOUNDATION_ENABLED=false`; all listed authority mutation gates and
  `CLIENT_FOUNDATION_USE_ENABLED` were false; Group E disabled; read proof false.
- Firebase config read at `2026-09-09T01:21:34Z`: Google already enabled, email/password
  enabled, no blocking-function events configured. Authorized domains were
  `localhost`, `trade-list-a4297.firebaseapp.com`, `trade-list-a4297.web.app`, and
  `doomsday126dev.github.io`. Google client ID was
  `1053781218847-grqh9ndhfgqso7n44ro0gsls0sl0l3on.apps.googleusercontent.com`.

OAuth consent audience/testers, OAuth origins/redirects and API-key referrers have
not been freshly verified. No historical screenshot or owner canary substitutes
for that readback. Google Testing mode with only basic identity scopes permits users
outside the test-user list; it is not an owner-only enforcement boundary.
[Google's current audience guidance](https://support.google.com/cloud/answer/15549945?hl=en)

## Smallest next approval: bounded existing-account canary

After review/green exact-head CI **and closure of the parallel security findings**,
request one source-pinned, isolated canary window for explicitly authorized existing
accounts. Do not use the authority deployment helper under security remediation.
The approval must bind the reviewed source/package, existing revision rollback,
canary accounts (private UID evidence), origin, duration and final provider state.
This task requests no automatic execution or approval consumption.

1. Deploy/verify compatible read-only authority and the existing read gateway from
   reviewed immutable source. Enable only `READ_ACCOUNT_FOUNDATION_ENABLED=true`
   and the read gateway's `GATEWAY_INVOCATION_ENABLED=true`. Retain all identity
   mutation/public projection gates false, existing least-privilege identities,
   App Check requirement, rate-limit policy and gateway-only authority invocation.
   Respect the current gateway contract (`APP_CHECK_ENFORCEMENT_MODE=monitor`,
   debug tokens false); the operation itself requires a verified App Check app.
   Do not silently relax guards to deploy. Verify exact SUCCESS and MISSING response
   schemas using approved canary UIDs before a Google account change. This allows
   authenticated own-account reads and bounded rate-limit receipts, not account
   creation or migration. No provider-subject secret is needed for legacy reads.
2. If the canary includes migrated-account reset, deploy the reviewed isolated reset
   package preserving its current permissions, journal and secret. This expands
   eligibility only to the proven reciprocal legacy pair; it performs no reset by
   deployment. An owner reset is a separately enumerated canary action.
3. Reuse the already-enabled Google provider; enable no additional provider. Verify
   the exact OAuth origin `https://doomsday126dev.github.io` and callback
   `https://trade-list-a4297.firebaseapp.com/__/auth/handler`. For a local canary,
   specify one approved localhost port and its exact OAuth origin/API-key referrer
   and App Check setup separately. Keep all legitimate prior restrictions. Do not
   change OAuth client/secret, authorized domains, Rules or IAM by assumption.
   [Firebase Google setup](https://firebase.google.com/docs/auth/web/google-signin)
4. The isolated canary build requests only:

   ```js
   window.__POGO_PROVIDER_CAPABILITIES__ = {
     providerAccountCompatibility: true,
     googlePublicEntry: true,
     googleExistingAccountLinking: true,
     providerAccountCreation: false,
     providerPublicReadSupport: false,
     providerPublicWriteSupport: false
   };
   ```

   Public Pages stays .103 with its default gates. Browser flags are visibility
   controls, not admission authority. This is an authorized-account test, **not**
   a claim that the existing Google configuration excludes everyone else. If hard
   owner-only admission is required, separately qualify a server admission control
   before the canary; Firebase blocking functions require Identity Platform and
   also run when linking providers.
   [Firebase blocking-function constraints](https://firebase.google.com/docs/auth/extend-with-blocking-functions)
5. Capture private exact UID/identity and data fingerprints before link. Test current
   PIN login → Connect Google → fresh second click → fresh Google login in another
   browser profile → exact same account. Cover unmigrated and migrated healthy
   fixtures/accounts where authorized; preserve wants/special requirements, Groups,
   Favorites, public ownership, Saved sync, and reviewed/active recovery evidence.
   Cover cancel, popup block, collision, offline read, sign-out/session replacement,
   Google reauthentication and PIN fallback. Unlink/relink only if explicitly
   included in the canary approval and the alternative method was verified first.
   [Firebase's same-UID linking contract](https://firebase.google.com/docs/auth/web/account-linking)
6. Exercise Safari, Chromium, Firefox, mobile Safari/Chrome and installed PWA with
   authorized accounts. Emulator/injected tests cannot establish popup, mobile/PWA,
   OAuth-helper, credential-ownership or real browser-policy success. No redirect
   fallback is introduced. Record failure and keep public rollout gated if a
   supported surface cannot complete this exact flow.
7. Close out added local-only configuration and compare the exact intended diff.
   Preserve linked credentials and every account record. Hiding public entry is
   reversible; do not disable Google or remove a credential on which a canary
   account now depends. Public release/enablement requires a subsequent approval.

## Focused verification

- Google foundation suite: 108 passing before the additional lifecycle regression;
  final exact-head CI supplies the complete changed-area result.
- Transition application regressions: 11 passing, including actual extracted
  resolver/activation/reconnect code, canonical vs legacy paths, and stale sessions.
- Isolated reset package: 77 passing including 10 migrated-provider transition cases.
- Auth/RTDB emulator: 24 Rules/identity tests and 2 reset/sync tests pass. The synthetic
  Google-linked fixture returns the same UID before/after reset, retains providerData,
  rejects the old PIN and accepts the new PIN. This is not a real OAuth result.
- Auth/Firestore emulator: all 32 foundation/namespace/hold/race tests pass.
- Focused desktop/mobile Chromium Google-entry and reset UI: 10 passing (injected Auth).
- Firebase read inventory reviewed: two duplicate branch sites consolidated into one
  reciprocal path (23 direct reads total); no startup read added.

No archives are read as authentication or ownership authority. No ordinary users
are migrated, no PINs removed, and no accounts deleted.
