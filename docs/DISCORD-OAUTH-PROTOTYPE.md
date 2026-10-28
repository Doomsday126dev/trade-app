# Discord OAuth Prototype

## Status

This branch is a source-only, development-only prototype. It is not exported
from `functions/src/index.js`, loaded by `index.html`, listed in the Pages asset
inventory, or cached by the service worker. It has no production Discord
application, OAuth credential, Firebase configuration, endpoint, or release.

This is the rebased successor to PR57, with a required confirmation step. See
[the milestone and pending rollout gates](PROVIDER-MIGRATION-MILESTONE.md).

The prototype uses Discord's authorization-code flow and requests exactly the
`identify` scope. Discord documents the code exchange and recommends validating
`state`; its current-user endpoint returns identity without email when only
`identify` is granted:

- <https://docs.discord.com/developers/topics/oauth2>
- <https://docs.discord.com/developers/resources/user#get-current-user>
- <https://www.rfc-editor.org/rfc/rfc7636.html>

## Topology

```text
browser
  -> POST /__local/discord/oauth/begin
  -> Discord /oauth2/authorize (code, state, S256 PKCE, identify)
  -> exact registered callback
  -> POST /__local/discord/oauth/complete
  -> server-only code exchange
  -> Discord /users/@me
  -> immediate access-token and refresh-token revocation
  -> link: transient identity review, no subject claim
  -> link: explicit POST /__local/discord/oauth/confirm
  -> link: exact-authority check + private atomic subject mapping
  -> sign-in: existing exact mapping -> Firebase custom token
  -> sign-in: unlinked identity -> onboarding-required, no account creation
```

The local HTTP boundary accepts only an exact loopback origin in development.
It binds each flow to a random HTTP-only, `SameSite=Lax` cookie. State and the
server-held PKCE verifier expire after five minutes and are consumed before the
external exchange. A callback replay is rejected even if the first response was
lost.

## Account Contract

Existing-user linking captures and rechecks all of the following before the
atomic subject claim:

- explicit review of the transient Discord username and user confirmation;
- exact Firebase UID;
- exact Auth lifecycle ID;
- exact account-boundary fingerprint;
- recent-auth status.

The private mapping stores only a keyed hash of the Discord snowflake. It never
stores the raw Discord subject, username, email, access token, refresh token,
authorization code, Firebase custom token, or client secret. A reverse subject
claim and the account provider record are committed together. A subject owned
by another UID, or a second subject offered to an already-linked account, fails
without changing either account.

Signed-out login has a separate operation:

- a linked subject mints an ephemeral Firebase custom token for the exact mapped
  UID;
- an unlinked subject returns `onboarding-required`;
- no email, display name, trainer name, or profile field is used to find or
  merge an account.

The browser passes the custom token directly to an injected
`signInWithCustomToken` function. It does not write the token to session
storage, local storage, IndexedDB, account sync, the retry journal, or logs.

## Abuse And Failure Boundary

- Issuer must exactly equal `https://discord.com`; authorization requests use
  `prompt=consent`.
- Begin and completion attempts have separate bounded per-browser windows.
- Request bodies, routes, methods, origins, redirects, and response schemas are
  exact and size-bounded.
- State is request, browser, operation, redirect, authority, and expiry bound.
- PKCE uses a 32-byte verifier and `S256`; `plain` is not supported.
- The Discord token response must contain only the `identify` scope.
- Issued access and refresh tokens are revoked before account mutation,
  including failed identity validation.
- Provider errors return stable reason codes without upstream payloads.
- Audit events contain only an event name and keyed correlation value.
- Link idempotency is fingerprinted; reusing a request ID for different
  evidence is a no-mutation failure.

The in-memory store is intentionally a deterministic test adapter. It is not a
production persistence recommendation.

## Local Verification

No credential or network access is needed:

```sh
npm run test:discord-oauth-prototype
```

The suite injects mock Discord endpoints, an in-memory atomic mapping store,
synthetic account fingerprints, and a custom-token minter. It covers scope,
secret placement, state, PKCE, redirect, expiry, replay, HTTP-only browser
binding, explicit review, cancellation, issuer validation, callback scrubbing,
expiry, lifecycle replacement, collision, idempotency, rate limits, exact-UID
login, onboarding, redaction, and production-runtime isolation.

## Production Requirements

Discord's current [authorization server metadata](https://discord.com/.well-known/oauth-authorization-server)
advertises S256 and issuer identification; its [OIDC discovery](https://discord.com/.well-known/openid-configuration)
also now exists. The older OAuth-only inference must not be treated as current
proof that OIDC is unsupported. A separately reviewed production choice should
compare this custom broker with Firebase OIDC, whose [Firebase documentation](https://firebase.google.com/docs/auth/web/openid-connect)
requires Authentication with Identity Platform. No upgrade or provider setting
has been inspected or changed here. Discovery metadata is not an interoperability
test and does not authorize adding `openid` scope to this identify-only prototype.

Production implementation is intentionally deferred. It requires a separate
review and all of the following:

1. Create a Discord application and register one exact HTTPS callback URI.
2. Store the client secret and subject-hash pepper in a managed server secret
   store; never add either value to Git, Pages, browser configuration, or logs.
3. Replace the local authority resolver with Firebase Admin ID-token
   verification, recent-auth enforcement, App Check where applicable, and the
   accepted account-boundary fingerprint service.
4. Replace the in-memory flow store with a private TTL-backed transactional
   store and a `Secure`, HTTP-only, same-site browser binding.
5. Replace the in-memory subject adapter with a private transactional reverse
   index whose client rules deny all direct access.
6. Inject Firebase Admin `createCustomToken` and prove the token UID is exactly
   the mapped PoGo Trades UID.
7. Add infrastructure rate limiting, abuse monitoring, redacted audit events,
   secret rotation, and failure alerts.
8. Add explicit onboarding UI for unlinked Discord identities and preserve the
   final-usable-access-method unlink rule.
9. Run emulator tests, security review, owner-only canary, rollback proof, and a
   separate release decision before enabling any production row.

No item in this list is performed by this prototype branch.
