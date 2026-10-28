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

The browser/read candidate integration is described below. The production browser
still has no enabled Discord signup button. Production host bootstrap, profile
initialization/readback and release configuration need staging qualification.
The Google foundation verifier remains unchanged; the separate Discord read
adapter verifies current Firebase Auth authority and the exact durable mapping.
No full-fidelity backup/restore or PIN retirement is claimed.

The selected Discord application and callback already exist. Staging secret
storage/transfer, runtime user-read/signing permissions, TTL policies, deployment
and dedicated canary consent remain separate scoped approvals. Billing restoration
was verified on 2026-10-28; the prior billing-disabled note is obsolete. No secret,
IAM, billing, TTL or live provider activation was performed by this candidate.

## Browser and authenticated-read integration, 2026-10-28

The candidate client/runtime now accept the server registration review and expose
confirmRegistration, cancelRegistration and readAccount. Review capabilities stay
in memory; reload requires a fresh OAuth flow. The server then resolves an already
committed account to the same UID. An uncertain confirmation retains the reviewed
name for exact retry; a definite name conflict permits a new explicit choice.
Custom tokens pass directly into the shared auth gate. Cancellation before the
commit discards late responses; after its non-cancelable boundary the UI says
sign-in is finishing. A pending server claim may still complete; cancellation
never pretends to delete it.

`discordRegistrationView` is a candidate-only accessible DOM mount using the
existing field-control/btn/card classes, with trainer-name and sharing review,
explicit consent and status text. It contains no Updates or catalogue edits and
is absent from production asset inventories. Production signup remains disabled.

The fixed candidate readAccount route accepts no owner UID. It verifies a revoked-
checked Firebase ID token, current user, issuer/audience, expiry and token-validity
cutoff; regular reads do not require recent reauthentication. It then rechecks the
reciprocal account/name and Discord method/subject claim transactionally. Legacy
accounts still require reciprocal legacy ownership. It returns only the canonical
foundation allowlist; the browser validates that exact schema. Google verification
is unchanged. Unlink and recent-auth requirements remain unchanged.

### Exact remaining activation decisions

- Provision the three previously proposed staging secret resources (Discord
  application client secret, state HMAC key, subject HMAC key); transfer only via
  an approved private secret path. Existing app 1564289039526268938 and registered
  callback need no duplicate creation. Scope remains identify only.
- Approve named runtime firebaseauth.users.get and narrowly scoped signing access
  on the existing staging authority/signing identity. Runtime composition must
  mint a newly claimed UID only after the registration transaction; the existing
  access-authority mintCustomToken helper requires an existing Auth user and is
  insufficient for first sign-in. Synthetic tests inject Admin createCustomToken
  and prove its Auth creation boundary; no cloud composition is activated.
- Review namespace protection and fresh certification, the new fixed gateway
  operations, callback asset release and all-entry-point auth-gate bootstrap.
  The canary gate remains exact-UID restricted; broad provider-first enrollment
  needs a reviewed host policy for server-issued new UIDs.
- Select dedicated staging canary identities and approve their persistent OAuth
  consent/linkage; qualify service configuration and deploy only after approval.
- TTL cleanup would add discordRegistrationReviews.deleteAfter to the earlier
  flow/review/rate collection proposal. Logical expiry already fails closed;
  TTL is cleanup and may be deferred to avoid an unnecessary permission change.
- Activate staging capability flags only after end-to-end callback, account-sync
  profile initialization, sharing/public-read behavior and rollback are reviewed.
  This candidate does not connect its read adapter to production application.js.

### Backup and PIN-migration gaps

The existing recovery writer remains demo-only, additive and same-UID. It does not
constitute full-fidelity migration to a new account. Legacy-only content, profile,
ordering/history/preferences and enabled future provider-only/visibility/synced-
preference collectors need dedicated supported adapters. Groups, memberships,
permissions and share ownership are review references, not imported privileges.
Cross-UID restore requires a separate server-authorized recovery protocol. Never
infer authority from an uploaded bundle. PIN removal remains blocked until these
coverage gaps and real account readback/recovery are qualified. Linking should
retain the original UID, lists, Favorites, tags, URLs and permissions.
