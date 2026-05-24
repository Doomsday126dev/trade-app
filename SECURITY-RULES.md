# Firebase Realtime Database — Security Rules Audit

This file documents the recommended Realtime Database rules for the PoGo
Trades app and explains why. **The actual rules live in the Firebase Console**
(Realtime Database → Rules tab), not in this repo. Paste the JSON from one
of the sections below into that tab and click **Publish**.

---

## What the app reads/writes

Mapped from the live code:

| Path                            | Who reads                        | Who writes                                                                                                          |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `users/{username}`              | Every signed-in user             | The user themselves (own record); admin reset path also writes other users' `pinHashed`/`authVersion`              |
| `users/{username}/lastSeen`     | All                              | Self (bumped on every interaction)                                                                                  |
| `users/{username}/lastUpdated`  | All                              | Self                                                                                                                |
| `wishlist/{username}`           | All                              | Self                                                                                                                |
| `dynamax/{username}`            | All                              | Self                                                                                                                |
| `gmax/{username}`               | All                              | Self                                                                                                                |
| `costumes/{username}`           | All                              | Self                                                                                                                |
| `have/{username}`               | All                              | Self **and** counterparty during a trade-accept (qty decrement on the other person's inventory)                     |
| `offers/{recipient}/{offerId}`  | All                              | Anyone authenticated (the whole point — anyone can bid on anyone's inventory item); recipient can also delete       |
| `trades/{tradeId}`              | All                              | Any participant of the trade                                                                                        |
| `requests/{requestId}`          | Admin only (ideally)             | Anyone — **including unauthenticated users**, because this is the signup flow                                       |
| `authIndex/{firebaseUid}`       | All (used during login)          | The owner of the UID                                                                                                |

## What's most likely wrong right now

If you've never touched the rules tab, your database is running on the
default Firebase test-mode rules, which are one of:

```json
{ "rules": { ".read": true, ".write": true } }
```

— or, slightly less bad —

```json
{
  "rules": {
    ".read": "now < <expiry-timestamp>",
    ".write": "now < <expiry-timestamp>"
  }
}
```

**Why this is the single biggest risk to your app:**

1. **Anyone on the internet can read every trainer's data** — friend codes,
   Discord handles, full inventories, offers, trade history, the lot. No
   account required.
2. **Anyone can delete the entire database** with a single HTTP request.
   `curl -X DELETE 'https://<your-db>.firebaseio.com/.json'` wipes everything.
3. **Anyone can spoof writes** — fake offers, vandalize wishlists, change
   other people's PINs by writing to `users/{victim}/pinHashed`, etc.
4. **Bots will find this.** Test-mode Firebase URLs leak into Google's
   search index, GitHub, public crawlers. Once leaked, it's a matter of
   *when*, not *if*.

This is the #1 thing to fix today. Code-copying worries are noise compared
to this.

---

## Recommended rules — three tiers

Pick **Tier 1 today** as a baseline. Move to Tier 2 when you have time to
test signups and trade flows. Tier 3 is for when the app scales beyond
the NYC community.

### Tier 1 — Minimum viable (paste this **right now**)

Blocks all anonymous access. Anyone with a valid Pokémon GO trainer login
can still do anything (which matches the current trust model), but the
internet at large can't see or touch your data.

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null",
    "requests": {
      ".read": "auth != null",
      ".write": true
    }
  }
}
```

The `requests` override is required because new trainers submit their
join request **before** they have an account — that path needs to stay
open for anonymous writes.

**Trade-off:** an authenticated trainer can still write to anyone else's
data. Inside a trusted ~30-person community this is fine. It's also no
worse than the status quo for authenticated users.

### Tier 2 — Path-scoped writes (recommended)

Same reads as Tier 1, but writes are scoped to each user's own data where
possible. The two exceptions match the actual app behaviour: anyone can
write to `offers/*` (you bid on others' offers) and `have/*` (because
trade-accept decrements both parties' inventories).

```json
{
  "rules": {
    "users": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && (
          !data.exists()
          || data.child('authEmail').val() == auth.token.email
          || newData.child('authEmail').val() == auth.token.email
        )"
      }
    },

    "wishlist":  { ".read": "auth != null", "$uid": { ".write": "auth != null && _ownerCheck($uid)" } },
    "dynamax":   { ".read": "auth != null", "$uid": { ".write": "auth != null && _ownerCheck($uid)" } },
    "gmax":      { ".read": "auth != null", "$uid": { ".write": "auth != null && _ownerCheck($uid)" } },
    "costumes":  { ".read": "auth != null", "$uid": { ".write": "auth != null && _ownerCheck($uid)" } },

    "have": {
      ".read": "auth != null",
      "$uid": { ".write": "auth != null" }
    },

    "offers": {
      ".read": "auth != null",
      ".write": "auth != null"
    },

    "trades": {
      ".read": "auth != null",
      ".write": "auth != null"
    },

    "authIndex": {
      ".read": "auth != null",
      "$uid": { ".write": "auth != null && auth.uid == $uid" }
    },

    "requests": {
      ".read": "auth != null",
      ".write": true
    }
  }
}
```

**Important — `_ownerCheck` is not a real function**, it's pseudocode
for "the username in the path maps to the signed-in user's auth email."
You can't easily express that in vanilla RTDB rules because of how your
auth emails are derived (`name.toLowerCase().replace(/[^a-z0-9]/g,'_') + '@pogotrades.nyc'`)
and RTDB rules can't apply regex `.replace()`.

**Two workable options:**

**Option A — lookup against `users/{$uid}/authEmail`:**

```json
"wishlist": {
  ".read": "auth != null",
  "$uid": {
    ".write": "auth != null && root.child('users').child($uid).child('authEmail').val() == auth.token.email"
  }
}
```

Repeat that block for `dynamax`, `gmax`, `costumes`, and `users`. This
lets the rule resolve "is this signed-in user the owner of this path?"
by reading the `authEmail` field you already store in each user record.

**Option B — store a `uid` field in `users/{username}`:**

When a user signs in, store `users/{username}/firebaseUid = auth.uid`,
then the rule simplifies to:

```json
".write": "auth != null && root.child('users').child($uid).child('firebaseUid').val() == auth.uid"
```

This requires a tiny code change but rules become much cleaner.

### Tier 3 — Admin gating (when you scale)

Add a `users/{username}/isAdmin == true` flag in the rules so only
admins can wipe `requests/*` (approving/denying), reset PINs on other
users, or write to admin-only paths.

```json
{
  "rules": {
    "$rest": {
      ".read": "auth != null",
      ".write": "auth != null"
    },

    "requests": {
      ".read": "auth != null && root.child('users').child(auth.token.email.split('@')[0]).child('isAdmin').val() == true",
      ".write": true
    }
  }
}
```

(Caveat: `split` isn't a real RTDB rule method either — store an admin
list at `meta/admins/{username} = true` and check
`root.child('meta/admins').child(auth.token.username).val() == true` if
you also stash `username` as a custom claim, or use Option B from Tier 2.)

---

## How to apply these rules (step by step)

1. Open <https://console.firebase.google.com>.
2. Pick your project (the one whose URL is in
   `index.html` → `const FIREBASE_URL = …`).
3. In the left sidebar, **Realtime Database** → top tab **Rules**.
4. **Before you change anything**, copy the existing rules into a scratch
   file. If the new rules break something, paste the old ones back.
5. Replace the contents with the Tier 1 JSON above.
6. Click **Publish**.
7. Test from a logged-in session and an incognito window:
   - Logged in: should be able to load the app, see inventories, post offers.
   - Incognito (unauth): app should fail to load data (network panel will
     show 401/403 from Firebase). The login screen should still render.
   - Try the request-access flow from incognito — it should succeed since
     the `requests` path stays open.

If anything breaks, paste the old rules back, then move on to Tier 2 once
you have time to test thoroughly.

---

## Other security hardening to consider

- **Lock down the Firebase Web API key.** In Google Cloud Console →
  APIs & Services → Credentials → click your Firebase API key →
  **Application restrictions: HTTP referrers** → add your production
  domain(s). Without this, anyone who reads your `index.html` and copies
  the API key can spin up a clone pointing at your project.
- **Enable Firebase App Check** if you go public. It stops requests that
  don't come from your registered app.
- **Audit your `users/{username}/pinHashed` field.** PINs should be
  salted-hashed, never plaintext. (If `pinHashed: false` exists on any
  legacy user, those PINs are stored in the clear — fix before tightening
  rules in case the rules block the migration.)
- **Backups.** Realtime Database has a built-in scheduled export — set up
  a daily Google Cloud Storage backup. A single bad write or a vandal who
  gets past auth could wipe data fast.
- **Don't commit your Firebase config to a public repo.** Once you go
  private this is moot; until then, anyone can take your `FIREBASE_URL`
  and `FIREBASE_API_KEY` out of `index.html` directly.
