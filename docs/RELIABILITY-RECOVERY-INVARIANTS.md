# Recovery invariants and scenarios

Design recorded before implementation of the second review phase.

## Invariants

1. Detachment invalidates listener/session authority synchronously. The UI can
   start a replacement runtime after at most 250ms of shutdown waiting even if
   an issued transport request never settles. This is not a request timeout or
   a claim that the request was cancelled.
2. An uncertain operation retains its original owner, operation ID, input hash
   and durable journal record. Only a current runtime with canonical proof may
   acknowledge it. A late old-session response must not mark it failed, clear a
   newer publication marker, publish more rows or touch the replacement UI.
   The retired journal connection must reject new write transactions and abort
   pending write transactions, including mutations that already awaited a read.
3. Retired runtime resources close after their work actually settles; the stop
   result distinguishes `closed` from `detached`. A detached resource can remain
   alive while transport is unresolved. Page termination can abandon that
   in-memory cleanup safely because pending intent is already durable.
4. Reopening the same owner's journal retries the same operation ID. A late
   commit plus retry must produce exactly one entity, not a second intention.
   A different owner must neither inherit nor drain those records.
5. Remote publication repair starts only after validated canonical acceptance,
   a healthy current listener, online state and the existing projection gate.
   Initial hydration uses existing startup publication. Repeated identical
   snapshots and changes only to Favorites/tags do not trigger repair.
6. Repair uses the existing accepted-public projection and product allowlist;
   never raw account snapshots, optimistic rows, pending queue snapshots,
   Favorites, tags, recovery evidence or identity metadata. It introduces no
   new sharing consent, visibility setting or public data field.
7. Remote changes coalesce and use existing durable publication markers and
   bounded exponential retry. No success is reported merely because a timer
   elapsed. Changes arriving during publication request a latest-state pass.
   Raw SDK public-write completion is observed independently of any application
   deadline; only a current same-owner runtime can repair a late old write.
   Sustained successful ACKs just beyond the deadline must converge rather than
   issuing identical writes forever. Skipping a rewrite requires actual raw ACK
   proof and matching current-content readback; proof is one-use and short-lived.
8. Invalid remote data closes authority; offline, stopped, unready or switched
   sessions cannot gain publication authority through recovery.

## Failure scenarios to qualify

- Hold a private request forever, stop, start same-owner and different-owner
  replacements; verify bounded stop and retained intent before releasing it.
- Release an old successful or failed response after replacement recovery;
  verify no stale acknowledgement/error/metadata/extra publication.
- Stop during startup read, public publication or provider-profile request;
  verify replacement does not wait on the retired transport.
- Lost acknowledgement followed by retry and reload; verify same operation ID
  and one canonical entity, preserving later independent user changes.
- Writer commits then cannot publish and disappears; healthy observer repairs
  current accepted public rows within seconds without another user edit.
- Remote add/edit/delete, identical echoes, bursts and change during a slow
  publication; verify coalescing, latest rows and no publication loop.
- Offline observer, reconnected observer, permission failure and reload after
  failure; verify honest pending status and durable recovery.
- Favorite/tag-only updates, unresolved catalog, invalid owner/schema, optimistic
  rows and session switch during repair; verify no newly exposed private data.

## Review boundaries

No production writes or deployment. Transport deadlines and cancellation are
not being invented. Cross-device globally ordered public writes are still
limited by existing backend contracts; this repair provides eventual recovery
from validated current state, not a cross-client distributed lock.
