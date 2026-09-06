# Trainer Change Summary Readiness

The client now provides device-local recurring-trainer comparisons using the existing
trainer-history snapshots. Explicit "Mark checked" advances a Favorite baseline;
refreshing or unavailable reads do not. No cross-device history backend is enabled.
The requirements below apply to a future synchronized history capability, not to
the current bounded local comparison layer.

## Required identity boundary

- Each viewer must be represented by an authenticated, immutable Firebase Auth UID.
- Trainer handles remain presentation data and must not own viewer history.
- A viewer's last-seen state must be private to that viewer and inaccessible to other members or administrators.

## Revision model

- Every published trainer list needs a stable revision or content fingerprint derived from its complete public projection.
- Revisions must distinguish added, removed, and changed public entries without using private organizer data.
- A viewer-specific record must identify the latest trainer-list revision that viewer has acknowledged.
- The record must synchronize across the viewer's devices and use monotonic conflict handling.

## Diff semantics

- `added`: an entry is present in the current public revision and absent from the acknowledged baseline.
- `removed`: an entry is absent from the current public revision and present in the acknowledged baseline.
- `changed`: the canonical entry remains present but its published category, priority, or public modifiers changed.
- Private tags, local Favorites, and retired inventory data never participate in the diff.

## Baseline advancement

- Opening a trainer may prepare a pending acknowledgement, but must not silently advance the baseline before the complete revision is rendered successfully.
- A failed, partial, stale, or unsupported public-share read must leave the previous baseline unchanged.
- The acknowledgement operation must be idempotent and tied to the exact revision shown.
- Newer concurrent revisions must not be overwritten by an older device acknowledgement.

## Activation prerequisites

Implementation requires reviewed Rules, a bounded viewer-history schema, migration and rollback plans, cross-device conflict tests, privacy review, explicit approvals, and production observability. No part of the current frontend-only milestone authorizes those changes.
