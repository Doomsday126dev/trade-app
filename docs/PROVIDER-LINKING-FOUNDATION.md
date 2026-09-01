# Provider-Linking Foundation

Status: source and test foundation only. Google and Discord are not enabled,
configured, or exposed as production actions. Production remains release
`2026-08-30.84`.

## Baseline accounting

The `.84` installed-app acceptance reported two totals that count different
product surfaces:

| Canonical trade-entry category | Count |
| --- | ---: |
| Active `identity.surface === "my-list"` entries | 58 |
| Active `identity.surface === "special-board"`, `looking-for` | 9 |
| Active `identity.surface === "special-board"`, `for-trade` | 1 |
| Deleted/tombstoned entries among the reported 68 | 0 |
| Inactive-generation entries among the reported 68 | 0 |
| Migration/recovery evidence among the reported 68 | 0 |
| Unexplained entries | 0 |
| **Total canonical trade entries** | **68** |

The 58 visible My List rows and the 10 Special Trade Board rows are projected
to separate UI surfaces. `accountSyncProduct.projectCanonicalState()` routes
both from the same canonical `tradeEntry` collection by `identity.surface`.
The separately reported 66 reviewed `.84` standalone recovery records are
historical recovery evidence, not trade entries, and therefore are not part of
the 68. This accounting requires no deletion, repair, or data mutation.

## Current authentication model

The current sign-in method is Firebase email/password with application-specific
username/PIN presentation. It does not use custom tokens.

```text
trainer username + six-digit PIN
  -> loginDirectory/{username} supplies authVersion/readiness
  -> authEmail(username, authVersion) derives a synthetic, non-mailbox email
  -> Firebase signInWithEmailAndPassword(auth, syntheticEmail, PIN)
  -> Firebase returns the already-bound UID
  -> users/{username}/authUid must equal that UID
  -> authIndex/{uid}/username must equal that username
  -> activateOwnedSession(uid, username)
  -> App Check must become ready
  -> exact owner subscriptions and account-sync runtime attach
```

Source roles:

- `doLogin()` validates the public login-directory entry and signs in with
  `signInWithAuthVersionScan()`.
- `signInWithAuthVersionScan()` tries only bounded synthetic-email versions and
  uses Firebase `signInWithEmailAndPassword()`.
- `syncOwnAuthIndex()` enforces the reciprocal
  `users/{username}.authUid <-> authIndex/{uid}.username` mapping before the
  account is opened.
- `activateOwnedSession()` binds the local cache, journal, public-share
  publication, and subsequent account-sync work to the exact UID and username.
- `onAuthStateChanged()` suspends the owner session, listener, publication, and
  account-sync runtime on sign-out. A same-UID provider-data refresh does not
  reactivate an already-active owner session.
- `updatePassword()` is the current in-session PIN-change mechanism. Firebase
  may require recent authentication. Username/PIN therefore remains an
  application access method backed by Firebase's `password` provider, not a
  separate custom Firebase provider.

The app does not call `setPersistence()`. Firebase's documented browser
default is local persistence, scoped to one origin, which explains reload and
quit/reopen behavior in Safari and the installed web app. Provider work must
not silently change that policy. See [Firebase authentication state
persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).

Firebase `providerData` is the source of truth for Firebase-native linked
providers. Existing accounts currently have the password provider; the UI does
not infer account ownership from provider email, display name, or avatar.

## Identity boundaries

Three identities remain deliberately separate:

1. Trainer identity: handle, public profile, friend code, avatar, and share URL.
2. Authentication identity: username/PIN, future Google, and future Discord.
3. Internal owner identity: Firebase UID.

Linking changes only the authentication methods attached to the existing owner.
It does not import provider profile fields or change trainer/public identity.

## Provider-neutral modules

### `authProviderRegistry.js`

- Defines `username-pin`, `google`, and `discord` in one registry.
- Reads Google linkage from Firebase `providerData` (`google.com`).
- Reserves Discord as a future private provider link.
- Makes only username/PIN visible in production.
- Production rows remain hidden and non-actionable. A development row becomes
  actionable only when both the explicit development flag and its configured
  provider key are present.

### `providerContinuationState.js`

- Stores one minimal continuation in `sessionStorage`, never `localStorage`.
- Binds link/unlink/reauth operations to SHA-256-derived opaque UID and Auth
  lifecycle values; raw UID is not persisted.
- Allows only the Settings security/account return routes.
- Uses a cryptographically random nonce, a maximum ten-minute lifetime, and a
  one-time consumed tombstone.
- Rejects malformed, expired, replayed, wrong-provider, wrong-operation,
  wrong-owner, wrong-lifecycle, and copied-storage continuations.
- A signed-out provider-login continuation intentionally has no UID binding;
  it is still nonce-, operation-, provider-, expiry-, and storage-bound.

### `accountLinkingModel.js`

- Captures exact UID/lifecycle authority and recent-auth state.
- Fingerprints account data, journal owner/generation, migration generation,
  exact recovery evidence plus reviewed/active counts, listener authority,
  public identity, and trainer identity.
- Classifies collisions, cancellation, popup blocking, recent-auth requests,
  and fail-closed errors without exposing raw provider errors.
- Rejects unlinking username/PIN, an absent provider, or the final usable
  method.

### `accountLinkingController.js`

- Existing-user linking calls only an injected adapter's
  `linkCurrentUser()`. It never starts with independent provider sign-in.
- Captures UID, lifecycle, and all account boundaries before provider work,
  then verifies the same values afterward.
- Models popup and redirect linking, signed-out login, reauthentication,
  unlinking, retry, cancellation, and operation leases.
- Accepts an existing-account sign-in result only after Firebase Auth has
  settled on the exact result UID and a valid lifecycle. The application-level
  username/PIN method cannot be routed through a provider adapter.
- Any sign-out, UID change, Auth lifecycle replacement, account boundary
  mutation, or ambiguous provider result fails closed.
- The in-memory shared lease prevents duplicate work among controllers in one
  execution context. A future provider endpoint must also enforce atomic,
  idempotent ownership because a client-only lease is not a cross-device
  authority boundary.

The Google implementation branch adds a development-only adapter and action.
Ordinary production startup still skips those modules and controls.

## Existing-user link contract

```text
authenticated username/PIN user
  -> capture current UID + Auth lifecycle + account boundary
  -> provider adapter links credential to auth.currentUser
  -> require result UID === captured UID
  -> require current Auth UID/lifecycle still match
  -> require every account boundary fingerprint unchanged
  -> expose provider as connected
```

Firebase documents `linkWithPopup(auth.currentUser, provider)` and
`linkWithRedirect(auth.currentUser, provider)` for this purpose. The future
Google adapter must use those linking APIs, not `signInWithPopup()` or
`signInWithRedirect()`, for an authenticated user's Connect action. See
[Firebase account linking](https://firebase.google.com/docs/auth/web/account-linking).

## Signed-out sign-in and onboarding

Signed-out provider sign-in is a separate controller operation:

- An already-linked provider may resolve an existing Firebase account.
- An unlinked provider result enters explicit new-account onboarding.
- Email, display name, avatar, or trainer-name resemblance never attaches the
  result to an existing account.
- A provider display name is not copied into trainer identity.

The future UI and adapter must keep `link` and `sign-in` entry points distinct
in code, analytics, continuation state, and copy.

## Collision and future merge

If a provider credential belongs to UID B while UID A is attempting to link,
the operation ends in `provider-link/collision`. Neither provider ownership nor
either account dataset changes. The app must not unlink B, copy data, replace
UID A, or use email equality as proof.

A later explicit merge is a separate privileged workflow and must:

1. Require recent reauthentication and proof of control for both accounts.
2. Freeze both mutation streams and capture complete immutable inventories.
3. Show informed consent and require explicit surviving-UID selection.
4. Inventory My List, Special Trade Board, Favorites, tags, journal entries,
   entity generations, tombstones, unresolved/reviewed recovery evidence,
   trainer handle ownership, public share identity, preferences, and provider
   methods for both UIDs.
5. Plan a record-wise account-sync merge. Independent entities merge by stable
   identity; tombstones and field generations retain their conflict semantics;
   incompatible same-field values become explicit conflicts.
6. Resolve trainer-handle and public-share ownership explicitly. Provider
   profile data is never the winner by default.
7. Write auditable rollback evidence before any canonical mutation.
8. Apply one server-authoritative, idempotent transaction or resumable staged
   operation with exact source/target versions.
9. Re-read and verify the complete surviving account, provider mappings, public
   projection, and absence of orphaned ownership.
10. Disable or delete the losing Auth user only after exact verification and a
    rollback window. No client may perform this operation directly.

No merge implementation or production data movement is part of this phase.

## Unlink and recent authentication

Username/PIN is a usable access method while its Firebase password credential
and reciprocal UID mapping remain valid. An external provider may be unlinked
only when:

- it is currently linked;
- another verified usable method remains;
- the current Auth session is recent;
- UID and lifecycle still match the captured operation;
- the account boundary is unchanged afterward.

Unlinking the protected username/PIN method, the final method, an absent
provider, a stale session, or a replay is rejected. The future UI must not add
an active Disconnect button until a provider-specific adapter and recent-auth
flow have passed these contracts.

## Popup, redirect, and PWA continuation

Firebase recommends popup or redirect linking, with redirect often useful on
mobile. Modern browser storage partitioning changes the practical choice:
Safari 16.1+, Firefox 109+, and Chrome M115+ require one of Firebase's supported
redirect strategies when the application is hosted outside Firebase Hosting.
GitHub Pages cannot transparently proxy Firebase helper paths by itself. See
[Firebase redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices).

Foundation policy:

- Prefer popup for the first Google owner canary because it works with the
  current GitHub Pages topology and keeps the linking result in one lifecycle.
- Treat popup cancellation and blocking as explicit retryable states.
- Do not silently fall back to redirect until one documented strategy is
  implemented and tested: a supported same-origin helper/proxy, a deliberately
  hosted helper, or independent provider credential handling.
- If redirect is later enabled, issue continuation immediately before leaving
  and consume it exactly once after Firebase resolves the provider result.
- Test desktop Safari, mobile Safari, installed macOS web app, Chromium, and
  Firefox. A copied continuation in a distinct storage context must fail.

## Account-sync coordination

A provider-data change for the current UID is not a new account lifecycle.
`onAuthStateChanged()` now checks the active session-cache owner before calling
`activateOwnedSession()`. If UID and username are already active, it preserves:

- IndexedDB owner partition;
- account-sync journal owner and generation;
- migration generation and the 66 reviewed inactive `.84` evidence records;
- healthy listener authority;
- My List, Favorites, tags, and Special Trade Board;
- public-share publication token and trainer identity.

Initial load and a true Auth/account replacement still take the full activation
path. This distinction prevents providerData callbacks from rerunning migration,
republishing stale local state, or reactivating reviewed evidence.

Provider onboarding validates and normalizes optional profile values before the
identity request is dispatched. The normalized value is an in-memory handoff,
not continuation storage. Once a profile edit enters
`provider-profile-pending-v1`, its retry evidence is durable only inside that
device's owner-partitioned IndexedDB. A different device reads canonical profile
state; it cannot inherit another device's pending journal. If canonical revision
advances first, canonical wins and the stale local pending record is cleared
without an unbounded retry loop.

## Connected Accounts UI

Settings includes a provider-neutral Connected Accounts section. Production
renders only:

```text
Username and PIN    Connected
```

Google and Discord rows are hidden unless an explicit provider capability
requires them. Existing-account compatibility, public Google entry, existing
account linking, account creation, public reads, and public writes are separate
gates. Provider implementation modules are skipped by the ordinary feature
loader unless an interactive provider capability requires them, preserving the
production startup budget. Even
then the rows have no button and remain non-actionable. State labels cover
Connected, Not connected, Connecting, Waiting for browser, Needs attention,
Reauthenticate, Disconnecting, and Unavailable. Copy is localized in English,
Japanese, Spanish, and German. The surface displays neither Firebase provider
IDs nor UID/raw errors.

## Privacy and metadata

- Google requests only authentication identity. No Drive, contacts, or other
  Google API scope is planned.
- Discord requests only `identify`. Discord documents that this is sufficient
  for basic identity and does not include email; the separate `email` scope is
  unnecessary. See [Discord User Resource](https://docs.discord.com/developers/resources/user).
- No provider access token, refresh token, OAuth code, Firebase token, client
  secret, PIN, raw UID, provider email, or profile payload is stored in the
  account profile, account-sync state, continuation URL, localStorage, log, or
  fixture.
- Firebase `providerData` remains the source of truth for Firebase-native
  methods. A Discord subject mapping, if implemented, is private
  server-authoritative ownership metadata rather than a user-editable duplicate.

## Google implementation readiness

### Mechanism

Create a provider-specific browser adapter around Firebase
`GoogleAuthProvider`, `linkWithPopup`, `linkWithRedirect`,
`signInWithPopup`, `signInWithRedirect`, and redirect-result recovery. Existing
users call the link APIs on `auth.currentUser`; signed-out users call the sign-in
APIs. Do not request extra Google scopes. See [Firebase Google
sign-in](https://firebase.google.com/docs/auth/web/google-signin).

### Source work

1. Add a lazy `googleAuthAdapter.js` loaded only after an enabled action.
2. Extend the Firebase Auth lazy import with only the required provider APIs.
3. Instantiate the neutral controller only when the owner-canary gate is open.
4. Bind sanitized controller states to Connected Accounts buttons/copy.
5. Keep all same-UID and account-boundary checks in the neutral controller.

### Future console and human actions

1. Confirm exact project `trade-list-a4297` and the existing web app.
2. Enable Google as a Firebase Auth sign-in provider; do not enable another
   provider or alter email/password.
3. Confirm the production GitHub Pages host is in Firebase Auth authorized
   domains and the existing browser API-key referrer restriction remains exact.
4. Confirm the Google OAuth client/redirect configuration created or selected
   by Firebase. Do not create extra clients without evidence they are needed.
5. Choose and implement a compliant redirect topology before enabling redirect;
   otherwise keep owner canary popup-only.
6. Enable the feature for the owner only, not globally.

### Test and canary sequence

1. Auth emulator/unit adapter: same UID, already-linked, collision, cancellation,
   blocked popup, recent auth, unlink safety, and signed-out existing/new paths.
2. Local browser tests: desktop/mobile/PWA state and no eager signed-out load.
3. Owner-only link: record UID and all account fingerprints before/after.
4. Sign out and sign back in with Google; require the same UID and complete
   product convergence.
5. Exercise a separate disposable collision account; require no mutation.
6. Verify username/PIN still signs into the same UID.
7. Remove the owner gate only in a separately reviewed release.

Rollback is to disable the client gate immediately. If a canary was safely
linked, leaving the credential attached while hiding the entry point is the
least disruptive rollback. Unlink only through the verified unlink flow; never
delete or recreate the account to roll back UI exposure.

## Discord implementation readiness

Discord documents OAuth2 authorization-code exchange, a recommended `state`
check, and a client secret at the token endpoint. See [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2)
and [OAuth2 and permissions](https://docs.discord.com/developers/platform/oauth2-and-permissions).

### Option A: Identity Platform generic OIDC

- Client: Firebase `OAuthProvider('oidc...')` popup/redirect.
- Backend: Identity Platform handles exchange.
- Secret: Identity Platform provider configuration.
- Redirect: `https://trade-list-a4297.firebaseapp.com/__/auth/handler` plus the
  browser-hosting considerations above.
- UID preservation: Firebase link API on current user.
- Limitation: Identity Platform requires OIDC discovery and OIDC-compliant
  provider behavior. Discord's official docs describe OAuth2, not an OIDC
  discovery issuer/ID-token flow. Therefore incompatibility is the current
  evidence-based inference, and this option is not recommended unless Discord
  publishes compatible OIDC metadata. See [Identity Platform OIDC
  requirements](https://docs.cloud.google.com/identity-platform/docs/web/oidc).

### Option B: server-side Discord code exchange and Firebase custom token

- Client: open Discord authorization with `response_type=code`, minimum
  `identify` scope, exact redirect URI, random state, and short-lived operation.
- Backend: exchange code at Discord's token endpoint, call `/users/@me`, claim
  the Discord subject atomically, and mint a Firebase custom token for the exact
  mapped UID.
- Secret: managed server secret only; never browser source, repository, or
  Firebase client data.
- Existing-user link: authenticate the request with Firebase ID token and App
  Check, require recent auth, bind state to current UID, and atomically reject a
  subject owned by another UID. The operation must not sign the browser into a
  second account while linking.
- Signed-out login: resolve the private subject mapping and mint for that exact
  UID; an unknown subject enters onboarding without email matching.
- Token lifecycle: use access token only long enough to read `/users/@me`; do
  not retain access/refresh tokens unless a later reviewed requirement demands
  it. Revoke on unlink when applicable.
- Cost/security: requires a small trusted endpoint, secret management, App
  Check/ID-token verification, rate limits, replay protection, atomic subject
  ownership, redacted observability, and least-privilege token-signing IAM.
- Browser/PWA: first-party state/continuation is independent of Firebase's
  cross-origin redirect helper, but every Safari/PWA return path still needs
  explicit testing.
- Custom tokens must be server-created for the selected UID. See [Firebase
  custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

### Option C: browser implicit grant/direct token handling

- Client receives a provider token in the browser/URL fragment.
- Backend burden may appear smaller, but subject ownership and Firebase UID
  minting still require trusted authority.
- Token exposure, refresh, replay, and recovery risks are worse.
- This option is rejected.

Recommendation: Option B. It matches Discord's documented authorization-code
flow, keeps the client secret server-side, permits exact subject-to-UID collision
control, and can preserve the existing Firebase UID. It must be implemented as
a separately reviewed backend/provider phase; no endpoint, secret, provider
application, IAM, or deployment is created here.

Discord rollback is to disable the client gate and authorization endpoint while
leaving existing Firebase/account ownership untouched. Subject unlinking or
mapping repair must be explicit, recent-authenticated, atomic, and separately
audited.

## Focused security review

| Threat | Foundation response |
| --- | --- |
| Independent sign-in during existing-user link | Adapter contract exposes `linkCurrentUser`; controller captures the current authority first |
| Silent UID/lifecycle switch | Result, live authority, and lifecycle must all match |
| Automatic email/profile merge | No email/display/avatar inputs participate in ownership |
| Replayable redirect | Random nonce, ten-minute maximum, storage owner, exact bindings, one-time tombstone |
| Token/secret leakage | Strict continuation schema and secret-absence tests |
| Unlink lockout | Protected username/PIN and final-method rejection, plus recent auth |
| Cross-owner attachment | Opaque owner/lifecycle binding and account boundary checks |
| Migration/recovery rerun | Same active UID skips redundant session activation; reviewed evidence count remains stable |
| Public identity overwrite | Public/trainer fingerprints are before/after invariants |
| Premature provider exposure | Production registry hides Google/Discord and has no adapter/action |
| Two-context race | Shared client lease for local coordination; future trusted endpoint remains the atomic authority |

Five concrete defects found during implementation and review were corrected:

1. Username/PIN reauthentication was initially excluded by the provider
   availability guard.
2. Sign-out during an in-flight operation could preserve a provider error
   instead of the authoritative lifecycle-change failure.
3. An existing-account provider sign-in result was not independently checked
   against the Firebase Auth UID/lifecycle that actually settled, and the
   application-level username/PIN key could reach that adapter path.
4. A continuation remained valid at the exact expiry millisecond instead of
   expiring at that boundary.
5. The provider modules were initially evaluated on every signed-in feature
   activation even though no provider feature was enabled.

Regression tests cover each correction. No production adapter or provider
action exists.

## Validation boundary

The deterministic suite uses two populated UID fixtures and a faithful injected
adapter for behaviors that an unconfigured OAuth provider or Firebase Auth
emulator cannot express. It proves the client/domain contract, not live Google
or Discord behavior. A future provider phase must repeat provider-specific
tests against configured development/emulator infrastructure and then an
owner-only canary.

## Roadmap

```text
GOOGLE LOGIN/LINKING
  -> DISCORD LOGIN/LINKING
  -> PUBLIC-BETA READINESS
  -> BROADER PUBLIC BETA
```

Each arrow is a separate review, configuration, security, and rollback
checkpoint. This foundation does not begin any of them in production.
