# Scaling notes — paths to 200+ trainers

Written 2026-05-24 at v4.6.19. Current community: ~30 trainers, healthy. This
doc is intentionally a sketch — no code yet — meant to be referenced when
you're ready to commit to scaling work.

## Current shape (what would bite us first)

The app subscribes to **entire top-level collections** at login:

```
startListener():
  subscribePath('users')        # ~30 user records
  subscribePath('authIndex')    # ~30 auth entries
  subscribePath('requests')     # join queue, small
  subscribePath('wishlist')     # 30 × ~50 entries = ~1500 keys
  subscribePath('have')         # 30 × ~30 entries = ~900 keys
  subscribePath('offers')       # all open offers
  subscribePath('trades')       # all scheduled/reserved trades
  subscribePath(`pendingDecrements/${cur}`)  # just yours
```

Every `onValue` callback gets the **full snapshot** of that path on every
change, anywhere in it. At 30 trainers this is invisible. At 200+ a few
things break in order:

### 1. Initial-load payload (first to hurt)
At ~200 trainers with average 50 wishlist entries each, the wishlist tree
alone is ~10,000 leaf nodes. Even compressed it's well over a megabyte. On a
phone with spotty signal the first load stalls for seconds. The user sees
the loading skeleton, then the app pops in late.

**Expected pain threshold: ~120–150 trainers.**

### 2. Per-change snapshot cost
Every time any user edits anything, every other connected client receives
the full snapshot of that path (Realtime Database collapses bursts but still
sends entire affected branches). The client then runs `normalizeData` and
`refreshAll()`, which re-renders Browse / Strings / Have.

**Expected pain threshold: ~80 trainers if any are bulk-editing.**

### 3. Browse tab render cost
`renderBrowse()` joins every dex with every contributor. The grid is
`O(dexes × trainers)`. We added `content-visibility: auto` virtualization
which shifts the cost to scroll, but the *initial layout pass* still touches
all ~487 dex entries with all contributors.

**Expected pain threshold: ~100 trainers.**

### 4. localStorage size (silent)
`pogo3` blob mirrors the full app state for offline-first. At ~200 trainers
that's ~2MB. Most browsers allow ~5–10MB so we're not at the cliff, but the
read/write cost grows linearly. Quota issues hit Safari first (~5MB).

**Expected pain threshold: ~300 trainers.**

### 5. Sprite scale-cache size
Once `pogoSpriteScales_v4` hits ~600 URLs (which happens once everyone's
inventory + wishlist + costumes touches each species once), it's ~60KB. Not
a problem yet.

## Strategy: subscribe narrowly, hydrate lazily

The current "subscribe to the whole tree" model is what dies first. Two
philosophical options:

### Option A — Lazy hydration via paginated subscriptions
Keep the tree shape, subscribe in chunks. Useful but complex.

```
At login: subscribe('users')                  # cheap, needed everywhere
          subscribe(`wishlist/${cur}`)        # your own list
          subscribe(`have/${cur}`)            # your own inventory
          subscribe(`offers/${cur}`)          # your inbox
          subscribe(`offers/* where from=cur`) # your outbox (server side query)
          subscribe(`pendingDecrements/${cur}`)
          subscribe(`trades` filtered to where I'm a participant)

Browse tab opens:  ensureSubscribed(`wishlist`)  # the full tree, once
                    cache 5 min after switching away then unsubscribe

Strings tab opens: same as Browse — `wishlist` and per-list types as needed

Schedule tab:      `trades` is already a thin slice (my participation)
                   plus a broader `trades` subscription only when opened
```

Pros: still works as a feed (real-time updates flow through). Minimal data
model change.

Cons: requires Firebase query support (`orderByChild`/`equalTo`) which
Realtime Database has but is awkward at scale. Multiple subscriptions
multiply listener overhead.

### Option B — Decouple "list of trainers" from "trainer data" (recommended)
Treat each trainer's data as a separate fetchable document. Subscribe only
to a thin index, then pull individual users on demand.

```
At login: subscribe(`users`)                 # 200 records, ~50KB
          subscribe(`wishlist/${cur}`)       # you
          subscribe(`have/${cur}`)
          subscribe(`offers/${cur}`)
          subscribe(`trades`  -- filtered)
          subscribe(`pendingDecrements/${cur}`)

Browse tab: pre-fetch wishlists for trainers visible above the fold via
            `get(ref(db, `wishlist/${u}`))` (one-shot, not subscription).
            Subscribe to a wishlist only when its card is expanded.
            Drop the subscription when the card collapses.

Strings tab: same pattern — `get` for collapsed cards, subscribe when expanded.

Schedule tab: trades sliced to my participation only.
```

Pros: O(active interactions) rather than O(community size). Each subscription
covers one trainer's data, sub-50KB. Browse can render summary metadata
("Doomsday126 wants 47 things") from `users` alone, only fetching the actual
wishlist when expanded.

Cons: needs a data model change. The "trades" subscription needs server-side
filtering (Firebase supports `orderByChild` + `equalTo` for one participant
at a time; need to keep an indexed `participants` field). Real-time feel of
"I see X added a new trade as it happens" still works for cards you're
subscribed to.

### What I'd do
**Option B**, in three deploys:

**Phase 1 — instrument before changing anything**
Add timing to `startListener()`, `_onSubSnapshot`, and the heavy
`renderBrowse` / `renderStrings` paths. Log to console with `console.time` /
`console.timeEnd`. Run for a week with the existing 30-trainer community to
get a baseline. Without this we'd be optimizing blind.

**Phase 2 — narrow the high-volume subscriptions**
- `wishlist`, `have`, `offers`: switch from "subscribe to whole tree" to
  "subscribe to mine + one-shot get for others". Browse expands a card →
  `get(...)` fills it. Card stays open → upgrade to subscribe.
- `trades`: add `participants/$uid` indexed field and use
  `orderByChild('participants/${cur}').equalTo(true)` to filter server-side.

Estimated risk: medium. The merge code in `_onSubSnapshot` is the trickiest
piece — every callsite that reads `allData.wishlist?.[u]` needs to handle
the "not yet loaded" case. Mostly already does (defaults to `{}`), but worth
auditing.

**Phase 3 — pagination on the long collections**
`offers` and `trades` grow forever. Add a "last 90 days only" filter to the
default subscription, with a "show archive" toggle for the rare archaeology
need. Cleanup script archives older records to a separate path.

Estimated risk: low. Cosmetic data model change.

## Other items that would scale matter

### a. Sprite scale-cache eviction
Currently grows forever (only cleared on `_v` bump). Should evict by LRU
when over N entries. Trivial fix; do it whenever convenient.

### b. Activity log (sparklines)
`recordActivityEvent` writes to localStorage per-user. At 200 trainers ×
60 days × handful of events per day, this is still <100KB. Fine for now,
but if added events per user goes up, add a hard cap on per-user log length
(currently filtered by 60-day cutoff only).

### c. Image exports
Special Trade Board export PNGs at full community scale would be huge.
Currently scoped to a single trainer's choices, fine. If you ever build a
"community-wide LF/FT board," make sure to chunk it.

### d. localStorage quota
Once the `pogo3` blob exceeds ~5MB, Safari iOS will start failing writes
silently. Defensive move: catch `QuotaExceededError` in `saveLocal` and
fall back to in-memory only with a warning toast. Not urgent at 30 trainers.

### e. Health Check rendering
At 200+ trainers the health screen's per-user grid would get tall. Not
critical, but worth adding a "show top 20 / show all" toggle when it
crosses ~80 rows.

## Concrete trigger points to revisit this doc

- Trainers > 80: instrument and watch initial-load timing
- Trainers > 120: ship Phase 2 (narrow subscriptions) before joins get
  noticeably slower
- localStorage `pogo3` blob > 3MB: ship Phase 3 (offers/trades pagination)
- Anyone reports "the app takes more than 3 seconds to load on first
  visit": that's the canary. Ship Phase 2.

## Cost estimate

Firebase Realtime Database billing scales on bandwidth + storage. At
200 trainers with current shape:
- ~50MB storage (within free tier)
- ~5GB/month bandwidth for an active community (within free tier)
- ~5 concurrent connections (within free tier)

So the bottleneck is **client-side performance, not Firebase cost.** Doing
nothing keeps the bill at $0 well past 500 trainers. The pain is on phones
and slow networks first.

## What I'm NOT going to do

- Migrate off Realtime Database to Firestore. RTDB's subscription model is
  what makes the live-feel of the app work. Firestore would be a bigger
  refactor with limited payoff.
- Migrate off Firebase. Not worth the cost at this size.
- Introduce a server. Currently 100% static site. Keeping it that way is
  worth a lot of operational simplicity.
