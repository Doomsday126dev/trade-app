# Trade usability gap closure and regression repair

Candidate: 2026-10-25.132, isolated from live .131 (56ae1b8). No production data, role, Rules, billing or credential changes were used for qualification.

## Important corrections

- Explicit Settings destinations now win over the previous route, including More → Profile and security deep navigation. Delayed Tools dispatch is session-bound.
- Profile, PIN and appearance compatibility saves capture the original UID, username and session generation. A→B→A cannot revive earlier operations. New drafts survive earlier save completion; failed saves keep editable input. Local/queued acknowledgements no longer claim server confirmation. Accepted avatar changes/clearing refresh all four shell avatars.
- Owner-only Admin permission policy is unchanged. Role feedback waits for queue acceptance; denied requests change local state only after acknowledgement, and late results cannot restore an earlier account's data.
- Organizer membership and group creation capture trainer identity, label and session before readiness awaits. Changing organizer or account cannot apply one trainer's groups to another or consume its draft. Favorite add/remove, compatibility tag changes and group membership/save readiness have corresponding session fences.
- Favorites has nearby Manage groups, membership counts, visible wrapping group filters, compact trainer cards and 44px controls. Membership IDs and multi-group assignments remain intact. Rendering does not mark a Favorite checked; canceling removal preserves it.
- Find Trainer distinguishes all failed bounded directory requests from a genuine no-match result and exposes Retry.
- Public initial-read rejection cannot erase a successful resumed view. Anonymous locale rendering preserves inner focus; Events detail uses an explicit return-focus target, including WebKit's click behavior.
- Events ticks preserve disclosures/calendar focus and defer rerender under an open modal. Venue events without an offset are grouped as unconfirmed rather than claimed live/expired in the viewer's zone. Conflicting import regions are rejected in either order.

## Regression suite repair

The pre-existing broad suite had 148 failures. The historical .100 archive proof accidentally loaded current runtime files while claiming pinned .100 provenance. Eight source files are now vendored byte-for-byte from the declared source commit, hash-checked on each load; all 69 adversarial/round-trip cases execute. This remains an offline synthetic proof, not a production backup/restore feature.

Obsolete category/editor/Inventory/Board and disabled-provider expectations were replaced with current wants-only, active capability, legal/privacy, artwork and six-section Settings contracts. Negative privacy/identity/write boundaries remain. Source-extraction harnesses now execute the actual current functions. Firebase read mutation tests use the current registry while immutable historical cases remain pinned. Opening Favorites is deliberately different from marking them checked, and tests now assert that distinction.

One actual dormant operator-canary defect was repaired: its browser validator did not accept the authority's current closed, redacted identity shape. It now accepts that exact shape with valid identity-kind/legacy-access combinations and integer revision ≥1; historical timestamp envelopes retain their validation. No automatic canary activation or backend change.

Latest broad local run before final release-marker qualification: 1,911 tests; 1,899 pass, 12 existing opt-in/emulator skips, zero failures. No new skips were added. Subsequent runtime changes receive targeted/browser and release-gate checks; final release closeout records exact-head results.

## Coverage: rendered versus interacted

| Surface | Actual isolated interaction coverage | Remaining real-world limit |
|---|---|---|
| Settings/Profile | Six destinations; mobile/desktop draft/save/discard/validation; change/clear avatar; rejection; delayed save; A→B and A→B→A | No production account/PIN changes |
| Admin | Exact configured-owner + UID gate; all five sections navigate; role/denial delayed rejection and session switch | Production Auth/admin mutations deliberately not executed |
| Favorites/Groups | Filter/search/clear; Manage groups; canceled removal; checked-baseline preservation; deferred organizer/account changes | Multi-device server changes use existing isolated runtime tests, not live memberships |
| Find Trainer | Directory failure, Retry, no match, clear/focus; existing suggestion/selected-read tests | No production load generation |
| Tools/App & Data | Import/export/safe-transfer/shortcuts navigation; ordinary-account backup denial; status/release view | Recovery/conflict backend behavior covered by existing synthetic runtime suites; real installation/OS prompts untested |
| Events | Cards/details, bonuses/time labels, minute disclosure/focus, unknown venue timing, empty/loading/stale/error rendering | Third-party ingestion remains incomplete; no claim of official/exhaustive coverage |
| Anonymous sharing | Legacy exact-path read/listener, late errors, resumed reads, locale/clipboard/privacy; provider refresh path | No real private-list publication/revocation tests or production data writes |

Fresh preview matrix: 120 My List/import/sharing/Events cells plus 32 Groups/organizer/Profile/Admin cells, Chromium and WebKit, 320/390/1440 as applicable, light/dark; no viewport overflow. Browser tests use emulated mobile viewports. They do not establish physical iOS/Android/Windows coverage, touch-scrolling ergonomics or actual Mac Safari UI behavior. Settings scrolling is checked through native browser element scrolling because mobile WebKit does not support Playwright mouse.wheel.

## Limits and separate decisions

The app cannot promise exhaustive Events knowledge from incomplete third-party fields; unknown bonuses/tickets remain explicit. Precise venue timing requires an actual timezone/offset in the source. Saved app lists are not automatically synced game inventory. Durable private saving and public publication remain distinct; real outages retain honest pending/unconfirmed status. Server-enforced link revocation/consent and the historical public seed require separate permission/data decisions; this release neither deletes seed records nor widens access. Backend process-death ordering limits from the reliability release remain documented.

Minor/design items remain in 2026-10-25-minor-findings.md. Final screenshots are synthetic, with no real capability links or collection data.
