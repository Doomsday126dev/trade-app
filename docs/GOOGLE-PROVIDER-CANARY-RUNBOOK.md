# Google Provider Configuration and Owner Canary

Status: owner-restricted provider preparation. Production remains the accepted
`2026-08-31.86` privacy-notice release, and Google remains publicly hidden.
Google Auth Platform is External/Testing with exactly the owner as its sole test
user. Its web client uses only the reviewed localhost,
Firebase-hosting, and GitHub Pages origins plus the exact Firebase Auth redirect.
The public privacy notice at `?legal=privacy` is deployed and verified on desktop
and mobile without starting Firebase.

## Implemented boundary

- Existing authenticated users connect Google with
  `linkWithPopup(auth.currentUser, new GoogleAuthProvider())`.
- Signed-out Google login is a separate `signInWithPopup(auth, provider)` path.
- The signed-out path opens an existing PoGo Trades account only after the exact
  Firebase UID resolves through `authIndex/{uid}` and is reciprocally confirmed
  by `users/{username}.authUid`.
- A new Google Firebase user enters explicit trainer-handle onboarding. Google
  email, display name, photo, and name similarity never select an account.
- Redirect login is disabled. Popup blocking and cancellation are retryable,
  fail-closed states.
- The adapter requests no additional Google scopes and never returns or stores
  OAuth access or refresh tokens.
- Production UI remains Username/PIN only unless both development gates are set
  before startup:

```js
window.__POGO_PROVIDER_LINKING_DEV__ = true;
window.__POGO_PROVIDER_LINKING_CONFIGURED__ = ['google'];
```

These flags expose the local/canary UI; they do not configure Firebase.
They are client-side visibility gates, not an authorization boundary. Never
rely on them to restrict a publicly deployed provider canary.

## Future cloud configuration

Perform these actions only in the Firebase/Google Cloud project
`trade-list-a4297`, using a separately authorized change window.

1. In Firebase Console, Authentication, Sign-in method, open Google. Set the
   project support email, enable Google, and save. Do not enable another
   provider.
2. In Firebase Authentication, Settings, Authorized domains, retain the current
   legitimate entries and verify these exact hosts are present:
   - `doomsday126dev.github.io` for the application origin
     `https://doomsday126dev.github.io`;
   - `trade-list-a4297.firebaseapp.com` for the configured Firebase Auth helper
     origin and `__/auth/handler` callback.
3. Do not add wildcards. Add `trade-list-a4297.web.app` only if a measured Auth
   flow actually uses that Firebase Hosting host; the current app configuration
   names `trade-list-a4297.firebaseapp.com` as `authDomain`.
4. If Firebase requires an explicit Google OAuth web client rather than its
   managed client, configure the consent screen with the application name,
   support/contact email, and only the identity scopes Firebase requests. Use:
   - authorized JavaScript origin: `https://doomsday126dev.github.io`;
   - authorized redirect URI:
     `https://trade-list-a4297.firebaseapp.com/__/auth/handler`.
5. Never put an OAuth client secret in `index.html`, JavaScript, GitHub, Pages,
   localStorage, IndexedDB, test fixtures, screenshots, or support output.
   Firebase's browser Google flow uses the public web client configuration.
6. Re-read the Firebase authorized domains, Google provider state, OAuth client
   origins/redirects, and existing API-key HTTP-referrer allowlist. The expected
   diff is Google-provider enablement and only any exact missing origin above.

## Owner-only canary

Use an isolated local or unpublished canary build that sets the two development
gates before application bootstrap. Limit Firebase/Google test-user access in
the provider configuration or another server-authoritative boundary during the
canary. Do not publish the gated build or treat a browser variable as owner
authorization.

1. Capture the owner's current Firebase UID and exact fingerprints/counts for My List,
   Favorites, tags, Special Trade Board, public identity, journal generation,
   migration generation, the complete reviewed recovery evidence, and listener
   authority.
2. In Settings, Account & Security, choose **Connect** for Google. Confirm the
   Google popup is on the configured Firebase helper path and requests only the
   normal identity permission.
3. Require the final state **Connected**. Re-read and compare every boundary
   from step 1. UID, trainer identity, all account data, journal/migration state,
   the 66 reviewed `.84` recovery records, and listener authority must be exact.
4. In a separate browser profile, use **Continue with Google**. It must resolve
   the same UID and existing trainer account. It must not create onboarding.
5. Exercise popup cancel and popup block once. Both must leave the current UID,
   account data, and provider ownership unchanged and offer a deliberate retry.
6. Exercise Safari, Chromium, Firefox, and the installed macOS web app. On
   mobile Safari, confirm the browser permits the user-initiated popup. Do not
   switch to redirect if it does not.
7. Reauthenticate with Google, then disconnect Google while Username/PIN is
   still verified. Require the same UID/session and unchanged account boundary;
   only `google.com` may disappear from `providerData`.
8. Reconnect Google and verify Username/PIN still works in a clean browser
   profile. Keep the canary owner-only until this complete sequence passes.

The Firebase Auth emulator cannot faithfully reproduce the real Google popup,
Google credential ownership, browser popup policy, or production OAuth helper
origin. Deterministic injected-adapter tests cover those branches locally; the
owner canary is still required before any production exposure.

## New-user boundary

A Google UID with no reciprocal PoGo Trades mapping may choose and check a
trainer handle in development. A source/emulator candidate now provides the
server-authoritative atomic foundation operation, but account creation remains
disabled until every pre-enable step below receives a separate operator review.
Never create or attach that user through browser-only writes or email matching.

## Provider-only pre-enable procedure

This section defines a future reviewed change window. Do not execute it as part
of source review.

1. Keep `CREATE_PROVIDER_ACCOUNT_ENABLED=false`. Freeze all new legacy
   account/handle provisioning and record the reviewed freeze ID, activation
   time, and exact 64-character provisioning-contract digest. The freeze must
   remain active throughout inventory and canary work.
2. Inventory the complete active legacy namespace after freeze activation.
   Backfill or hold every active handle in Firestore. Re-run the inventory and
   require exact active/certified equality; current production evidence is only
   8 protected out of 58, so it is not eligible.
3. Review candidate Rules and provisioning source, then write the exact schema-1
   `authorityConfig/legacyProvisioningFreeze` record and exact schema-2
   `authorityConfig/providerAccountCreation` certification. Bind the same freeze
   ID and provisioning digest, normalization version 1, 64-character coverage
   digest, post-freeze inventory timestamp, certified count, certification time,
   and short expiry. Extra fields or matching counts with mismatched epoch
   evidence are invalid.
4. Create a dedicated Secret Manager key only in that separately approved task.
   Bind `PROVIDER_SUBJECT_HMAC_KEY` to the exact
   `e1-provider-subject-hmac-key` secret version and set the identical bounded
   numeric `PROVIDER_SUBJECT_HMAC_KEY_VERSION`. Never supply plaintext. An
   inactive authority may omit both values; creation may not be enabled without
   both.
5. Deploy the authority and gateway inactive first. Verify all mutation and
   publication gates remain false, authority IAM remains gateway-only, Google
   remains owner-restricted, and no real provider-only account exists.
6. Run the synthetic canary. Only after exact source, Rules, reconciliation,
   profile hydration, and public-projection evidence passes may an explicitly
   approved owner-controlled disposable canary enable one bounded creation
   window.
7. Disable creation immediately if the freeze is released, certification
   expires, a digest/count changes, HMAC key evidence changes, or any canonical
   readback is incomplete. Preserve evidence for review; never repair by email,
   profile, or handle inference.

For HMAC rotation after accounts exist, first disable creation and retain the
old key. Deploy dual-version read/migration support, migrate every reciprocal
provider record and subject claim with exact readback, then activate the new
version. Remove the old key only after complete verification. There is no
single-key in-place rotation path.

## Rollback

1. Remove the owner-only development flags or revert the canary build first.
2. Disable Google in Firebase Authentication, Sign-in method.
3. Do not unlink existing users, delete Firebase users, move data, or rewrite
   account-sync journals as part of rollback.
4. Preserve the prior authorized-domain and API-key restrictions. Remove an
   added origin only if it was introduced solely for this canary and a live
   browser trace proves it is no longer required.
5. Verify Username/PIN login, exact UID/account mapping, App Check readiness,
   account-sync health, and public projection on the accepted production build.

## References

- [Firebase account linking](https://firebase.google.com/docs/auth/web/account-linking)
- [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase Web Auth API](https://firebase.google.com/docs/reference/js/auth)
