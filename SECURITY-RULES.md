# Firebase Realtime Database — Security Rules

> **Maintenance convention**: This doc is a living plan. Anyone who ships
> rule-related work should update the relevant section before pushing.
> Format mirrors `SCALING-NOTES.md`: status banner at top, an Update log at
> the bottom, history-preserving so any future contributor (Claude / codex /
> human) can reconstruct what changed when. The public ruleset template lives
> in **§ Canonical ruleset** below; replace placeholders with private
> production values before publishing.

---

## Current status

| Item | Status |
|---|---|
| Public ruleset template version | **v5** — adds owner-only community foundation paths for the default community migration |
| Published in Firebase Console | Check Firebase Console/private operational notes before assuming this public template matches production |
| API key HTTP-referrer lock | Recommended for the production GitHub Pages or custom-domain origin |
| Scheduled RTDB backups | Recommended before the community grows substantially |

**Current note:** v5 adds `communities`, `userCommunities`, and
`communityRequests`. This public document intentionally omits exact
deployment status and private owner identifiers.

---

## Canonical ruleset

This is a sanitized public template for the Firebase Console → Realtime
Database → **Rules** block. Before publishing, replace
`OWNER_USERNAME_PLACEHOLDER` with the private production owner username.
Do not publish the placeholder literally.

```json
{
  "rules": {
    ".read": "auth != null",
    "loginDirectory": {
      ".read": true,
      "$username": {
        ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
      }
    },
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
    "communities": {
      ".read": "auth != null",
      "$communityId": {
        ".write": "auth != null && (root.child('authIndex').child(auth.uid).child('username').val() === 'OWNER_USERNAME_PLACEHOLDER' || root.child('users').child(root.child('authIndex').child(auth.uid).child('username').val()).child('isOwner').val() === true)"
      }
    },
    "userCommunities": {
      ".read": "auth != null",
      "$uid": {
        "$communityId": {
          ".write": "auth != null && (root.child('authIndex').child(auth.uid).child('username').val() === 'OWNER_USERNAME_PLACEHOLDER' || root.child('users').child(root.child('authIndex').child(auth.uid).child('username').val()).child('isOwner').val() === true)"
        }
      }
    },
    "communityRequests": {
      ".read": "auth != null",
      "$communityId": {
        "$requestId": {
          ".write": "auth != null && (root.child('authIndex').child(auth.uid).child('username').val() === 'OWNER_USERNAME_PLACEHOLDER' || root.child('users').child(root.child('authIndex').child(auth.uid).child('username').val()).child('isOwner').val() === true)"
        }
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

### Public login directory (`loginDirectory`)
- **Read**: anyone, even before login
- **Write**: admins only

This path exists solely so clean browsers and brand-new members can discover
approved trainer names before signing in. It should only contain minimal login
metadata such as the current auth version / readiness flag — not PINs or
private profile fields.

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

### Self-published login index (`authIndex`)
- **Read**: the signed-in user can read their own row; admins can read all
  rows.
- **Write**: only the signed-in user's own UID row.

Admin repair/reset flows should **not** write another user's `authIndex`
record. The repaired user publishes their own row automatically on their
next successful sign-in. This keeps the rules tighter and avoids
owner/admin account-repair writes failing on an otherwise valid user repair.

### Community foundation (`communities`, `userCommunities`, `communityRequests`)
- **Read**: any authenticated user, matching the current app's authenticated
  community visibility model.
- **Write**: owner only for now (`OWNER_USERNAME_PLACEHOLDER` or a user record marked
  `isOwner: true`).

TODO: After verification, move production community-owner checks away from
username literals and toward UID- or `isOwner`-based ownership only.

These paths are intentionally conservative during Phase 1. They exist only
to prepare the default NYC community and membership indexes. Later phases
can loosen writes for community owners/admins after the create/join/manage
flows exist.

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
- **Allow-list**: your production GitHub Pages or custom-domain origin.
- **Note**: if you ever move domains, update the private production
  allow-list too.

### ⏸️ Scheduled backups (not yet enabled)
A single mass-edit mistake (or a malicious admin) can erase a lot at once.
RTDB has scheduled exports to Cloud Storage for cheap insurance.

- **Where**: Firebase Console → Realtime Database → Backups
- **Recommended**: daily exports, keep 7-day rolling window
- **Cost**: usually low at small community scale
- **Priority**: worth doing before relying on many admins or large communities

---

## Avoid loose write variants

Do not loosen `have/` writes to all authenticated users. Keep cross-user
inventory changes mediated through the pending decrement/restoration flow.
If that queue becomes hard to maintain, design a replacement that preserves
schema-level ownership checks rather than relying on community trust.

---

## Update log

When you ship a rule change (or other related work), append a one-line
entry here. Newest first.

- **2026-05-27, docs-only** — Sanitized the public rules reference by
  replacing private owner/deployment details with placeholders and removing
  a copy-pasteable loose write variant. No deployed Firebase rule change.
  (Codex)
- **2026-05-25, v4.6.25** — Drafted v5 owner-only community foundation
  rules for `communities`, `userCommunities`, and `communityRequests`.
  Publish before running the owner-only default community preparation tool.
  (Codex)
- **2026-05-24, v4.6.24** — Added public `loginDirectory` path so newly approved trainers appear on the login screen in clean browsers; app now expects admins to maintain it alongside `users/`.
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
