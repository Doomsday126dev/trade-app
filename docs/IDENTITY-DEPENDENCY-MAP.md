# Identity Dependency Map

Status: source architecture candidate, based on `0e916bee160259500a37c39f1098ce992a988043` (`2026-08-31.86`). No production Rules, IAM, provider, or data mutation is authorized by this document.

## Classification

- `KEEP - LEGACY USERNAME/PIN ONLY`: retained for existing Username/PIN access and compatibility.
- `MIGRATE TO FIRESTORE IDENTITY`: canonical ownership moves to the E.1 named Firestore database.
- `MIGRATE TO UID-ROOTED DATA`: product state is owned by the verified Firebase UID.
- `REPLACE WITH FIXED GATEWAY READ`: clients receive a bounded result rather than identity metadata.
- `REMOVE AFTER COMPATIBILITY WINDOW`: retained only while old clients or URLs require it.

## Identity and product dependencies

| Exact path | Current readers | Current writers | Authorization | Product purpose | Provider-only target | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| RTDB `authIndex/{uid}` | Username/PIN login and session recovery; legacy Google binding; rules for offers, trades, and pending decrements; admin and migration audits; E.1 legacy verifier | Existing self-initialization and protected admin/member tooling | Exact owner/admin RTDB Rules; E.1 reads with the caller's Firebase token | Reciprocal legacy UID-to-username evidence | Never created or required for a new provider-only account | KEEP - LEGACY USERNAME/PIN ONLY |
| RTDB `loginDirectory/{username}` | Anonymous login/discovery/autocomplete; admin/member tooling; migration and collision audits; E.1 legacy verifier | Protected admin/member provisioning and legacy metadata refresh | Public read; protected admin write | Legacy login namespace and public trainer discovery | Firestore `trainerHandles/{handleKey}` is canonical; public exact lookup moves behind a fixed gateway | REPLACE WITH FIXED GATEWAY READ, then REMOVE AFTER COMPATIBILITY WINDOW |
| RTDB `users/{username}/authUid` | Username/PIN session verification; legacy Google binding; owner rules for lists, profiles, pending decrements, and `publicShares`; E.1 legacy verifier | Existing user initialization and protected admin tooling | Reciprocal owner/admin RTDB Rules | Legacy username-to-UID ownership evidence | Never fabricated; Firestore account plus handle claim establish ownership | KEEP - LEGACY USERNAME/PIN ONLY |
| RTDB `users/{username}` | Existing profile UI, admin, legacy public-profile publication, migration tools | Existing owner/admin profile paths | Reciprocal legacy owner/admin Rules | Legacy profile and access-method metadata | Provider-only profile data comes from UID-owned sync/public projection; no PIN, email, or synthetic credential | REMOVE AFTER COMPATIBILITY WINDOW |
| RTDB `wishlist/{username}`, `dynamax/{username}`, `gmax/{username}`, `costumes/{username}` | Existing owned-list hydration, admin, migration into account sync | Existing owner/admin browser writes | `users/{username}/authUid == auth.uid` | Legacy private list storage | Provider-only accounts skip these paths and start with an empty UID-owned canonical account | KEEP - LEGACY USERNAME/PIN ONLY |
| RTDB `pendingDecrements/{username}` | Existing trade counterparty workflow | Legacy users and protected admin paths | `authIndex` plus reciprocal owner Rules | Username-rooted legacy trade adjustment queue | Provider-only runtime does not subscribe or write | KEEP - LEGACY USERNAME/PIN ONLY |
| RTDB `offers/{username}`, `trades/{tradeId}` | Signed-in trade workflows and admin | Existing participants/organizer/admin | Username derived from `authIndex/{auth.uid}` | Legacy social trade workflow | Not enabled for provider-only accounts until separately migrated to UID ownership | MIGRATE TO UID-ROOTED DATA |
| RTDB `publicShares/{username}` | Anonymous share page; in-app trainer view; favorites cache; migration audit | Existing owner/admin browser publication | `users/{username}/authUid == auth.uid` | Legacy public URL and sanitized projection | Legacy exact URLs remain a bounded fallback; provider-only publication uses `trainerShares/{uid}` | REMOVE AFTER COMPATIBILITY WINDOW |
| RTDB `accountSync/{uid}` | Account-sync repository/runtime | Exact authenticated owner | Direct RTDB Rules bind `$ownerUid == auth.uid` | Canonical private cross-device entities, operations, migration evidence, and recovery state | Used directly after canonical account certification; no username mapping is involved | MIGRATE TO UID-ROOTED DATA |
| RTDB `trainerShares/{uid}` | Dormant share repository and candidate rules | Exact authenticated owner when the reviewed write gate is active | `$ownerUid == auth.uid`; sanitized schema validation | UID-rooted public projection | Canonical provider-only publication target | MIGRATE TO UID-ROOTED DATA |
| RTDB `shareDirectory/{normalizedHandle}` | Dormant share repository and trusted-function candidates | Candidate browser/server paths | Candidate Rules currently inactive | Proposed handle-to-UID directory | Do not activate as a second handle authority or expose raw UID; resolve Firestore handle through a fixed gateway | REPLACE WITH FIXED GATEWAY READ |
| Firestore `accounts/{uid}` | E.1 authority and exact account-foundation gateway | Dedicated E.1 authority only | Private service identity scoped to the named database; browser Rules deny all | Sole canonical account identity | Required before any provider-only product runtime starts | MIGRATE TO FIRESTORE IDENTITY |
| Firestore `trainerHandles/{handleKey}` | E.1 authority and exact handle gateway | Dedicated E.1 authority transaction only | Same E.1 boundary | Sole canonical reverse handle claim | Global collision authority after namespace certification | MIGRATE TO FIRESTORE IDENTITY |
| Firestore `accounts/{uid}/providers/{provider}` | E.1 authority exact readback | Dedicated E.1 authority transaction only | Same E.1 boundary | Provider link state bound to the canonical UID | Google is the first admitted provider; no profile-based identity inference | MIGRATE TO FIRESTORE IDENTITY |
| Firestore `providerSubjects/{providerSubjectKey}` | E.1 authority exact readback | Dedicated E.1 authority transaction only | Same E.1 boundary | HMAC-keyed global provider-subject uniqueness | Prevents one Google subject from creating multiple canonical accounts | MIGRATE TO FIRESTORE IDENTITY |
| Firestore `operationRequests/{uid}/requests/{requestId}` | E.1 authority replay/readback | Dedicated E.1 authority transaction only | Same E.1 boundary | Idempotency and bounded accepted result | Exact replay succeeds; changed evidence fails | MIGRATE TO FIRESTORE IDENTITY |
| Firestore `authorityConfig/providerAccountCreation` | E.1 authority transaction | Separately reviewed operator process only | Not browser-readable or writable | Expiring proof that every active legacy handle is collision-protected | Creation fails closed while absent, stale, malformed, or incomplete | MIGRATE TO FIRESTORE IDENTITY |

## Flow conclusions

Username/PIN authentication keeps its current reciprocal RTDB evidence and migrates through the existing verified legacy route. An existing canonical account is always resolved from Firestore first, so linking or refreshing provider data does not rerun migration.

A new Google user creates only Firestore account, handle, provider, subject, and operation records. The browser cannot write those records, and the authority never writes `authIndex`, `loginDirectory`, or `users`.

Private sync is already UID-rooted. Public sharing is the remaining product dependency and is intentionally separated into the stacked `identity/provider-public-projection` draft PR.
