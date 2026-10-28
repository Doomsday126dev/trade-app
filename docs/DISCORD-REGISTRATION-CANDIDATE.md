# Default-off Discord registration candidate

The broker can now issue a five-minute server-owned registration review after
an unknown Discord identity passes the existing identify/S256/issuer flow. Both
`registrationEnabled` and the public candidate gateway remain disabled by default.
No production runtime exports or provider settings are changed.

## Protocol

1. A signed-out, App-Checked caller completes OAuth. Existing mapped subjects use
   the existing sign-in path and exact UID; they never get a registration review.
2. With explicit candidate enablement, an unknown subject gets an opaque
   `registrationToken` and expiry. The private review stores only its keyed hash,
   browser binding hash, original request ID, server-random UID, keyed subject,
   expiry and status. No raw subject, email, provider token or profile is stored.
3. `register` accepts exactly registrationToken, requestId, browserBinding,
   lifecycleId, requestedHandle and reviewAccepted. It accepts no UID or provider
   identity from the browser. Explicit review acceptance is required.
4. A private adapter wraps the existing E.1 account-creation transaction. It checks
   the same review inside that transaction, then atomically creates account,
   trainer handle, provider method, reverse subject claim, durable operation
   receipt and completed review. The existing namespace freeze/certification
   guards remain mandatory. A name conflict leaves the review pending, permitting
   another explicit choice; subject/UID conflicts never overwrite existing claims.
5. Only after commit does the broker resolve the mapping, mint a custom token,
   and resolve it again. Every awaited auth boundary still requires signed-out
   authority. Repeated identical confirmation returns the same UID. Changed name
   replay and released/changed provider mappings fail closed. A lost token response
   leaves the claim intact and recoverable by the same review or fresh OAuth.
6. `cancelRegistration` transactionally cancels a pending review. Repeated cancel
   is idempotent. If creation already committed, it reports already-created and
   retains the account. It never deletes identity or product data.

Review expiry is enforced in code. TTL is optional cleanup, never authorization.
A reload may restart OAuth: an already-created identity resolves to its original
UID; an expired uncommitted review cannot create an account. Do not persist custom
or Discord access tokens in browser storage.

## Qualification and remaining integration

The existing store suite covers default-off behavior, explicit consent, browser
binding, expiry, active-account rejection, name conflict and retry, two claims for
one subject, cancellation/confirmation arbitration, namespace protection, replay
and failed token delivery. The Auth/Firestore emulator test proves that the new
Firebase UID does not exist before custom-token sign-in, then verifies that the
created Auth user and ID token use exactly the canonical claim UID.

This is the server candidate. The production browser still has no enabled Discord
signup button. Its current exact-response validator deliberately rejects the new
registration response until reviewed UI/continuation wiring is added. That wiring
must use the existing shared auth commit gate for the exact server-issued UID,
explain current sharing behavior, qualify profile initialization/readback, and
handle cancellation before versus after the non-cancelable SDK boundary.
The existing provider-only foundation reader verifies a linked Google identity;
Discord-only custom-auth users still need a separately verified read adapter that
checks current Firebase Auth authority and the exact durable Discord mapping. Do
not relax the Google verifier or activate registration before that path is ready.
No full-fidelity backup/restore or PIN retirement is claimed.

The selected Discord application and callback already exist. Staging secret
storage/transfer, runtime user-read/signing permissions, TTL policies, deployment
and dedicated canary consent remain separate scoped approvals. Billing restoration
was verified on 2026-10-28; the prior billing-disabled note is obsolete. No secret,
IAM, billing, TTL or live provider activation was performed by this candidate.
