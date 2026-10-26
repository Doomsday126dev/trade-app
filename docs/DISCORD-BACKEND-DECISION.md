# Discord backend decision and next approval target

## Default

Use the **existing Firebase gateway -> private E.1 authority -> private Firestore**
pattern for an `identify`-only Discord authorization-code broker. This is the
implementation default; the owner does not need to select infrastructure.
No new Cloud Run service, account signup, credentials, IAM grant, or deployment
has been created. The candidate gateway is not exported from any runtime.

The browser callback proposal is exactly:

`https://doomsday126dev.github.io/trade-app/auth/discord.html`

This reuses the existing application origin from
`scripts/pages/verify-deployment.cjs`. It is a **proposed new static callback
file**, not a registered or currently working URL. The callback must be built
and separately qualified before registration. It should contain no analytics,
remote images, trainer reads or unrelated application bootstrap. It must scrub
code/state/issuer/error query fields before any asynchronous work, use no-referrer,
and resume only an exact owner/operation/state/expiry-bound continuation. A
popup may message only its exact same-origin opener; full-page fallback must
bind the same session metadata. No provider/custom token may appear in a URL,
storage, logs, screenshots or support output. A local-only callback may use
`http://127.0.0.1:8886/callback` with a separately approved development app.

Read-only Cloud Run API checks on 2026-10-26 confirmed existing targets:

| Environment | Existing private authority |
| --- | --- |
| Staging: `trainer-hub-staging-37ib4wct`, `us-central1` | `https://e1-identity-authority-xxxtepp45q-uc.a.run.app`, generation 19 |
| Production: `trade-list-a4297`, `us-central1` | `https://e1-identity-authority-wrywkbfzya-uc.a.run.app`, generation 73 |

These are private authority targets, **not browser OAuth callbacks**. Browser
requests should traverse a reviewed new operation in the existing gateway
codebase; the gateway verifies origin and App Check, while the private authority
verifies Firebase ID tokens (including revocation), current account/handle
ownership and recent authentication. A new public operation/deployment remains
approval-gated. Never make the private authority public to accommodate OAuth.

## Why not default to OIDC now?

Current [Discord OAuth documentation](https://docs.discord.com/developers/topics/oauth2)
and [authorization metadata](https://discord.com/.well-known/oauth-authorization-server)
support the code grant, S256 and issuer identification. The implementation now
requires `iss=https://discord.com` and `prompt=consent`, and requests only
`identify` for `/users/@me`. [OIDC discovery](https://discord.com/.well-known/openid-configuration)
is also advertised; the old PR57 inference that Discord had no OIDC discovery
is obsolete.

However, [Firebase's OIDC integration](https://firebase.google.com/docs/auth/web/openid-connect)
requires Authentication with Identity Platform plus a configured OIDC provider.
Discovery alone does not establish the required scopes, subject stability,
Firebase interoperability, or the project's current upgrade/configuration.
Read-only requests using the existing saved account to the following endpoints
returned **HTTP 403**, without any change:

- `GET https://identitytoolkit.googleapis.com/admin/v2/projects/trade-list-a4297/config`
- `GET https://identitytoolkit.googleapis.com/admin/v2/projects/trade-list-a4297/oauthIdpConfigs`

No permissions were broadened and no retry bypassed that denial. OIDC remains a
staging comparison if an authorized project operator supplies a sanitized
configuration result or performs the specific read. Do not ask for tokens or
client secrets in chat. The known `identify` broker uses existing infrastructure
and avoids making an unverified Identity Platform upgrade or adding `openid`
scope a prerequisite. If an approved staging interoperability test establishes
that Firebase OIDC is materially simpler, replace the broker decision explicitly;
never infer identity from matching email/profile names during either design.

## Implemented second milestone

`firestoreDiscordOAuthStore.js` implements private durable flows, one-use state,
TTL timestamp fields, shared rate windows, confirmation reviews and operation
receipts. It reads the accepted `accounts/{uid}` and reciprocal
`trainerHandles/{handleKey}` in the same transaction that claims
`accounts/{uid}/providers/discord` and `providerSubjects/{key}`. It never rewrites
an account UID, handle, list, public URL or grant. Missing foundations fail
closed; this code does not automatically migrate a legacy identity.

Provider release writes atomic `unlinked`/`released` tombstones and increments
mapping revisions, so the existing authority runtime needs no delete privilege.
A stale confirmation cannot reconnect a released method. Competing UID claims
produce one owner and a collision. Sign-in resolves the pair again after minting
and before returning a token. Private receipt replay is fingerprinted and
cannot be repurposed for another operation.

`discordAccessAuthority.js` verifies revoked/disabled users, issuer/audience,
recent auth, current password provider and exact reciprocal legacy mapping.
Discord unlink currently requires **recent password authentication** as the
independent fallback. Google-only fallback is deliberately unavailable until a
unified method authority can serialize Google unlink with Discord unlink.
A client boolean or downloaded recovery file is never an access-method proof.

`providerAuthCommitGate.js` uses actual cross-tab Web Locks and Firebase's
[`beforeAuthStateChanged`](https://firebase.google.com/docs/reference/js/auth#beforeauthstatechanged)
blocking hook. The exact Firebase 12.14.0 SDK passes a demo Auth emulator test:
wrong-UID transition is rejected before setting the user, then the exact mapped
UID succeeds. Browser tests exercise actual Web Locks across two tabs.
**All auth mutation entry points must use the gate before enabling the candidate
in the real application.** Unsupported locks fail closed. No localStorage lease
pretends to provide an atomic auth lock. The gate is source-only and not yet
installed in the production bootstrap; Google and PIN keep their existing paths.

The candidate recovery collector reads exact owner legacy/profile/membership/
share paths plus accepted canonical account data, raw local history/preferences,
and one readonly IndexedDB transaction across every journal store. It includes
acknowledged operations, resolved conflicts and reviewed recovery evidence.
A second collection must match before a bundle is created. It refuses unknown
schemas, owner changes, missing stores, unsupported enabled future features,
malformed canonical rows and credential-bearing inputs. The current reader is
for the legacy/canonical feature set; provider-only/visibility/synced-preference
collection still needs a dedicated feature adapter and must not be labeled
complete or silently treated as empty when enabled.

The dry run validates canonical rows with the actual account-sync model,
produces stable additive operation IDs, orders tags before Favorites, requires
exact Favorite target proof and restorable tag references, preserves tombstones
as review evidence, refuses stale/edited plans and makes no writes. Simulated
replay through the actual merge engine is idempotent. Roles, memberships,
share ownership and all other noncanonical sections remain review references.
Cross-UID plans produce no operations and require separately approved server
identity recovery. No automatic new-account migration exists.

## Exact later approval request

Nothing is needed from the user for continued local work. After source review
and a prepared callback/gateway canary, request approval identifying these
specific actions and impacts:

1. In the owner's selected existing Discord developer account, create
   **PoGo Trades Staging** and register only the reviewed callback above;
   request exactly `identify`, with no bot/guild/email/friend/message scope.
   The specific developer account is not selected or logged into here.
2. Provision managed server secret resources for that application's client
   secret and independent versioned state/subject HMAC keys. Inject only into
   the staging private authority. Do not upload secrets through chat, Git or Pages.
   Retain the subject-key version while any mapping depends on it; no blind
   pepper rotation may strand linked users.
3. Approve a narrowly scoped staging authority runtime permission to mint
   Firebase custom tokens. The existing production manifest does not grant
   `iam.serviceAccounts.signBlob`; any grant must name the existing runtime
   identity and exact signing identity. Do not create a service account or grant
   a broad Token Creator role automatically. The verifier also needs the narrow
   `firebaseauth.users.get` capability to check disabled/revoked users; the current
   authority manifest does not grant that capability. Review that exact read
   permission separately, without granting user update/delete privileges.
4. Approve TTL policies on the new private flow/review/rate collections using
   `deleteAfter`, plus the separately reviewed gateway/authority/callback release.
   Logical expiry is enforced even without TTL. Existing deny-all Firestore
   client rules already deny these document families; emulator proof passes.
5. Approve the exact dedicated canary UID for the first persistent Discord
   consent/linkage, then verify same-UID login and product boundary equality.
   Saved username/PIN login authorization is not authorization to create this
   persistent OAuth linkage. No real account was linked in this milestone.

Production activation, broad reminders, provider-first enrollment, cross-UID
recovery, credential removal and PIN retirement remain separate decisions.
