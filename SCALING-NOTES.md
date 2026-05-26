# Scaling notes — paths to 200+ trainers

> **Maintenance convention**: This doc is a living plan. Anyone who ships
> scaling-related work should update the relevant section before pushing.
> Format below: each phase has a **Status**, a **What it does**, and a
> **Next step**. Future contributors (Claude / codex / human) should be
> able to read this top-to-bottom and know exactly where things stand.

**Current status as of v4.6.22 (2026-05-24)**:
- ✅ **Phase 1 (visibility + defensive guards)**: shipped
- ⏸️ **Phase 2 (per-user subscriptions)**: not started; not needed at current size
- ⏸️ **Phase 3 (offers/trades pagination)**: not started; not needed at current size
- 🧱 **Multi-community foundation**: started behind `MULTI_COMMUNITY_ENABLED=false`; current production behavior remains global/NYC-only
- ✅ **Defensive: sprite cache LRU**: shipped (v4.6.20)
- ✅ **Defensive: localStorage quota guard**: shipped (v4.6.20)

**Community size at last update**: 40 trainers, 89 KB localStorage, Browse
p95 35ms, Strings p95 122ms. **Headroom is large** — nothing is hurting yet.
The visibility panel in Health Check is the canary; revisit this doc when
it crosses a threshold below.

---

## Current shape (what would bite us first)

The app subscribes to **entire top-level collections** at login:

```
startListener():
  subscribePath('users')        # ~40 user records
  subscribePath('authIndex')    # ~40 auth entries
  subscribePath('requests')     # join queue, small
  subscribePath('wishlist')     # 40 × ~50 entries = ~2000 keys
  subscribePath('have')         # 40 × ~30 entries = ~1200 keys
  subscribePath('offers')       # all open offers
  subscribePath('trades')       # all scheduled/reserved trades
  subscribePath(`pendingDecrements/${cur}`)  # just yours
```

Every `onValue` callback gets the **full snapshot** of that path on every
change, anywhere in it. At 40 trainers this is invisible. At 200+ a few
things break in order:

### 1. Initial-load payload (first to hurt)
At ~200 trainers with average 50 wishlist entries each, the wishlist tree
alone is ~10,000 leaf nodes. Even compressed it's well over a megabyte. On
a phone with spotty signal the first load stalls for seconds. The user
sees the loading skeleton, then the app pops in late.

**Expected pain threshold: ~120–150 trainers.** Watch
`snapshot:wishlist` payload size in Health Check.

### 2. Per-change snapshot cost
Every time any user edits anything, every other connected client receives
the full snapshot of that path (Realtime Database collapses bursts but
still sends entire affected branches). The client then runs
`normalizeData` and `refreshAll()`, which re-renders Browse / Strings /
Have.

**Expected pain threshold: ~80 trainers if any are bulk-editing.** Watch
`snapshot:*` durations.

### 3. Browse tab render cost
`renderBrowse()` joins every dex with every contributor. The grid is
`O(dexes × trainers)`. We added `content-visibility: auto` virtualization
which shifts the cost to scroll, but the *initial layout pass* still
touches all ~487 dex entries with all contributors.

**Expected pain threshold: ~100 trainers.** Watch `render:browse` p95.

### 4. localStorage size (silent)
`pogo3` blob mirrors the full app state for offline-first. At ~200
trainers that's ~2MB. Most browsers allow ~5–10MB so we're not at the
cliff, but the read/write cost grows linearly. Quota issues hit Safari
first (~5MB).

**Expected pain threshold: ~300 trainers.** Watch `pogo3 blob` size.

### 5. Sprite scale-cache size
Capped at 800 entries via LRU eviction in v4.6.20. No further action
needed.

---

## ✅ Phase 1 — visibility + defensive guards (DONE in v4.6.20)

**Status**: Shipped 2026-05-24 in commit `2bb8ceb`.

**What it did**:
- Added a `perfTime(op, fn)` rolling-buffer timer module (20-sample
  buffer per op), surfaced via `perfStats()`.
- Wrapped `_onSubSnapshot`, `renderBrowse`, `renderStrings` with timers.
- Added a perf panel to Health Check showing community size,
  localStorage usage, sprite-cache occupancy, and per-op p95 latency,
  with explicit action thresholds (>200ms p95 render → start Phase 2;
  >500ms render → act now).
- Sprite-scale cache LRU eviction at 800 entries (drops oldest 20%),
  emergency 50% trim on `QuotaExceededError`.
- `saveLocal()` catches `QuotaExceededError` and surfaces a clear toast
  instead of silently losing offline cache writes.

**Files touched**: `index.html` only.

**How to use**: open Health Check ("Having trouble signing in?" link on
login screen, or in-app menu). The "Community size", "Local storage",
and "Render · *" rows show the live numbers.

**Sample values at 40 trainers**:
```
Community size            40 trainers · 40 wishlists · 40 inventories · 7 trades
Local storage             89 KB · sprite cache 618/800
Render · Browse tab       avg 34ms · p95 35ms
Render · Strings tab      avg 122ms · p95 122ms
```

**Next step**: leave it running. Check periodically. Escalate to Phase 2
when any of these trigger:

| Trigger | Action |
|---|---|
| Render p95 > 200ms | Start prepping Phase 2 |
| Render avg > 500ms | Phase 2 is urgent |
| Trainer count > 120 | Start prepping Phase 2 |
| pogo3 blob > 3 MB | Start prepping Phase 3 |
| User reports "first load takes >3s on phone" | Phase 2 is urgent |

---

## 🧱 Multi-community scaling foundation (STARTED, FLAG OFF)

**Status**: First foundation pass added with `MULTI_COMMUNITY_ENABLED=false`.

**What it does now**:
- Normalizes future community paths into local/Firebase snapshots:
  `communities`, `userCommunities`, and `communityRequests`.
- Ensures a default `nyc` community exists in normalized local state.
- Auto-indexes existing users into the default NYC community in local
  normalized data.
- Adds an owner-only Admin maintenance control to write the default NYC
  community foundation to Firebase after v5 rules are published. Successful
  runs mark `communities/nyc/preparedAt`.
- Adds an owner-only dry-run verification panel showing whether Firebase's
  `nyc` community record is current and how many trainers Browse, Strings,
  Inventory browse, and Schedule would include after scoping is enabled.
- Adds an owner-only Browse + Strings preview toggle behind
  `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=true`; this can scope Browse,
  Strings, Compare, and Trade Match to explicit
  `communities/nyc/memberUsernames` without affecting members, ordinary
  admins, Inventory, or Schedule.
- Adds helper functions for future scoping without changing production UI:
  `getCurrentCommunityId()`, `getCommunityMemberUsernames()`,
  `filterUsersBySelectedCommunity()`, `isUserInCommunity()`,
  `canManageCommunity()`, `recordCommunityId()`, and
  `recordBelongsToSelectedCommunity()`.

**What it deliberately does not do yet**:
- No community switcher.
- No public community-scoped Browse/Strings/Inventory/Schedule filtering.
- No Inventory/Schedule scoping yet.
- No automatic Firebase writes to create community records for existing
  production data; the owner must run the private maintenance action.
- No public UI for admins or members.
- No subscription reduction. This is a model/helper foundation, not a
  bandwidth win yet.
- No actual scoping is applied from the dry-run counts while
  `MULTI_COMMUNITY_ENABLED=false`.
- Owner Browse preview is localStorage opt-in and remains owner-only; it is not
  a public feature flag flip.

**Compatibility rule**: missing `communityId` on old requests, offers, or
trades means `nyc`. Pokemon lists remain global per user for now.

**Next step**: write the default `nyc` community to Firebase only after the
owner-only maintenance tool, then enable selected screens one at a time
behind the feature flag.

---

## ⏸️ Phase 2 — narrow the high-volume subscriptions (NOT STARTED)

**Status**: Not started. Not needed yet. Triggers above.

**What it would do**: Switch from "subscribe to whole tree" to
"subscribe to mine + one-shot get for others", for `wishlist`, `have`,
`offers`. Browse expands a card → `get(ref)` fills it. Card stays open
→ upgrade to subscribe. `trades` filtered server-side by participant.

**Approach** (Option B from the original sketch):
```
At login: subscribe(`users`)                 # 200 records, ~50KB
          subscribe(`wishlist/${cur}`)       # you
          subscribe(`have/${cur}`)
          subscribe(`offers/${cur}`)
          subscribe(`trades` -- filtered)
          subscribe(`pendingDecrements/${cur}`)

Browse tab: one-shot `get(ref(db, `wishlist/${u}`))` for collapsed
            cards. Subscribe when card is expanded; unsubscribe when
            collapsed (with a 5min grace cache).

Strings tab: same pattern.

Schedule tab: trades indexed by `participants/${cur}` for server-side
              filtering.
```

**Risk**: medium. The merge code in `_onSubSnapshot` is the trickiest
piece — every callsite that reads `allData.wishlist?.[u]` needs to
handle "not yet loaded" cleanly. Mostly already does (defaults to
`{}`), but worth auditing each one.

**Cost estimate**: 2-3 days of focused work, including testing across
multiple browsers / network conditions.

**Pre-flight checklist before starting**:
- [ ] Check perf panel — confirm we're past one of the trigger
      thresholds (don't optimize blind)
- [ ] Run a fresh sprite quality audit (Phase 0 in the v4.6.17 sense
      — make sure the resolver is healthy before adding load patterns)
- [ ] Snapshot the current state with full localStorage export so
      we can compare data integrity before/after

**Next step**: don't start until a trigger fires.

---

## ⏸️ Phase 3 — paginate offers / trades (NOT STARTED)

**Status**: Not started. Not needed yet.

**What it would do**: `offers` and `trades` grow forever. Add a "last
90 days only" filter to the default subscription, with a "show
archive" toggle for the rare archaeology need. Cleanup script
archives older records to a separate path (`offers_archive`,
`trades_archive`).

**Risk**: low. Cosmetic data model change.

**Cost estimate**: 1 day. Mostly UI for the archive toggle.

**Trigger**: pogo3 blob > 3MB, OR offer/trade count visibly affecting
render perf.

**Next step**: don't start until trigger fires.

---

## ✅ Defensive items shipped in v4.6.20

| Item | What it does |
|---|---|
| Sprite scale-cache LRU | Caps cache at 800 entries; drops oldest 20% at threshold |
| Sprite cache emergency trim | On `QuotaExceededError`, drops 50% and retries |
| `saveLocal` quota guard | Catches `QuotaExceededError`, surfaces toast, keeps in-memory state correct |
| Perf timer module | `perfTime(op, fn)` wraps any sync function with rolling-buffer timing |
| Health Check perf panel | Surfaces community size, storage, cache, render p95 |
| `_writePendingDecrement` rollback (v4.6.19) | Distinguishes permanent FB rejection from transient; rolls back local optimistic write on permanent |
| `flushSyncQueue` permanent-drop (v4.6.19) | Same logic for the retry queue — permanently-rejected paths are dropped instead of retried forever |
| Local-only banner debounce (v4.6.19) | 2.5s debounce on auth-dropped branch; auth-recovered fires instantly |

---

## Items called out earlier as "still scale matter" (status)

| Item | Status |
|---|---|
| Sprite scale-cache eviction | ✅ DONE v4.6.20 |
| Activity log (sparklines) cap | Still age-only (60 day cutoff). Not urgent at 40 trainers. Re-evaluate at 100+. |
| Image exports chunking | Not needed unless we build a community-wide LF/FT board. |
| localStorage quota guard | ✅ DONE v4.6.20 |
| Health Check rendering | Now LONGER (added perf panel). At 100+ trainers the perf panel itself might want a collapse toggle. Acceptable for now. |

---

## Concrete trigger points to revisit this doc

- **After every scaling-related commit**: update this doc.
- Trainers > 80: instrument is already running. Watch the perf panel.
- Trainers > 120: ship Phase 2 before joins get noticeably slower.
- localStorage `pogo3` blob > 3MB: ship Phase 3.
- Anyone reports "the app takes more than 3 seconds to load on first
  visit": that's the canary. Ship Phase 2.

---

## Cost estimate

Firebase Realtime Database billing scales on bandwidth + storage. At
200 trainers with current shape:
- ~50MB storage (within free tier)
- ~5GB/month bandwidth for an active community (within free tier)
- ~5 concurrent connections (within free tier)

So the bottleneck is **client-side performance, not Firebase cost.**
Doing nothing keeps the bill at $0 well past 500 trainers. The pain is
on phones and slow networks first.

---

## What's explicitly OFF the table

- Migrate off Realtime Database to Firestore. RTDB's subscription
  model is what makes the live-feel of the app work. Firestore would
  be a bigger refactor with limited payoff.
- Migrate off Firebase. Not worth the cost at this size.
- Introduce a server. Currently 100% static site. Keeping it that way
  is worth a lot of operational simplicity.

---

## Update log

When you ship scaling work, append a one-line entry here. Newest first.

- **2026-05-26, v4.6.25** — Follow-up Inventory -> Browse UX/perf pass:
  made trainer-first collapsed browse the default, added trainer summary chips,
  and sorted matching trainers first while keeping the heavier By Pokemon view
  available as a secondary tab. No data-model change. (Codex)
- **2026-05-26, v4.6.25** — Paused Phase 2 and optimized the existing
  Inventory -> Browse community render path: search is debounced, per-render
  wishlist/sprite/offer lookups are cached, and By Trainer item grids now
  render lazily only when a trainer card is expanded. No data-model change.
  (Codex)
- **2026-05-25, v4.6.25** — Phase 2 pass 4 expanded owner preview to
  Schedule rows, reserved trades, notification badge, and partner picker while
  intentionally keeping quota cards tied to the owner's real daily usage.
  (Codex)
- **2026-05-25, v4.6.25** — Phase 2 pass 3 expanded owner preview to
  Inventory -> Browse community, renamed the toggle to Community preview,
  and kept My inventory and Schedule unchanged. (Codex)
- **2026-05-25, v4.6.25** — Fixed owner preview stale membership by
  subscribing the owner-preview path to live `communities`,
  `userCommunities`, and `communityRequests` even while
  `MULTI_COMMUNITY_ENABLED=false`. (Codex)
- **2026-05-25, v4.6.25** — Phase 2 pass 2 expanded owner preview to
  Strings, Compare, and Trade Match using the same `communities/nyc`
  membership set; Inventory and Schedule remain untouched. (Codex)
- **2026-05-25, v4.6.25** — Phase 2 pass 1 started as owner-only Browse
  preview: added `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE`, a localStorage
  owner toggle, an owner Browse preview banner, and Browse-only member scoping
  from `communities/nyc/memberUsernames`; no public behavior change. (Codex)
- **2026-05-25, v4.6.25** — Added owner-only community verification/dry-run
  counts for Browse, Strings, Inventory browse, and Schedule, plus server drift
  detection for `communities/nyc`; no public behavior change. (Codex)
- **2026-05-25, v4.6.25** — Multi-community foundation started behind
  `MULTI_COMMUNITY_ENABLED=false`: normalized `communities`,
  `userCommunities`, and `communityRequests`; added default `nyc`
  community helpers plus an owner-only maintenance writer, without changing
  production behavior for members/admins. (Codex)
- **2026-05-24, v4.6.22** — Perf panel layout fix (long-status rows stack
  cleanly instead of wrapping) + snapshot:* timings now skip the first
  per-path sample so displayed p95 reflects steady-state edit cost, not
  initial full-tree download. (Claude)
- **2026-05-24, v4.6.21** — Perf rows gated to admins only (allData.users
  [cur].isAdmin); Community size stays visible to everyone. Labels
  renamed to single words to avoid " · " word-break. (Claude)
- **2026-05-24, v4.6.20** — Phase 1 visibility + defensive guards shipped.
  Sprite-cache LRU eviction, localStorage quota guard, Health Check perf
  panel, perfTime module. (Claude)
- **2026-05-24, v4.6.19** — Code-smells: rollback on permanent FB rejection
  in `_writePendingDecrement` and `flushSyncQueue`, local-only banner
  debounce. (Claude)
- **2026-05-24** — Initial scaling notes drafted (no code change). (Claude)
