# Review corrections and exact staging readiness

2026-10-28 follow-up to PR173 head d985c87. Default-off source only. No setup,
credentials, IAM, API, TTL, OAuth grant, deployment or production write occurred.

## Confirmed defects closed locally

1. Registration creation read the clock separately for `createdAt` and
   `bootstrapExpiresAt`, then validated their exact five-minute difference.
   The 1-ms advancing-clock regression failed on the reviewed source with
   `discord/registration_claim_invalid` after the canonical account committed.
   Creation now uses one captured timestamp; bootstrap authorization likewise
   uses one observation for its deadline and first-mint timestamp. The regression
   checks actual committed claim/account/handle/subject state, lost mint response,
   exact-UID replay, activation and returning mint. A boundary test accepts the
   last valid observation and rejects expiry without mutating the claim.
2. A completed Google signup remained in the global pending-operation API and
   blocked a different UID after logout/reload. Terminal receipts are now retained
   as evidence but excluded from `pending()` and `pendingForCurrentOwner()`.
   Explicit same-owner completed reconciliation still validates the fingerprint
   and current authoritative foundation. It never turns a terminal receipt back
   into an ambiguous request. Native browser localStorage/reload tests prove
   signup A then signup B works, while another owner's ambiguous/dispatched
   request remains unchanged, blocks dispatch and is never blindly retried.

## Actual host checkpoint recovery

The application SDK installer now supplies the real default-off verifier, rather
than requiring tests to inject an acceptance predicate. For a signed-in session
it forces a fresh Firebase SDK ID token, checks UID/project/issuer/expiry, then
performs Firebase Auth `accounts:lookup` with that token and verifies the returned
UID, disabled state and `validSince`. Token transport is limited to the official
Firebase endpoint, or explicit loopback Auth emulation for demo projects. Tokens
are not persisted or returned as recovery evidence. No Firebase admin config
endpoint is read, and no new OAuth grant is created.

The explicit review UI prepares evidence, shows the recorded operation/current
session and requires acknowledgement before reconciliation. The existing gate
still checks its durable completed outcome under the Web Lock before and after
fresh verification, and does not reset unknown outcomes. Signed-out verification
means SDK absence plus a matching completed sign-out receipt; it is not server
revocation of every previously issued token. The real pinned SDK/emulator test
runs the application's actual installer for both sign-in and sign-out recovery.
The UI is not mounted automatically; the canary-only host mount closes at session
boundaries. All required candidate modules must be provided by reviewed staging
bootstrap before the SDK is loaded. The normal production loader remains off.

## Delayed token exchange remains an explicit exception

A custom token minted inside the five-minute bootstrap window may still be valid
when Firebase exchanges it later. If Firebase creates the user after the private
claim's `bootstrapExpiresAt`, the trainer authority currently rejects activation,
even when the ID token is valid. A real demo Auth exchange test models this delay
with an injected authority clock, verifies Firebase success, then verifies app
activation refusal, retained pending claim and unchanged canonical ownership.

Authenticated readback can finish activation only when the actual Firebase user
was created within the original bootstrap window. It is not unconditional
recovery. The candidate UI preserves the signed-in result, stops the retry loop
and requests support review; it never advises creating a replacement account.
No extension/reset, reassignment or privileged recovery is implemented. The owner
must approve a finite support response for this exception before public signup.

## Remaining gates

Use [the finite checklist](PROVIDER-SIGNUP-LINKING-ACCEPTANCE.md). Required now:
independent review of these corrections; specifically approved staging secrets/
permissions; fresh namespace certification; named canary consent; exact staging
bootstrap/release and end-to-end proof. Google/Discord activation and production
release remain separate scoped decisions. Large cross-UID restore, inaccessible
source-account recovery and PIN retirement remain later requirements, not new
blockers to ordinary signup or same-UID linking.
