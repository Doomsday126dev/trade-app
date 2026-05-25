# Firebase Realtime Database — Security Rules

> **Maintenance convention**: This doc is a living plan. Anyone who ships
> rule-related work should update the relevant section before pushing.
> Format mirrors `SCALING-NOTES.md`: status banner at top, an Update log at
> the bottom, history-preserving so any future contributor (Claude / codex /
> human) can reconstruct what changed when. The canonical ruleset to publish
> lives in **§ Canonical ruleset** below — copy that block verbatim.

---

## Current status (as of v4.6.20, 2026-05-24)

| Item | Status |
|---|---|
| Canonical ruleset version | **v3** — requires `qty` in `[-999, 999]` (allows negative qty for trade-cancel restoration) |
| Published in Firebase Console | ✅ **Confirmed published 2026-05-24** by user |
| API key HTTP-referrer lock | ✅ Confirmed configured (Google Cloud Console → Credentials, restricted to `https://doomsday126dev.github.io/*`) |
| Scheduled RTDB backups | ⏸️ Not yet enabled (low priority at 40 trainers) |

**No pending changes.** The canonical ruleset below matches what's
currently live in Firebase. If you need to change the rules, edit this
doc first (the canonical block + the changelog), then publish.

---

## Canonical ruleset

This is the **single source of truth** for what's in Firebase. Paste this
block verbatim into Firebase Console → Realtime Database → **Rules** →
Publish.

```json
{
  "rules": {
    ".read": "auth != null",
    "users": {
      "$username": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || data.child('authUid').val() === auth.uid || (!data.child('authUid').exists() && newData.child('authUid').val() === auth.uid && newData.child('authEmail').val() === auth.token.email && (!data.child('authEmail').exists() || data.child('authEmail').val() === auth.token.email)))"
      }
    },
    "wishlist": {
      "$username": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('users').child($username).child('authUid').val() === auth.uid)"
      }
    },
    "dynamax": {
      "$username": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('users').child($username).child('authUid').val() === auth.uid)"
      }
    },
    "gmax": {
      "$username": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('users').child($username).child('authUid').val() === auth.uid)"
      }
    },
    "costumes": {
      "$username": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('users').child($username).child('authUid').val() === auth.uid)"
      }
    },
    "have": {
      "$username": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('users').child($username).child('authUid').val() === auth.uid)"
      }
    },
    "offers": {
      "$recipient": {
        "$offerId": {
          ".write": "auth != null && ((!data.exists() && newData.child('from').val() === root.child('authIndex').child(auth.uid).child('username').val()) || (data.exists() && data.child('from').val() === root.child('authIndex').child(auth.uid).child('username').val()) || $recipient === root.child('authIndex').child(auth.uid).child('username').val() || root.child('admins').child(auth.uid).val() === true)"
        }
      }
    },
    "trades": {
      "$tradeId": {
        ".write": "auth != null && ((!data.exists() && newData.child('organizer').val() === root.child('authIndex').child(auth.uid).child('username').val()) || (data.exists() && data.child('organizer').val() === root.child('authIndex').child(auth.uid).child('username').val()) || (data.exists() && data.child('participants').child(root.child('authIndex').child(auth.uid).child('username').val()).exists()) || root.child('admins').child(auth.uid).val() === true)"
      }
    },
    "requests": {
      "$id": {
        ".write": "!data.exists() || (auth != null && root.child('admins').child(auth.uid).val() === true)"
      }
    },
    "authIndex": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || root.child('admins').child(auth.uid).val() === true)",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "admins": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
      }
    },
    "pendingDecrements": {
      "$username": {
        ".read": "auth != null && (root.child('users').child($username).child('authUid').val() === auth.uid || root.child('admins').child(auth.uid).val() === true)",
        "$decId": {
          ".write": "auth != null && ((!data.exists() && newData.child('from').val() === root.child('authIndex').child(auth.uid).child('username').val() && newData.child('qty').isNumber() && newData.child('qty').val() != 0 && newData.child('qty').val() >= -999 && newData.child('qty').val() <= 999 && newData.child('key').isString() && newData.child('key').val().length > 0) || (data.exists() && root.child('users').child($username).child('authUid').val() === auth.uid) || root.child('admins').child(auth.uid).val() === true)"
        }
      }
    },
    "_ping": {
      ".write": "auth != null"
    }
  }
}
```

---

## What each path locks down

### Public-read, owner-write data (`users`, `wishlist`, `dynamax`, `gmax`, `costumes`, `have`)
- **Read**: any authenticated user (community-visible by design)
- **Write**: only the trainer themselves, or an admin (break-glass)

### Cross-user data (`offers`, `trades`, `pendingDecrements`)
These need more nuanced rules because multiple users legitimately touch the
same record.

**Offers**: `from` user can create/modify their own. The `$recipient` user
can modify too (to mark accepted/declined). Admins can do anything.

**Trades**: organizer can create/modify. Any participant can modify
(participants update meeting details, mark traded, cancel). Admins can do
anything.

**pendingDecrements** (the cross-user inventory restoration queue):
- **Read**: only the target user (whose inventory will be debited) or an admin
- **Write — create**: writer's `from` field must match their actual username
  (anti-spoofing); `qty` must be a nonzero number in `[-999, 999]`;
  `key` must be non-empty string
- **Write — modify/delete**: only the target user (the bucket owner) — used
  by the reconciler to clear records after applying them

The qty range allows **positive** values for the standard decrement flow
(someone accepted my offer → subtract N from my inventory) and **negative**
values for the restoration flow (the other side cancelled → add N back to
my inventory; added in app v4.6.10).

### Admin-restricted (`requests`, `admins`)
- **requests**: anyone can create a new join request (no auth needed —
  prospective members can't log in yet). Only admins can modify/delete.
- **admins**: only existing admins can modify the admin list. All
  authenticated users can read the list (used to surface "this user is an
  admin" UI).

---

## How to verify the published ruleset

After publishing in Firebase Console, run these checks. Each one targets a
specific protection.

### 1. Anonymous read is blocked
```
curl 'https://<your-project>.firebaseio.com/users.json'
```
Should return `{"error": "Permission denied"}`. If it returns data, the
ruleset didn't take.

### 2. Logged-in editing still works
- Edit your wishlist → saves
- Post an offer → appears in the recipient's inbox

### 3. Trade-accept end-to-end (positive qty path)
- Accept an offer from another trainer via the **Trade →** button
- Confirm the qty in the popup
- Inspect Firebase Console → `pendingDecrements/{bidder}/{some-id}` should
  contain `{ "from": "<recipient>", "key": "...", "qty": <positive N>, ... }`
- Reload the bidder's session → their inventory decrements and the pending
  record disappears
- Toast on bidder's side: *"✅ Synced 1 accepted trade…"*

### 4. Trade-cancel restoration (negative qty path, the v4.6.10 flow)
- Cancel an accepted trade via the ✗ button in the schedule
- Inspect `pendingDecrements/{counterparty}/{some-id}` — should contain
  `{ ..., "qty": <negative N>, ... }`
- Sign in as the counterparty → toast: *"✅ Synced 1 cancellation…"* and
  inventory restores
- **If this fails**: the published ruleset is probably the old v2 (which
  required `qty > 0`). Republish using the canonical block above.

### 5. Brief UI flicker — known and expected
Between the recipient hitting Confirm and the bidder's client applying the
pending decrement, the bidder's inventory **on Firebase** still shows the
old qty. A third trainer browsing the bidder's inventory in that window
will see the stale count until the bidder's client reconciles. Usually
resolves in seconds. The trade itself is correct — only the displayed
value lags.

---

## Defense-in-depth (outside the rules themselves)

### ✅ HTTP-referrer lock on the Web API key
Restricts the Firebase Web API key so it only works when requests come from
your production domain. Anyone scraping the key from `index.html` can't
initialize a Firebase app against your project from somewhere else.

- **Where**: Google Cloud Console → APIs & Services → Credentials → your
  Firebase Web API key → Application restrictions → HTTP referrers
- **Current allow-list**: `https://doomsday126dev.github.io/*`
- **Note**: if you ever move to a custom domain, add it here too.

### ⏸️ Scheduled backups (not yet enabled)
A single mass-edit mistake (or a malicious admin) can erase a lot at once.
RTDB has scheduled exports to Cloud Storage for cheap insurance.

- **Where**: Firebase Console → Realtime Database → Backups
- **Recommended**: daily exports, keep 7-day rolling window
- **Cost**: ~$0.05/month for a 50MB database at this scale
- **Priority**: low at 40 trainers, worth doing before 100+

---

## If you ever want the LOOSE variant (NOT recommended)

If the per-user `pendingDecrements` queue ever becomes a maintenance
burden, you can drop it and let any signed-in user write to anyone's
`have/` directly:

```json
"have": { "$username": { ".write": "auth != null" } }
```

The app would still work (the code falls back to optimistic local updates
either way), but you'd be relying on community trust rather than
schema-level protection. At 50+ trainers I'd keep the strict version.

---

## Update log

When you ship a rule change (or other related work), append a one-line
entry here. Newest first.

- **2026-05-24, v4.6.20** — User confirmed v3 ruleset is published and API
  key is referrer-locked. Doc restructured into living-format. (Claude)
- **2026-05-24, v4.6.18** — Documented `POKEAPI_PLACEHOLDER_FORM_IDS` skip
  set (app-side only, not a rule change). (Claude)
- **2026-05-24, v4.6.10** — Canonical ruleset bumped from v2 (`qty > 0`)
  to v3 (`qty in [-999, 999], qty != 0`) to allow negative qty for the
  trade-cancel restoration flow. Required republish in Firebase Console.
  (Claude)
- **2026-05-23** — Initial pendingDecrements rules drafted (v2 — `qty > 0`).
  Replaced `.read: true` with `.read: auth != null` (closed the anonymous
  read leak). (Claude)
