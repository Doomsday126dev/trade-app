# Incremental roadmap from .88

No big-bang rewrite. Every implementation phase is a new bounded task; none is
executed by this prototype. No provider rollout is a hidden dependency.

| Phase | User-visible change | Data / compatibility | Rollback | Feedback gate | Eventually removable |
|---|---|---|---|---|---|
| 0: Observe | Review current .88 and prototype tasks | No account mutation; privacy-reviewed aggregate measures only if later approved | No deployed change | Two collector/casual sessions plus anonymous recipient; observe confusion and time | Nothing |
| 1: Contextual intent search | Copy game search beside current wants/offers and selected scope, with exactness limitations | Reuse current declarations and localized serializer; no schema/auth/Rules changes; preserve old actions until parity | Presentation flag/revert; no data conversion | Users can identify what's excluded and manually checked; empty/unknown/oversized tests | Duplicate search entrypoints after parity |
| 2: Combined editor/share | Two simultaneous sections, shared add/editor, scope-first Share, stable dense/row views | Adapter over existing LF/FT sources; retain notes/tiers/aliases; no forced record migration | Old presentation over same sources | 320px, large list, costumes, keyboard and export review | Direction-specific editor scaffolding, Board-facing UI |
| 3: Useful People | Qualified reciprocal ranking, freshness and chosen community | New consented projection/index only after privacy/authorization qualification; no private fan-out or provider activation | Disable index reads, retain ordinary name lookup and share | Confirm match quality/zero-results and opt-out behavior in small cohort | Duplicate discovery/search surfaces |
| 4: Recipient + prepare | Anonymous local self-check, contextual session subset and message | Local ephemeral candidate state first; durable session only if justified; no auto inventory changes | Remove preparation UI; lists unaffected | Observe actual pre-trade workflow; confirm no false equivalence | Standalone Compare destination and manual repeated search work |
| 5: Finite legacy retirement | Fewer recovery concepts, reliable dormant return | Separately approved archive/restore/canonical-writes plan; UID invariant; old writer floor before old reader shutdown | Forward reconcile new writes, read-only fallback; not stale archive overwrite | Synthetic + dormant restore proofs, verified inventory, deletion authorization | Dual storage adapters, legacy bootstrap/read paths, window-only tests |

Phase 1 precedes broad navigation changes because it is useful now, reuses a
current strength, and has a low data blast radius. It tests the central last-mile
hypothesis without waiting for enough new trainers to make ranking valuable.
Phase 2 could follow closely after observation; don't make aesthetic polish a
dependency of every search improvement. Phase 5 is not PR #63 authorization.

## First implementation prompt (not executed)

> Implement Phase 1: contextual, honest Pokemon GO search actions from the current
> accepted production baseline, using docs/trade-intent-study/06-workflows.md and
> 11-roadmap.md as the design reference. First verify the actual branch/release and
> existing My List/public/match source paths. Reuse the canonical declaration model
> and localized search serializer. Add copy actions for current Looking For, For
> Trade and selected entries, and the two reciprocal directions where already
> supported. Keep species-only prefilters explicitly labeled; never imply exact
> costume/background/form matching, silently discard unknown entries, or apply
> historic shiny/BG exclusions and CP caps universally. Preserve existing save,
> visibility, UID, recovery66, notes, priorities and compatibility behavior. Do not
> migrate data, activate providers, run PR #63 operators, reset any user, or merge
> the design prototype into the app. Add focused empty/unknown/oversized/localized
> query and anonymous privacy tests plus mobile/desktop browser checks. Open a
> focused PR with evidence and rollback instructions; do not deploy or merge until
> separately approved. Report remaining limitations directly in the final message.
