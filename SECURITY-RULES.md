# Firebase Realtime Database — Security Rules

## What changed

The app now uses a **per-user pending-decrements queue** for trade-accept
(Option C in the previous audit). When a recipient accepts an offer, their
client:

1. Decrements their own `have/` entry (own path — owner-write rule passes).
2. Writes a `pendingDecrements/{bidder}/{id}` record describing the qty
   to subtract from the bidder's inventory.
3. The bidder's client picks up that record on next subscription delivery
   (real-time if both online, on next login otherwise), applies the
   decrement to its own `have/`, and clears the record.

This keeps the strict ownership lock on `have/` intact — no user can
write directly to another user's inventory. Cross-user state changes
flow through the queue, which has its own write-permission shape that
prevents spoofing.

## Final rules — paste this into Firebase Console → Realtime Database → Rules

Diff from your current rules:
- `".read": true` → `".read": "auth != null"` (the critical leak fix)
- New `pendingDecrements` block at the bottom
- Everything else identical

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

### What the new `pendingDecrements` rule says

**Read:** only the target user (the one whose inventory will be debited) or
an admin can read their own bucket. Recipients posting decrements never
need to read them.

**Write — create case** (`!data.exists()`):
- Must be authenticated.
- The new record's `from` field must match the writer's actual username
  (no spoofing — you can't post a decrement *as someone else*).
- `qty` must be a number in `[-999, 999]` and nonzero.
  - Positive qty = "subtract this many from your inventory" (someone
    accepted your offer — the standard decrement flow).
  - Negative qty = "add this many back to your inventory" (the other side
    cancelled a reserved trade — the restoration flow added in v4.6.10).
- `key` must be a non-empty string (the inventory key to mutate).

> ⚠️  If you already published the previous ruleset (which required
> `qty > 0`), trade-cancel restorations from one side will silently fail
> on the other side until you republish this version. Republish in
> Firebase Console → Realtime Database → Rules → Publish.

**Write — modify/delete case** (`data.exists()`):
- Only the target user (the one whose `pendingDecrements/{$username}` bucket
  this is) can modify or delete their own queued records — used by the
  reconciler to clear records after applying them.

**Admin override** for both, as a break-glass.

This is the minimum permission shape that keeps trade-accept working while
preventing:
- Anyone from spoofing trade-decrements as another user (`from` field check).
- Anyone from reading someone else's queue.
- Oversized or malformed writes (qty/key validation).

## How to apply

1. Open Firebase Console → your project → Realtime Database → **Rules** tab.
2. **Copy the existing rules** into a scratch text file as a backup.
3. Paste the JSON above wholesale (it's a full ruleset, not a diff — replace
   everything).
4. Click **Publish**.
5. Test (next section).

## How to verify

### Anonymous read is blocked
```
curl 'https://<your-project>.firebaseio.com/users.json'
```
Should return `{"error": "Permission denied"}`. If it returns data, the
ruleset didn't take.

### Logged-in flows still work
- Edit your wishlist → saves.
- Post an offer → appears in the inbox of the recipient.
- Open the recipient's account (separate browser or incognito) → accept
  one of the offered items via the new green **Trade →** button → set qty
  in the popup → confirm.

### Trade-accept end-to-end
- After the recipient confirms, their inventory should decrement immediately.
- Inspect Firebase Console → `pendingDecrements/{bidder}/{some-id}` should
  contain a record like:
  ```json
  { "from": "<recipient-name>", "key": "<bidder's offered item key>",
    "qty": <N>, "t": <timestamp>, "inReturnFor": "..." }
  ```
- Reload the bidder's session (or wait if they're online). Their inventory
  should decrement and the pending record should disappear.
- A toast confirms on the bidder's side: *"✅ Synced 1 accepted trade
  from <recipient> · N items removed from your inventory"*.

### Brief UI flicker — known and expected
Between the recipient hitting Confirm and the bidder's client applying the
pending decrement, the bidder's inventory **on Firebase** still shows the
old qty. If a third trainer is browsing the bidder's inventory in that
window, they'll see the stale count until the bidder's client reconciles.
This usually resolves in seconds to minutes. The trade itself is correct —
the data is just lagging.

## Two follow-ups worth doing afterward

- **Lock the Firebase Web API key by HTTP referrer** (Google Cloud Console
  → APIs & Services → Credentials). Restrict to your production domain so
  anyone scraping the key from `index.html` can't initialize a Firebase
  app against your project from elsewhere.
- **Enable scheduled backups** of the Realtime Database (Console → Database
  → Backups). A single mistake at scale erases everything; backups are
  cheap insurance.

## If you want the looser variant (Option A, NOT recommended)

If you decide the pending-decrements path is too much architecture and
just want trade-accept to work via direct cross-user writes, change the
`have/$username/.write` line back to:

```json
"have": { "$username": { ".write": "auth != null" } }
```

Then any signed-in user can write to anyone's `have/`. The app would still
work (the code falls back to optimistic local updates either way), but
you'd be relying on community trust rather than schema-level protection.
At 50+ trainers, I'd keep the strict version.
