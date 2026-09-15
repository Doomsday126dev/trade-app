# Google existing-account delivery

Candidate release `2026-09-15.116` continues from accepted production `.115`
(`df20ddbc5a273b8fef0832c4e38b3de86b69a2dd`). This document is the single
approval boundary. Preparing it changes no production provider, function, IAM,
Rules, account, or Pages state.

## Candidate behavior

An authenticated Username/PIN account uses Firebase `linkWithPopup` on its current
user. A later signed-out Google popup is accepted only when the resulting Firebase
UID has either a valid canonical foundation or an authoritative missing-foundation
response followed by the exact healthy reciprocal RTDB pair
`authIndex/{uid}.username` and `users/{username}.authUid`. No email, display name,
avatar, or trainer-name similarity participates in resolution. Missing reciprocal
ownership signs the transient Google session out; account creation, provider public
projection, and provider public writes remain disabled.

Linking captures and rechecks Auth lifecycle, account-sync owner/generation,
listener authority, lists, wants declarations, Favorites, groups, pending journal,
recovery evidence, public identity, and trainer identity. Popup cancellation,
blocking, network failure, credential collision, ambiguous authority, and stale
callbacks fail without switching accounts. Username/PIN stays available while the
Firebase password provider and reciprocal account remain present.

The reset-only compatibility change accepts a migrated legacy account only when its
exact active Firestore account/handle pair, legacy version, password provider, and
absence of conflicts remain unchanged through inspect, reservation, and
postcondition. It does not broaden retired-slot eligibility. Deploying that reset
source is not required by this rollout and is excluded from the operations below.

## Fresh production readback

Read-only inspection on 2026-09-15 found:

- Pages serves `.115`; remote main and release tag resolve to
  `df20ddbc5a273b8fef0832c4e38b3de86b69a2dd`.
- Google and email/password are enabled. Google requests no additional scopes.
  Authorized domains are exactly `localhost`, `trade-list-a4297.firebaseapp.com`,
  `trade-list-a4297.web.app`, and `doomsday126dev.github.io`; no Auth blocking
  trigger is registered.
- The Firebase browser key permits the GitHub Pages origin and Firebase Auth helper
  origin and includes Identity Toolkit, Secure Token, App Check, RTDB, and Firestore.
- Authority service `e1-identity-authority-00061-jbt` is private and grants Run
  invocation only to `e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com`.
  It runs as `e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com`
  with image
  `sha256:19c7574cb89f25cd7ad710941df63bd32ab41e0e7af3ead236c5641e5b8bd753`.
  `READ_ACCOUNT_FOUNDATION_ENABLED=false`; all mutation/public-projection gates,
  Group E, and read-proof mode remain disabled.
- Callable `readE1AccountFoundation` is ready at revision
  `reade1accountfoundation-00057-tuw`, public only at the callable transport, and
  runs as the gateway identity. Its own `GATEWAY_INVOCATION_ENABLED=false`; App
  Check is monitor mode with production debug tokens disabled. The gateway already
  has App Check token-verifier and private-authority invoker authority; no new IAM
  grant is required.
- Its resolved source is
  `gs://gcf-v2-sources-1053781218847-us-central1/readE1AccountFoundation/function-source.zip#1787693692613545`,
  archive SHA-256
  `44510f00ed531bdcfb2d71034c70289e754354aa035897f08fba594aaeaf9f21`.
  All six member hashes match
  `functions/production/e1-gateway-source-manifest.json`, source fingerprint
  `666afda7de8aa299a1281214b8cda4a6c0c9002f3b7c84f2c8e8eaeedc2603d5`,
  commit `129b7ad7dbf33a5bc0126aec20e2412eb08774a1`.
- The deployed authority predates the current nine-field compatibility response.
  It cannot serve migrated legacy foundations to this client. The replacement must
  therefore use the already-reviewed `.115` authority source at commit
  `df20ddbc5a273b8fef0832c4e38b3de86b69a2dd`, complete eleven-file source
  fingerprint
  `516eace167bffa4a51728e11c67fd01d465d72f8cd7ce194fb6282399171c520`.
  This is a demonstrated dependency, not a request to enable creation.
- Existing canary `Doomsday126`, UID
  `YG4BGZk0XQbNQlZoBtovjYOpvkw1`, has exact reciprocal RTDB ownership and active
  Firestore foundation revision 1. Firebase Auth is enabled and currently contains
  both `password` and `google.com`. Access references are
  `authIndex/YG4BGZk0XQbNQlZoBtovjYOpvkw1`, `users/Doomsday126`, and
  `projects/trade-list-a4297/databases/phase-e-identity/documents/accounts/YG4BGZk0XQbNQlZoBtovjYOpvkw1`.
  Credentials remain owner-held and must be entered in a normal browser; no secret
  is copied to source, logs, or this document.

## Consolidated approval package

Approval is for the immutable final PR #96 head and these ordered operations only.
Every preflight must re-read current state and stop on drift. Operation/build IDs
must be persisted immediately; ambiguous calls are inspected and never blindly
repeated.

1. **Merge, but do not release Pages yet.** Require exact-head CI and focused
   security review. The merged `.116` source enables only
   `providerAccountCompatibility`, `googlePublicEntry`, and
   `googleExistingAccountLinking`; `providerAccountCreation`, provider public reads,
   and provider public writes stay false.
2. **Replace the authority inactive.** Stage only the eleven authority files from
   immutable commit `df20ddbc5a273b8fef0832c4e38b3de86b69a2dd`; require fingerprint
   `516eace167bffa4a51728e11c67fd01d465d72f8cd7ce194fb6282399171c520`.
   Build with `e1-authority-builder@trade-list-a4297.iam.gserviceaccount.com`, push
   only to repository `e1-authority`, and deploy service `e1-identity-authority`
   as `e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com`.
   Preserve CPU, memory, concurrency, timeout, max instances, ingress, private IAM,
   database, RTDB target, and operator hashes. Set every operation and publication
   gate false, including `READ_ACCOUNT_FOUNDATION_ENABLED=false`, and keep Group E,
   read proof, client foundation use, and provider-account creation false. Qualify
   staged bytes, build identity, image digest/provenance, ready revision, runtime
   identity, private IAM, and exact environment before continuing.
3. **Enable only the read path.** Patch the qualified authority revision to
   `READ_ACCOUNT_FOUNDATION_ENABLED=true`, retaining its exact image and every other
   setting. Then PATCH only the complete existing environment map of Cloud Function
   `readE1AccountFoundation` so `GATEWAY_INVOCATION_ENABLED=true`; preserve its
   resolved source generation, entry point, builder/runtime identities, resources,
   callable public transport, App Check monitor mode, debug-token false, Group E
   disabled, read proof false, rate-limit policy, and authority URL/audience. A
   Functions v2 configuration update may rebuild; qualify the resulting managed
   source, builder, image provenance, ready revision, runtime identity, IAM, and
   environment before use. No API or IAM change is expected.
4. **Read-only protocol preflight.** With a fresh production Auth and genuine App
   Check token, require the exact nine-field `SUCCESS` response for the canary UID.
   Confirm its canonical trainer name, legacy identity kind, reciprocal RTDB pair,
   and UID without logging identifiers. A missing-foundation fixture may return only
   `FOUNDATION_NOT_INITIALIZED`; unavailable, malformed, frozen, conflicting, or
   mismatched evidence stops.
5. **Human OAuth canary.** Use a normal user-controlled browser at
   `https://doomsday126dev.github.io/trade-app/`; no automation, remote debugging,
   debug App Check provider, token pasting, or lowered reCAPTCHA threshold. First
   verify a clean Username/PIN login for `Doomsday126`, exact UID, provider set, and
   private hashes/counts for lists, wants, Favorites, groups, pending operations,
   recovery evidence, public share, and listener authority. Because this account is
   already Google-linked, verify the required return path first: sign out, choose
   **Continue with Google**, and require the same UID and trainer account. To exercise
   the actual **Connect Google** path, separately verify PIN fallback, unlink only
   `google.com`, sign out/in with PIN, choose **Connect** twice as designed, select
   the same owner-held Google account, and require the same UID. Stop before unlink
   if PIN fallback is not independently proven. Re-test sign-out and fresh Google
   return, popup cancel/block, and a wrong already-linked Google credential; none may
   merge, switch, or mutate product state.
6. **Negative new-identity canary.** In a separate normal profile, a specifically
   approved disposable Google identity may attempt Continue once. It may create a
   transient Firebase Auth record under Firebase's federated sign-in contract, but
   must receive creation-disabled, be signed out, and must not obtain an app account,
   trainer name, RTDB mapping, Firestore foundation, account-sync partition, or
   product data. If zero creation of even an orphan Firebase Auth record is required,
   stop: that requires a separately designed Identity Platform `beforeUserCreated`
   blocking policy. Do not infer or merge by email to avoid it.
7. **Release Pages.** Only after the authority/gateway and human canary pass, run the
   normal guarded Pages release for exact `.116` merge source. Verify deployment
   provenance, HTML/client/service-worker `.116`, Google entry visibility, creation
   and provider-public gates false, a fresh same-UID Google return, PIN login, App
   Check readiness, Saved/account-sync health, current Favorite behavior, and `.115`
   Trainers/Favorites/group-wants presentation.
8. **Rollback.** First restore `.115` Pages or an exact follow-up with the three
   existing-account client capabilities false. Then set the read gateway gate false,
   qualify its resulting revision, and set the authority read gate false. Preserve
   the Google provider (already enabled), linked credentials, all account records,
   Rules, IAM, App Check, and evidence. Never delete an Auth user or rewrite identity
   or product data as rollback.

Real Google popup, helper-origin, browser policy, account ownership, and production
App Check success remain human-canary requirements; emulator/injected tests do not
prove them. PR #97 remains a separate new-account milestone and is not merged,
rebased, deployed, or enabled by this package.
