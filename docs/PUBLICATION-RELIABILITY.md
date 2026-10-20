# Canonical saves and public publication

The private Saved state means accepted account data and the local operation journal agree. It does not establish that the public projection was published. When publication fails after a private acknowledgement, the save pill now says Saved; sharing pending and tapping it retries from accepted canonical records. Reconnect and subsequent startup also retry. Canonical publication requires the current session and a hydrated profile, but does not wait for legacy list reads; all published list rows come from accepted canonical data. Legacy publication retains its complete-source gate.

`users/{name}/canonicalListActivity` contains only schema version, accepted trade timestamp (including deletions), and the count of unified wanted declarations across categories. The timestamp comes from accepted trade entities, not local click time or Favorites. This owner-written summary does not grant access to canonical private records. Admin rows without this summary explicitly display legacy entries/update; they are not current canonical activity. Activity-summary failures are logged without blocking public publication; existing rules may fence legacy metadata while allowing canonical updates. A retry occurs with subsequent publication. Summary transactions reject older timestamps from another device; acknowledged summary writes are mirrored locally. The public snapshot profile timestamp uses the same accepted trade timestamp.

The service worker clones a sprite response before queued cache work, so browser consumption cannot invalidate the later cache put. Firebase responses remain outside the service-worker cache. External sprite optical-analysis CORS/404 failures are a separate existing issue; this patch does not claim all images or all slow network conditions are fixed.

Validation includes a real Response body-consumption regression, runtime publication retry, profile-only canonical publication, failed publication after a confirmed private save, summary timestamp/counts, independent public server read, and reopening IndexedDB. The optional normal-sync-product emulator test uses synthetic NormalProduct only, an unsigned emulator-only identity, ETag conditional REST transactions, and the deployed RTDB rules. It requires POGO_DATABASE_EMULATOR to be a localhost URL; production requests are blocked. Admin owner authentication is used only to seed and independently inspect disposable emulator fixtures, not for application saves. It also proves unauthenticated canonical reads are denied while public publication reads succeed. No production data is modified by these tests.

The initial diagnosis found recent Mazer/Roninshima server mutations with old legacy timestamps and old public copies. Captured accepted public rows project successfully offline. The legacy hydration dependency and provider-only retry no-op reproduce a publication failure mechanism, but the original device's precise error is unavailable. Spark storage/bandwidth overage metrics were false, with substantial headroom. Do not attribute the complaint to billing or claim every attempted save succeeds.

Release scope: based on live release-2026-09-23.123 (62482523588e5f7a3065936c93bfa043d4d31fb5), with only these fixes and a coherent release marker. The runtime excludes subsequent undeployed Settings/Share/appearance and sprite changes, including PR 145. Merge this branch without squashing before selecting its immutable runtime commit; the runtime must be reachable from main. Use current reviewed Pages control selector release-pages-control-fe32497866cb09f5fbef2df23d4918c00241c64d and the supported manual dispatcher. Rollback target remains release-2026-09-23.123 at the exact SHA above. No billing, rules, access, credentials or Functions deployment is required.


The .127 follow-up addresses PR146 discussion_r4317061779: a stale cached
activity summary was included in ordinary profile updates, queued child sets,
and overlays. Profile inputs and queued root/child replay now exclude derived
activity, root profile replay uses partial updates so omitted derived fields
are preserved, and old derived queue entries are discarded without changing
the editable bio/avatar fields. The accepted-canonical summary transaction is
unchanged. Synthetic desktop/mobile emulator coverage verifies a newer summary
survives an offline stale profile edit, incoming snapshot overlay and replay.
No actual user impact or lost list entries was established. PR147 and PR148
review threads/summaries contained no additional findings at this review.


## .128 SDK payload compatibility and automatic recovery

The affected Safari PWA was online on .127 with healthy private sync and zero pending, blocked or conflicted operations. Its public publication error was `hasOwnProperty is not a function`. Populated v2 compatibility lists were null-prototype dictionaries; Firebase 12.14.0 calls an instance `hasOwnProperty` while validating nonempty payloads. Empty lists did not trigger it. The list builder still accumulates safely with null-prototype dictionaries, then emits ordinary objects at its transport boundary. This preserves declaration content and the existing allowlist. A regression uses the actual @firebase/database 1.1.3 component from Firebase 12.14.0, reproduces the captured old shape and verifies SDK writes plus independent unauthenticated server reads under emulator rules. Prior REST-adapter coverage bypassed this SDK validation.

Publication now records a small owner-bound pending marker in IndexedDB, never a second cached public payload. It uses the latest accepted canonical rows on each attempt, coalesces concurrent requests, retries with 1/2/4/8/16/30 second backoff while online with a healthy current listener, and pauses on offline/session/listener loss. Startup and healthy-listener recovery resume pending work. Only acknowledged and verified publication clears the marker. A slow initial attempt says Saved; updating shared list; a failure retains Saved; sharing pending and explains automatic retry. Real outages cannot honestly be guaranteed to clear within seconds. Ordinary publication-state updates do not reapply canonical list rows.

Tests cover normal, transient and sustained failures, slow/coalesced requests, offline/reconnect, restart with the durable marker, session stop, legacy/canonical product flows, SDK validation and emulator persistence. Production verification must compare the public projection to accepted private rows without editing list entries; controller UI status alone is insufficient evidence. No billing, rules, access, credential or backend deployment is needed for this payload fix.
