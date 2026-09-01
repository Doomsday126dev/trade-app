# Provider Identity Test Matrix

Status: deterministic source and emulator evidence for requirements 1-48. Production remains unchanged. "Injected" means only the provider popup or App Check issuance boundary is substituted; the domain, gateway, adapter, or Rules behavior under test is real.

| # | Required outcome | Primary evidence | Mode | Result |
| ---: | --- | --- | --- | --- |
| 1 | New Google UID claims available handle | `e1-create-provider-account`; Firestore emulator atomic-create test | Injected Auth + real Firestore emulator | Pass |
| 2 | Exact account and handle records created | Firestore emulator canonical five-record assertion | Real Firestore emulator | Pass |
| 3 | No RTDB identity mapping created | Firestore root allowlist test; provider application integration | Real adapter + source contract | Pass |
| 4 | Identical replay succeeds | Firestore emulator replay test | Real Firestore emulator | Pass |
| 5 | Changed request-ID evidence fails | Firestore emulator replay mismatch test | Real Firestore emulator | Pass |
| 6 | UID already has account | Same-UID second-account test | Real Firestore emulator | Pass |
| 7 | Handle owned in Firestore | Handle collision and race tests | Real Firestore emulator | Pass |
| 8 | Handle exists only in legacy RTDB | Namespace certification and `legacy_hold` test | Real Firestore emulator | Pass |
| 9 | Two UIDs race for one handle | Repeated reserve and provider race tests | Real Firestore emulator | Pass |
| 10 | Same UID uses two tabs | Two-tabs provider transaction test | Real Firestore emulator | Pass |
| 11 | Auth lifecycle changes before commit | Provider account client lifecycle test | Injected Auth lifecycle | Pass |
| 12 | Provider removed before commit | Current Firebase Auth lookup tests | Injected Auth REST response | Pass |
| 13 | Authority result lost after commit | Authority and browser ambiguous-result tests | Injected transport failure | Pass |
| 14 | Exact readback confirms commit | Provider authority and client readback tests | Real adapter + injected transport | Pass |
| 15 | Exact readback disproves commit | Ambiguous state remains blocked test | Injected transport | Pass |
| 16 | Malformed canonical account | Firestore readback conflict and client response tests | Real Firestore emulator | Pass |
| 17 | App Check missing or invalid | Provider client and gateway boundary tests | Injected App Check boundary | Pass |
| 18 | Rate limit | Authority bounded quota/conflict mapping test | Real limiter contract | Pass |
| 19 | Username/PIN login unchanged | Legacy foundation read and linking suites | Domain/integration | Pass |
| 20 | Legacy mapping uses old migration route | Firestore-first application integration | Source/integration | Pass |
| 21 | Linked-Google account does not create again | Onboarding existing-account test | Domain | Pass |
| 22 | Provider refresh does not rerun migration | Linking same-UID boundary test | Domain | Pass |
| 23 | Reviewed 66 records remain inactive | `.84 reviewed stale evidence remains reviewed and inactive` | Domain | Pass |
| 24 | `.84` stale standalone evidence remains resolved | Standalone migration duplicate-evidence test | Account-sync runtime | Pass |
| 25 | Provider account publishes public share | Provider projection and application publication tests | Domain/integration | Pass |
| 26 | Anonymous share opens without Auth | Gateway, standalone app, and RTDB Rules tests | Injected App Check + real RTDB emulator | Pass |
| 27 | Trainer search resolves provider handle | Firestore exact pair lookup and app integration | Real Firestore emulator | Pass |
| 28 | Legacy share URL remains valid | App fallback and RTDB legacy exact-read tests | Real RTDB emulator | Pass |
| 29 | Owner writes only UID projection | Candidate Rules owner-write test | Real Auth + RTDB emulator | Pass |
| 30 | Another UID cannot overwrite | Candidate Rules cross-owner test | Real Auth + RTDB emulator | Pass |
| 31 | No private identity metadata leaks | Authority/gateway deep sanitizer and schema tests | Unit + real Rules | Pass |
| 32 | Sync detached before certification | Provider application activation test | Source/integration | Pass |
| 33 | Sync starts once after certification | Onboarding and application activation tests | Domain/integration | Pass |
| 34 | Empty new account reaches Saved | Provider-only empty initialization test | Account-sync runtime | Pass |
| 35 | Add/edit/delete persists | Account-sync product/runtime suites | Domain/repository | Pass |
| 36 | PWA close/reopen returns to account | Provider restart and existing IndexedDB/PWA suites | Runtime + browser | Pass |
| 37 | No stale previous-user presentation | Auth lifecycle/session-generation suites | Domain/integration | Pass |
| 38 | Google-only shows no Username/PIN | Provider application and Settings UI tests | Source/integration | Pass |
| 39 | Google-only cannot unlink Google | Provider UI/model final-method tests | Domain/integration | Pass |
| 40 | Username/PIN plus Google can unlink | Google adapter and linking suites | Injected popup | Pass |
| 41 | No email/profile merge | Onboarding, adapter, and authority privacy tests | Domain/integration | Pass |
| 42 | Provider profile cannot overwrite trainer identity | Onboarding identity test | Domain | Pass |
| 43 | Cancel before creation | Onboarding cancel test | Domain | Pass |
| 44 | Close/reopen before creation | Durable onboarding resume test | Domain | Pass |
| 45 | Ambiguous creation result | Onboarding ambiguous-state test | Domain | Pass |
| 46 | Recover exact committed result | Authority/client exact reconciliation tests | Real adapter + injected transport | Pass |
| 47 | No partial public profile | Publication gate and Rules schema tests | Integration + real RTDB emulator | Pass |
| 48 | No duplicate account foundation | Firestore replay, same-UID, and two-tabs tests | Real Firestore emulator | Pass |

## Evidence groups

- Authority and Firestore: `functions/test/e1-create-provider-account.test.cjs`, `functions/test/e1-firestore-authority-emulator.test.cjs`.
- Browser identity and onboarding: `tests/provider-account-foundation.test.cjs`, `tests/provider-account-application-integration.test.cjs`, `tests/provider-onboarding-model.test.cjs`.
- Existing Google compatibility: `tests/google-auth-adapter.test.cjs`, `tests/google-provider-ui.test.cjs`, `tests/provider-linking-foundation.test.cjs`.
- Public projection: `functions/test/e1-provider-public-share.test.cjs`, `functions/test/e1-provider-public-share-gateway.test.cjs`, `tests/provider-public-projection.test.cjs`, `tests/provider-public-share-gateway.test.cjs`, `tests/provider-public-application-integration.test.cjs`.
- Rules: `tests/firebase/provider-public-projection-rules.test.cjs` against the Auth and RTDB emulators; canonical Firestore denial is covered in the Firestore authority emulator suite.
- Account sync and recovery: existing account-sync domain, runtime, repository, IndexedDB, integration, and browser suites.

The Firebase emulators do not emulate Google popup UX or production App Check attestation. Those two edges use injected adapters. No test substitutes the Firestore transaction, RTDB Rules authorization, canonical handle pair validation, sanitizer, account-sync runtime, or owner-rooted publication behavior.
