# .152 actual Favorites metadata recovery

Live .151 native diagnostics showed all seven saved rows as transport_error/favorite-cache/deadline-exceeded, not a demonstrated missing timestamp. Its cache allowed5000ms while identity resolution allows25000ms and then reads the public projection. Cache concurrency4 also exceeded server callerConcurrency2. Failures were cached, so merely waiting could not promote a late response. Earlier fixtures used legacy/no-UID fast repository reads and missed the identity hop.

This repair retains exact identity/expected-UID/fence checks and existing public paths. Metadata uses two physical read slots and a35000ms total cap (25000ms identity allowance plus10000ms projection allowance). The underlying non-cancellable Firebase read still retains its slot if hung, preserving existing physical-read caps and blocked-queue settlement. No timeout, quota or permission on the server changes.

Simultaneous session identity requests batch through the existing maximum50-handle endpoint; one batch at a time, at most100 pending distinct handles, in-flight duplicates coalesce. Finished identities are never cached: subsequent opens still revalidate current identity/fences. Late or queued old-session results reject without issuing new old-session requests. Seven synthetic UID-bound Favorites with6000ms identity latency produce four batches (2,2,2,1), seven public reads, concurrency1 at identity endpoint and zero writes, rather than seven identity calls. This does not enable background polling.

Cached transient metadata failures get at most one forced retry per entry per cache session on re-entry; busy/rate-limit records are excluded. Repeated rerenders cannot create a loop; existing in-flight/physical dedup remains. A genuine transport failure now displays localized Unavailable instead of silently hiding the field. Genuine missing timestamps remain absent, never invented.

Native production verification must demonstrate an actual public publication date after protected deployment; source/synthetic evidence alone is insufficient. Logo/layout .151 repairs retained. No catalogue, auth, billing, backend or unrelated refinements.
