# Confidence per unit of maintenance

Conceptual classification using current test paths and the existing
`docs/product-audit/test-suites.csv` / `test-declarations.csv` inventory.
No production tests deleted, weakened or moved by this study. Historical inventory
counts are not presented as a fresh total. Unit, adapter and real Rules tests can
protect different boundaries even when names look similar.

| Class | Representative current files | Future disposition / deletion gate |
|---|---|---|
| Permanent product | `trade-list-comparison`, `pokemon-go-search-syntax`, `special-trade-board-export`, `public-share-localization` | Preserve semantic identity, honest query, export and anonymous recipient contracts; rename Board suite only after concept transition |
| Security boundary | `firebase/global-identity-rules`, `provider-privacy`, reset `callable`/`reset`, `share-visibility-client` | Permanent authorization/UID/replay/privacy checks; real Rules enforcement not replaced by UI mocks |
| Durable data safety | `account-sync-domain`, `account-sync-indexeddb`, `owned-data-coordinator`, `my-list-sync-safety` | Keep convergence, tombstones, recovery and atomicity; retarget adapters only with equivalent proof |
| Migration-only | `account-sync-recovery`, `share-migration-audit`, `uid-handle-reconciliation` | Mixed suites: extract converter/restore invariants permanently; move completed operational rollout fixtures to archived evidence after retirement |
| Temporary canary | `e1-client-foundation-canary`, `google-provider-development.spec`, production operator setup guards | Keep while canary exists; never run live operations by ordinary CI; retire exact window scaffolding when window is permanently closed |
| Compatibility | `legacy-provisioning-freeze`, `login-directory-state`, alias handling in comparison tests | Not obsolete yet. Remove only after old writers/readers are fenced and dormant restore qualified |
| Duplication candidates | repeated source-string assertions across `ui-readiness`, asset/version suites; repeated viewport sweeps | Map each invariant to owning behavior test before consolidation; don't delete because text looks repeated |
| Historical release proof | release-specific operator manifests, frozen acceptance fixtures | Immutable evidence archive; keep generic Pages/SW atomic rollback contracts live |

## Smaller eventual suite shape

1. Pure intent/variant/match/search tests own semantics with table-driven edge cases.
2. Store contract tests own writes/revisions/tombstones; converters own one-way
   archive imports with deterministic round-trip/semantic-preservation fixtures.
3. Independent enforcement tests own auth/Rules/IAM adapters, preserving negative
   cross-account, revocation and ambiguous-result cases.
4. A small real-browser spine: add both sides, refresh/sync, anonymous share, exact
   collectible detail, contextual search, owner-only maintenance. Focused viewport
   cases supplement it rather than cloning every journey across every size.
5. Change-triggered deeper performance/localization/offline/browser testing.
   Release adds cache atomicity and rollback. Operator live proof stays opt-in.

Do not promise runtime savings from file count. Measure cold CI/browser install,
execution and retries separately. A one-minute pipeline does not justify dropping
security coverage. Consolidation aims at fewer brittle implementation assertions,
clear ownership and easier diagnosis, not a target number of tests.

Deletion checklist: unique assertions mapped, replacement contract passing, source
adapter retired, no supported legacy caller, archived evidence accessible, restore
drill qualified, reviewer signoff. Until then 'migration-only' is classification,
not permission to remove. Keep the 66-reviewed semantic contract permanently.
