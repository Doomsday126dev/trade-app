# Provider onboarding readiness and next bounded work

This is an independent source change on .103/main
`07ee65bb6f20b0c009098489171bd01909cd0d3c`. Existing-account Google delivery is in
PR #96 and must not wait for the namespace transition below. Neither draft is a
release, provider enablement or authorization to operate on real accounts.

## Onboarding implementation retained and corrected

Retained from #61/#62: Firestore-first identity; verified recent Google subject and
current Firebase Auth account lookup; HMAC subject index; one atomic account,
handle, provider and request transaction; namespace certification; lost-response
readback; owner-bound continuations; no fabricated PIN/legacy identity; UID-rooted
profile and account sync; canonical wants/Groups projection; UID-owned public
shares and sanitized anonymous lookup. Current .103 declaration/publication support
is already present and retained. Ordinary boot/provider gates remain unchanged.

Corrections in this draft:

- A pending creation can be reconciled only by its UID digest, checked before any
  authority read. A fresh login by that same UID can reconcile without resending
  creation. A newer pending operation cannot be overwritten by a late response.
- Same-session reconciliation retains the confirmed optional profile in memory.
  It still never writes friend code/profile to onboarding continuation storage.
  Reopening a clean device cannot recover unsubmitted optional profile fields;
  existing canonical profile initialization and subsequent editing remain the path.
- The final UI handoff rechecks the captured UID/lifecycle before activating the
  account and carries that lifecycle into activation. Current release metadata is
  passed to the creation client; protocol version 1 still determines compatibility.
- Reuse only PR #63's small RTDB null-child safeguard: an active Rules projection
  may omit `releasedAt: null`; all other schema-1 fields remain exact. Released,
  malformed and extra-field records remain fail closed. No timed freeze, expiry
  bypass, deployment runner or production CLI from #63 is adopted.
- A provider-public test hardcoded .86 despite current assets correctly carrying
  .103. It now checks both provider assets against the actual release marker.

The focused regression set passed 41 tests; existing public-projection/gateway
coverage passed 87. The main foundation emulator matrix already passed 32 tests in
this continuation, including holds, namespace certification, races and exact
reciprocal readback. CI reports the final heads separately. Injected/emulated
Google identity is not a real Google OAuth result.

## Concrete remaining creation dependencies

1. A reviewed server-enforced namespace cutover, described below. Existing creation
   code deliberately requires an active bounded freeze plus fresh exact schema-2
   certification. It is not yet an indefinitely operating provider-registration
   authority. Do not delete those checks to launch.
2. Reviewed source-pinned authority and creation/read/public/directory/favorite
   gateway packages, provider subject HMAC Secret Manager version and retained key
   compatibility floor. No key exists by implication of these source files.
3. Compose and test provider profile, canonical sync and public projection Rules
   **on the actual current Rules baseline**, retaining immutable bindings and
   retired-UID fences. Historical .86 candidates and PR #63 are not deployment
   inputs. Verify owner/other-user/anonymous denial, publication privacy and all
   current declaration variants before enablement.
4. Production-supported build/deploy integrity and the parallel security findings
   must be resolved before using a deployment path. Preserve exact prior revisions,
   package digests, service identities, API restrictions and rollback receipts.
5. After synthetic qualification, approve one disposable Google-only canary with
   explicit handle choice, no PIN, fresh second-device login, profile interruption,
   wants/special requirements, Groups/Favorites, publication/search, and mobile/PWA.
   Establish a verified recovery alternative before general provider-only rollout.
   No real creation or namespace mutation is authorized here.

## Smallest finite namespace transition to implement next

Use one bounded **protection-only** legacy namespace cutover. It does not migrate
legacy accounts, rewrite their UIDs, publish archives or require full account-sync
conversion. Historical counts such as 58 handles / 8 protected are not fresh input.

1. Prepare a source-pinned manifest for the exact current Rules and every namespace
   writer: browser `createMemberNow`, request approval, Admin provision/repair,
   scripts, service identities and retained old clients. Separate existing same-UID
   updates/reset from new identity allocation. Enumerate exact rollback and terminal
   conditions before approval. Reuse #63's sealed-input/provenance and readback
   principles, not its unqualified all-in-one runner or rollback claims.
2. In a separately approved bounded window, enforce the Rules-visible freeze first,
   then its canonical Firestore counterpart. Prove all new legacy bindings,
   handle-changing repair and request-to-approved allocations are denied, including
   privileged SDK writers (Rules do not constrain Admin SDK/IAM bypass). Drain
   pending writers before capturing the live namespace; do not treat a timeout as
   proof that an operation stopped.
3. Inventory all active legacy namespace evidence after that fence. Preserve valid
   existing canonical claims exactly. For every unprotected normalized legacy key,
   create a reviewed **hold**, not an account or guessed UID claim. Protect every
   alias in normalization collisions under the same unavailable key; ambiguity
   never selects an owner. Include all authoritative legacy name sources and
   already approved/in-flight allocations in coverage or refuse cutover. Compare
   exact normalized sets and coverage digest on fresh readback, not just counts.
4. Permanently close old product-identity provisioning writers. Old browser/Admin
   requests to create `users`, `loginDirectory`, or legacy `authIndex` bindings must
   be server-denied; existing same-UID updates/PIN recovery remain available. Remove
   or narrow privileged provisioning credentials after their exact consumers are
   reviewed. New PIN-registration UI is then retired. A stale client must not
   bypass this by writing a directory/approval first. An orphan Firebase Auth signup
   is not a trainer account and confers no name ownership; it must not be converted
   into a legacy binding by repair. This work deletes no such Auth records.
5. Seal a durable canonical **legacy-writers-closed** namespace generation binding
   the permanent Rules/IAM writer policy, normalization version and full protected
   legacy coverage. Implement and review the new server admission predicate in a
   separate bounded source PR: transactionally read that sealed generation plus
   account/handle/provider occupancy on every registration. Existing freeze+short
   certification remains the only admission path until this alternative is proven.
   This is a replacement proof of permanently closed legacy allocation, not a
   bypass of namespace certification or an expiry that reopens competing writers.
6. Invalidate the temporary creation certification before ending the temporary
   freeze. Permanent legacy-creation denial stays installed; only normal existing
   account activity resumes. Enable provider registration against the sealed
   generation only after all hold/claim and old-writer denial tests pass. If closure
   cannot be proved, leave provider creation disabled and close the window through
   its reviewed restoration procedure. No open-ended freeze or automatic retries.

This has a finite end: old namespace writers permanently closed, all old names
claimed or held, new provider allocation through one transactional authority.
Ambiguous holders may be resolved later with verified ownership; they do not hold
healthy existing-account Google linking hostage.

## Discord: next implementation step, separate from Google

Read #57 at `0190eecf3857affd0475e6a55b221d52e9dc8b97`. Its source-only prototype
has exact redirect/state/browser binding, server-held S256 PKCE, `identify` only,
server code exchange and `/users/@me`, token revocation, collisions, atomic mock
subject linking, separate returning login and in-memory injected token minting.
It is not loaded or deployed on main. No production Discord identity is established.

The next bounded PR should replace **only its existing-account link/return test
adapters** with a trusted Firebase ID-token/App Check authority and private
Firestore transactional flow/subject store, while keeping deployment and UI off.
Require exact healthy original UID, recent verified authentication and current
account boundary before/after link; consume one-use state with TTL and browser
binding, and prove collision/concurrency/replay/crash outcomes. Mint custom tokens
only for the exact current reciprocal subject→UID mapping. A custom-auth token
alone must not masquerade as a verified Google/Discord provider: returning canonical
reads and linked-method discovery need server-verified Discord mapping evidence.
Test this in emulators before any production runtime export.

Subsequent finite gates: exact HTTPS callback/app and server secrets; deployment
permissions/token signing and rotation; real owner-authorized OAuth canary; explicit
new-user onboarding through the same certified namespace (current creation accepts
Google only); transactional unlink with a verified remaining method, stale-login
and refresh-session policy; then verified lost-provider recovery. No email,
Discord username, guild, contacts, messages or bot scope. Keep only `identify`;
current-user ID is the authority, not a display name. Validate actual Discord PKCE,
state and token/revocation behavior in the real canary rather than inferring it
from the prototype.
[Discord OAuth2](https://docs.discord.com/developers/topics/oauth2),
[Discord current user](https://docs.discord.com/developers/resources/user#get-current-user),
[Firebase custom authentication](https://firebase.google.com/docs/auth/admin/create-custom-tokens)

## Finite PIN retirement and returning-user recovery

1. Finish provider-only onboarding/recovery and the namespace cutover, then stop
   new PIN registrations at both UI and server allocation boundaries.
2. Existing users log in with their current PIN or already-linked provider. Link
   explicitly to the authenticated original UID. Verify a fresh alternative login
   on another browser/device and a recovery option before marking a PIN retireable.
3. Add a reviewed per-account credential-retirement state and session protocol
   before removing any password: atomic, idempotent, original UID bound, and checked
   by every reset/provision/repair consumer. Reset must not reinstall a retired
   password or resurrect an older retired UID slot. Verify interruption and replay
   across the credential update; disabling a UI control alone is insufficient.
4. Returners with a verified linked provider go directly to the same UID/account.
   Returners who still need PIN keep the current method and verified same-UID reset
   path until their own retirement gates pass. Recovery enrollment must be proven
   under an authenticated original account (another provider or reviewed recovery
   credential). If both provider and PIN are unavailable, require independently
   verified ownership and exact account evidence; unresolved ownership stays held.
   Never reset or claim by matching email, trainer/Discord name, or possessing an
   archive. Recovery preserves account data and all reviewed sync evidence.
5. Only after actual consumers are removed may legacy mappings retire: PIN/version
   scan and `syncOwnAuthIndex`, reset/repair eligibility, legacy account-sync
   enrollment/recovery, canonical legacy readers, public-share fallback and Rules
   ownership checks. Audit live usage and supported old clients, migrate those
   consumers, retain a compatibility period, then separately approve retirement.
   Do not remove mappings merely because an archive was created.

Archives preserve data and aid review; they never authenticate a user or authorize
an account claim. No PIN credential removal, ordinary-user migration, account
replacement or deletion happens in either source draft.
