# Google-only onboarding: `.117` source handoff

PR #97 preserves its original branch and history and incorporates approved main
`c51d37afc5928b26e69d259e9bf72f22a3cc77dd` (`2026-09-22.117`). This is
source preparation. `providerAccountCreation`, provider-public read/write and
authority creation gates remain false. No new Google account was created.

## Integrated behavior

The existing candidate retains owner-bound pending-operation reconciliation,
late-response fencing, the optional-profile in-memory handoff, and strict RTDB
null-child normalization for an active legacy provisioning freeze. Its
`application.js` merge keeps `.117`'s Firebase SDK version and passes the live
client release to the creation request. The `.117` account snapshot readiness,
six component fingerprints, same-UID Google/PIN flow, session fences, current
Favorite admission/retry/deletion/capacity behavior, wants and special
requirements, account sync, and current UI remain the base. No old handler was
restored over those paths.

Source readiness is distinct from registration readiness. The deployed `.117`
authority has only the account-foundation **read** enabled; that qualifies the
existing-account return and does not qualify provider-only account creation,
profile publication, trainer discovery, or Favorites resolution.

| Requirement | Current source evidence | Remaining gate |
| --- | --- | --- |
| Existing Google/PIN account and same UID | `.117` human PIN/Google return passed; `accountLinkingModel` readiness and component fingerprints protect the boundary | Preserve as a regression and never require historical migration just to retain a trainer name |
| One canonical provider-only foundation | `firestoreE1AuthorityAdapter.createProviderAccountFoundation` transactionally creates account, normalized handle, Google provider, subject reverse claim, and request receipt; conflict/replay tests exercise it | Creation runtime gate remains false; qualify the source-pinned authority package, key version, and actual deployment permissions before enablement |
| Existing names and normalized aliases | Canonical handle normalization and occupied/held/conflicting claims fail closed; the 2026-08-31 aggregate inventory found 58 active legacy handles but only 8 canonical protections | Fresh, complete post-fence inventory and hold/claim coverage for every normalized legacy key, including ambiguous aliases; historical counts are not an admission proof |
| Competing legacy writers | `legacyProvisioningFreeze` source/Rules candidate and `createMemberNow` guard exist; production enforcement remains false | Review every browser, request-approval, Admin provisioning/repair, script and retained-client writer; close new legacy allocation at Rules **and** privileged writer boundaries while preserving existing same-UID updates/PIN recovery |
| Namespace certification lifetime | The transaction requires an active exact freeze and fresh schema-2 certification with matching epoch/digest, complete coverage, normalization version and expiry | This is intentionally temporary. A separate, narrowly reviewed durable admission predicate must transactionally bind a sealed legacy-writers-closed generation, permanent writer policy and full hold/claim coverage. Do not remove or extend the existing freeze/expiry checks merely to keep registration open |
| Interrupted creation and lost response | Browser stores a UID digest and bounded request metadata, performs exact canonical readback once, never blindly resends, and rejects another UID or superseding operation | Synthetic/emulator qualification and later real owner-controlled Google canary; no real OAuth result is inferred from injected identity |
| Profile and account-sync readiness | Provider-only source uses UID-rooted profile and sync, with optional profile held only in memory until activation; incomplete runtime/profile readiness blocks activation | Qualify provider-only Rules against the actual current Rules baseline, interruption/retry and clean-device behavior; creation must not be presented as ready before profile and sync settle |
| Other-trainer discovery, Favorites, and sharing | Canonical directory, Favorite identity resolver, UID-owned public projection and legacy fallback exist behind independent flags | Qualify owner/other-user/anonymous Rules, current Favorite adapter and resolver behavior, sanitized public gateway, UI search/direct URLs and publication privacy with provider-only fixtures. Read enablement alone does not satisfy this |
| Provider subject and public compatibility | HMAC subject index and post-first-account compatibility floor are implemented in source | Review Secret Manager key/version and retained-key floor before first account; separately qualify source-pinned directory/public gateway and its rollback compatibility |
| Future human test | Existing-account human canary is complete | Obtain a separately authorized, disposable Google-only identity and verified recovery alternative before any real creation canary |

The smallest missing durable prerequisite is a **separate source candidate for
permanent legacy-writer closure and sealed-generation admission**. It must prove
that all competing legacy allocation paths are server-denied, that the complete
normalized legacy namespace is claimed or held, and that each creation
transaction reads the same immutable generation. Until that candidate and its
tests exist, #97 uses only the bounded freeze plus expiring certification; it
does not offer indefinite registration. This PR does not implement the durable
predicate or activate a temporary freeze.

## Qualification performed for this source update

- Google provider suite: **121/121 passed**, including pending-operation owner
  binding, same-owner fresh-login reconciliation, optional-profile retention,
  lifecycle fencing and disabled creation.
- Firestore/Auth emulator authority matrix: **32/32 passed** with synthetic
  identities. It covers atomic five-record creation, occupied/held/ambiguous
  names, concurrent claims, replay, partial foundations and reciprocal reads.
- Provider public projection/directory/Favorite suite: **87/87 passed** after
  updating one stale assertion to the current `.117` resolver call.
- Account sync suite: **300 passed, 1 emulator-only skip**; focused product
  adapter tests **47/47 passed**; existing-account boundary/session tests
  **76/76 passed**; focused authority/gateway tests **39/39 passed**.
- Firebase read registry, global identity static contract, syntax and diff
  checks passed. The deployable frontend still requires an explicit creation
  capability and the authority creation gate remains false.

These are injected/synthetic and emulator results. They do not represent a
real Google OAuth creation or qualify live provider-only publication.

## Staged qualification and rollback

| Stage | Exact effect and entry gate | Stop/rollback behavior |
| --- | --- | --- |
| A. Integrate #97 | Merge current `.117` into the existing PR; run targeted model, authority, profile, directory/Favorite, Google/PIN and deployable-gate tests. Source only | Revert the PR if integration fails; `.117` production stays in place |
| B. Durable admission source | Separate PR for permanent legacy-writer denial and sealed-generation transaction predicate, with synthetic races, old-client and Admin-bypass tests | Keep creation false and the temporary admission contract intact until qualified |
| C. Inactive runtime/Rules qualification | Review current production Rules, pinned authority/gateway builds, subject key and IAM; validate provider-only profile, sync, public sharing and Favorite adapters in isolated emulators. All gates false | Restore exact prior revisions/Rules if an inactive qualification changes behavior; no account repair or migration |
| D. Finite namespace protection | Separately approve a bounded fence, drain competing writers, inventory all normalized legacy names, install holds/claims, verify exact coverage, close old allocation permanently, seal the generation, then invalidate temporary certification before lifting the temporary fence | Abort on incomplete/ambiguous coverage or live writer drift; leave provider creation off and follow the reviewed restoration procedure. Existing account Google/PIN and same-UID activity continue |
| E. Owner-controlled canary | With separate approval and a disposable Google identity, explicitly choose an available handle and prove one foundation, optional-profile interruption, fresh device return, wants/special requirements, Groups/Favorites, directory, public share, mobile/PWA and recovery. Only then consider public gates | Disable creation/public write first on mismatch; retain exact canonical evidence and existing accounts. Never delete users or unlink as rollback |
| F. Wider rollout | Separate authorization after canary and security/privacy review; maintain returning-account read compatibility and PIN fallback | Disable new creation/public entry while keeping compatibility reads for accounts already created |

No stage in this PR shuts down PIN registration or retires existing PINs. A
future legacy-writer closure must distinguish new allocations from existing
same-UID repair and profile activity. It must not make historical account
recovery or migration a condition for an existing user to keep their name.

## Coordination boundary

The parallel product-integrity branches own search, sprites, Settings,
sharing, Groups and export fixes. #97 edits the provider onboarding block of
`js/app/application.js` and its direct models/services/tests only. Before any
later merge with those branches, rebase/merge their current heads and resolve
shared `application.js` blocks against the newer handler, then rerun the owning
tests. Do not copy an older whole-file handler or duplicate their fixes here.
