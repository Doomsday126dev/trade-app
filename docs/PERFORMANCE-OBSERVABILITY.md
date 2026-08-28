# Privacy-safe performance observability design

Status: design-only, local tooling. No production runtime imports this module,
no event is persisted, and no transport or backend exists.

The canonical local schema is implemented by
`scripts/performance/privacy-safe-observability.cjs`. It accepts exactly:

- `schemaVersion`: literal `1`.
- `event`: startup, protected feature activation, My List filter, or My List render.
- `release`: public application release identifier.
- `viewportBucket`: coarse desktop or mobile size bucket.
- `durationBucket`: coarse elapsed-time bucket, never a raw timestamp.
- `longTaskCountBucket`: coarse count bucket.
- `listSizeBucket`: coarse count bucket, including `none` for startup events.

The schema deliberately excludes exact timestamps, URLs, user agents, device
identifiers, Firebase UIDs, trainer names, Pokemon names, list contents, search
queries, tags, free-form text, IP-derived data, and raw performance traces.
Unknown or additional fields fail validation.

Any future collection proposal requires a separate privacy and product review,
an explicit transport design, retention limits, user-facing policy review, and
new authorization. This phase adds none of those capabilities.
