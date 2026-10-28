# Provider host and owner recovery candidate

Local qualification milestone, 2026-10-28. All Discord host/recovery entry
points require explicit candidate flags and an exact configured UID. Candidate
scripts are absent from the production loader and service-worker inventory.
No live accounts, permissions, credentials, configuration or PIN availability
were changed. Review this follow-up separately from the preceding PR173 head
79fbdd5109ce9f5d1e909a3c935c4a62c5ee01aa.

## Integrated paths

- Discord's verified authenticated reader feeds the same UID-bound application
  profile, sync and publication runtime used by Google. Reload may resume only
  for the exact canary UID, with no competing auth commit or blocked checkpoint.
- Same-owner recovery uses the actual repository and watched mutation controller,
  durable IndexedDB plan/receipts, per-operation authoritative readback and
  current-session checks. It publishes accepted projections after each batch.
  Favorites retain the existing trusted write transport and exact target resolver.
- A reviewed plan is split deterministically into at most 25 operations/64 KiB
  per batch (each item must fit; at most 20,000 operations). Tags precede Favorites.
  Each ADD is verified against the original same-UID bundle and real catalogue
  identity. No journal queue is replayed as authority. Another user's UID,
  tombstones, conflicting additions and newer edits stop the import.
- Reload requires another explicit review of the retained plan. A lost response
  with matching authoritative data is reconciled without another write. A pending
  receipt and absent data remain blocked as outcome-unproven. Cancellation stops
  before the next write; an already-started write may finish, and later readback
  must prove it. Nothing automatically expires or clears that checkpoint.
- Legacy conversion uses actual catalogue parsing/identities and leaves unknown
  or divergent rows as explicit recovery candidates. It retains original sections,
  orders and pending-queue evidence; raw pending writes are never executed.
- Provider profile recovery fills only blank supported fields, returns conflicts
  for nonblank differences, and uses the captured profile revision in the actual
  serialized runtime mutation. A concurrent newer edit wins.
- Trainer recents and snapshots use an append-only owner-bound local archive.
  Current history wins; normal history bytes are not overwritten. Active recents
  and snapshots retain existing product size limits. Favorites/tags must use
  canonical imports, never a history-based permission or identity shortcut.
- Display preference recovery supports theme and interface locale only. Explicitly
  reviewed owner-scoped overlays never overwrite normal device values. Raw value
  and normal-choice revision checks invalidate overlays after later choices,
  including across tabs. Conflicting overlays fall back to the normal preference.
  Reload reapplies only for the exact owner. Language loading checks the lifecycle
  and current choice again before rendering. Sign-out restores ordinary display
  preferences. Unsupported preference keys are returned for manual review.

## Evidence and boundaries

Tests use synthetic browser data, real IndexedDB reload/two-tab behavior, the real
merge PATCH path, local Firebase demo emulators, and extracted real host functions.
Repository state is synthetic in the reload fixture; this is not a production
migration proof. Emulator server-authorized cross-UID transfer remains separately
restricted to fresh control of both accounts and durable receipts.

This does not make PIN retirement ready. A default-off end-user review interface
and real owner-source export composition are now implemented and require
independent review and staging qualification. Coverage certifies the provided
bundle schema/sections and explicit feature attestations, not universal recovery. Group
memberships, permissions, administrative roles, share URLs/visibility, raw sync
queues and receipts are retained as reference evidence, not restored grants.
Wallpaper, search-language overrides and unknown preference fields need explicit
adapters/review; they are not silently applied. Oversized archives remain intact
in the backup but cannot all become active history under current limits. Large
cross-UID imports still have the demo executor's 50-addition/128-KiB review limit;
the batching path here is same-UID only. Recovery without source-account control
has no implemented policy/bypass. Existing PIN accounts remain available.

The injected first-signup custom-token minter composition is implemented and
qualified locally. Reviewed namespace inventory, all-entry-point activation policy,
dedicated named canaries, identify-only OAuth consent, staging end-to-end proof
and the narrow staging permissions/secrets in
[the staging package](DISCORD-STAGING-MINIMAL-APPROVAL.md) remain prerequisites.
No fake enabled Discord button or production provider-first registration is added.

The finite release boundary is [the signup/linking acceptance checklist](PROVIDER-SIGNUP-LINKING-ACCEPTANCE.md). Large cross-UID restore and source-inaccessible recovery are later requirements, not blockers to safe ordinary signup or same-UID linking.
