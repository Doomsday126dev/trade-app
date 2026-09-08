# Offline synthetic archive and restore proof

Status: tooling for review. Baseline: `c3fd690a2a2c46dab448873b244e496199283694`,
runtime `2026-09-07.100`. No production capture, account migration, merge, deployment,
runtime schema, UI, provider rollout or Firebase connection is part of this proof.

**Preserve user information indefinitely; retain versioned data readers rather
than every historical running application.** The proof restores with only a small
archive reader, its schema and an independently retained capture receipt. The
standalone test removes access to the application's `js/` tree and disables
outbound APIs. The old application is used only to construct and independently
check representative synthetic wire records during qualification.

## Run and inspect

Use Node.js with the built-in test runner, Web Crypto and `base64url` support. No
Firebase CLI, emulator, browser, credential, npm installation or network is needed
for the archive proof itself.

```sh
node --test tests/offline-archive-restore.test.cjs
node scripts/archive-proof/prove.cjs
```

The second command creates a new directory beneath the OS temporary directory and
prints its results and artifact paths. To keep an inspectable run in this worktree:

```sh
mkdir -p .local
node scripts/archive-proof/prove.cjs --output .local/archive-proof-review
```

The output directory must not already exist. The executable has no input account,
Firebase endpoint, credential, import or live-restore option. It constructs its own
synthetic source, writes a temporary source fixture, exports and validates the
archive, removes the source file and drops its source reference, then restores into
a new target. Comparison digests survive source destruction. This is a functional
destruction test, not a claim of secure memory erasure or physical disk erasure.

Artifacts include `synthetic.archive.json`, `capture-receipt.json`, the schema,
`proof-results.json`, and a `restored/` directory. The source fixture containing
excluded **synthetic** credential sentinels is gone before restore begins.

## A. Versioned archive schema

The machine-readable [JSON Schema](verification/archive-proof/archive-v1.schema.json)
describes the closed JSON shapes. [schema.cjs](../scripts/archive-proof/schema.cjs)
defines those shapes; [format.cjs](../scripts/archive-proof/format.cjs) adds mandatory
semantic ownership, catalog, operation, hash and restoration-boundary validation.
Passing JSON Schema alone is insufficient to authorize a restore.

```text
format: trade-app-user-archive
archiveSchemaVersion: 1
capture: kind=offline-synthetic, fixed capturedAt, snapshotId
source: release, commit, adapter version, accountSync/history schema versions
provenance: accountId/ownerUid, current handle, evidence, alias intervals,
            safe access linkage, retired-UID fences
catalog: versioned exact identity snapshot with form/costume/region/max/gender facts
canonical: account metadata, active-source entities, profile, public-share state,
           server migration/recovery/review evidence
knownDevices: owner-attributed history, journals, legacy queues/cache evidence,
              ordering, viewed snapshots, device preferences
historical: typed records with mandatory inert-only disposition
dispositions: field/path handling and reasons (no excluded values)
coverage: captured devices; other devices unknown; volatile unsaved work not captured
compatibility: filesystem target v1; no authentication recreation/replay/publication
integrity: algorithm, canonicalization version, per-section hashes, payload hash
```

Capture timestamps and identity provenance remain unchanged on re-export. A new
capture has a new identity/timestamp and therefore a new digest; it is not falsely
presented as byte-identical to an earlier snapshot.

This is a proposed **archive** contract, not a change to the application's live
accountSync v1, history v3 or backend schemas. The `.100` synthetic source adapter
is deliberately closed and release-specific. Unknown fields stop capture so they
can be classified; there is no catch-all raw user record or silently truncated bag.

## B–D. Field disposition and secret boundary

“Safe metadata” means non-credential information suitable for a private account
archive. UID, handle history, friend code, notes and provider identifiers can still
be personal information. This proof creates only synthetic values; it does not
produce a public backup of real users.

| Information | Archive treatment | Restore treatment |
| --- | --- | --- |
| Canonical UID/account ownership, source commit/schema, paired auth-index/profile evidence | Preserve identifiers and reviewed evidence references | Require separately expected owner/provenance; never claim login authority |
| Proven aliases / handle reuse intervals | Preserve spelling, owner, time interval and proof reference; allow non-overlapping reuse | No case-fold guessing, automatic account merging or handle reservation |
| Access-method kind, linked/revoked state, non-secret provider subject key, credential epoch | Preserve exact linkage metadata | Inform recovery review only; never recreate Firebase Auth/provider linkage |
| Retired UID, replacement UID, retirement evidence | Preserve | Retired UID cannot become canonical owner; a stale device must re-prove its binding |
| PIN (plaintext or hash), password, password hash, refresh/ID/access/custom tokens, service-account private key | Exclude at explicit source boundary; no value hash in the archive | Intentionally non-restorable; independent access recovery is required |
| Legacy synthetic `authEmail` | Derived routing field, excluded | Do not rebuild reusable access from it |
| `pinHashed`, session hints, `pgu`/`pguts`, Firebase Auth persistence | Excluded/non-restorable implementation state | Never resume a session from archive contents |
| Exact wants, H/M/L or empty priority, Lucky/XXL/XXS/shiny, gender, free-text qualifier, notes, source lane and ordering | Preserve full v1 records plus exact catalog identity; do not collapse species or source rows | Materialize wants-only `active.json`; preserve explicit no-priority semantics |
| Entity generations, revisions, field revisions/mutation IDs/hashes, lifecycle and deletion evidence | Preserve as data | No recreation of old listeners, transactions or authorization state |
| `backgroundId`, `quantity`, `mirror` retained on wants; FT/inventory/trade-era records | Preserve typed evidence, including original fields | Inert; omitted from active wants. Background suppression matches `.100` `productDeclarations` |
| Profile friend code, bio, Discord, avatar choice, wallpaper | Preserve exact allowlisted values and source authority/revision metadata | Materialize profile values, never admin privileges |
| Favorites, private Groups/tags, target UIDs, labels, membership booleans | Preserve canonical records and device observations separately | Materialize canonical organization; do not use a stale device to overwrite it |
| Checked/new-since-checked baselines, target UID, `seenAt`, lists and v2 declaration arrays | Preserve per-device, including recents and viewed-list snapshots | Keep source timestamps; do not mark everything checked “now” |
| Pending/sending/blocked/conflicted/resolved/acknowledged journal work and optimistic entity copies | Preserve operations, base generations/revisions, input hashes, errors/status and conflict alternatives | Quarantine; never drain/replay the old queue |
| Server and device migration records, unresolved candidates and recovery-review acceptances | Preserve non-secret evidence, including unresolved target UID as empty | A past acceptance is not a new replay or authentication grant |
| `legacy-source:<migration-id>` retained source snapshots | Preserve typed owned lists, boards, queues, organization and order | Inert device review; no raw profile/credential dump |
| Public-share publication status and exact published snapshot, including v2 declarations and compatibility lists | Preserve the observation, even if stale relative to canonical wants | Private `publication-review.json`; never publish, reserve a URL or turn sharing on |
| Locale/theme/search/export/safe-transfer choices, local ordering and own cached lists | Preserve the represented device choices with device attribution | Available for future explicit import; cached work is not canonical authority |
| SDK instances, App Check/session tokens, claims, admin authorization, listener/session generations | Excluded or intentionally non-restorable | Re-establish independently in any future real integration |
| Sprite/SW/event/network caches and derived indexes | Reconstructable; not wholesale archived | Rebuild independently; do not confuse caches with queued user work |

The allowlist stops unexpected structured secrets, including secrets hidden in a
historical object or a journal metadata extension. The synthetic sentinels and
their hashes are checked absent from the archive. Arbitrary user-authored free text
cannot be certified secret-free merely by inspecting field names. A future real
capture flow needs a deliberate treatment for a password/token a user themselves
pasted into a note; it must not silently redact and then claim full preservation.
No such secret text is included in this proof's notes or other user-data fields.

## E. Deterministic integrity

`trade-archive-json-v1` uses UTF-8, lexically sorted object keys, exact safe integers,
JSON string escaping, and preserved Unicode code points. It performs no Unicode
normalization, trimming, default substitution or value coercion. Array order stays
meaningful except documented keyed collections (entities, evidence, catalog,
devices, journal IDs), which sort by stable identities before export. Wants also
retain their explicit `sortOrder`; history/order/public-declaration arrays survive
unchanged. This is a named, versioned codec, not a claim of RFC 8785 conformance.

The payload is every top-level field except `integrity`:

```text
sectionHash(k) = SHA256("trade-archive-v1\0section:" + k + "\0" + canonicalJson(payload[k]))
payloadHash    = SHA256("trade-archive-v1\0payload\0" + canonicalJson(payload))
```

The exact section set is validated. The receipt separately pins owner, source
commit, capture ID, provenance digest, catalog digest and payload digest. This
detects substitution even if someone recalculates the archive's internal hashes.
The reader also rejects duplicate JSON keys, noncanonical/ambiguous encodings,
unsafe object keys, unsupported values, incomplete shapes and oversized inputs.
The inspectable writer uses deterministic two-space JSON plus a final newline.

**Hashes do not authenticate the author.** The fixture receipt is retained before
source destruction and is trusted by the offline proof. If an attacker supplies
both a new archive and a new receipt, the receipt itself is not independent proof.
A real system must anchor receipts outside the supplied archive (for example,
authenticated capture records or a reviewed signing service), establish ownership
afresh, and protect receipt/catalog provenance. Signing keys and credentials would
remain outside archives. This task implements no such production service.

## F–G. Round trip and failure cases

The executable proves the following sequence:

1. Construct synthetic state using the current accountSync operation/merge and
   recovery-domain contracts, current trainer-history store, catalog decorator and
   public-share builder. Verify source-module hashes against the `.100` fixture
   provenance manifest before using them.
2. Export through the allowlisted adapter, validate structure, ownership, hashes
   and the separately retained receipt; confirm excluded credential sentinels and
   their hashes never entered the archive.
3. Delete the synthetic source file and drop the source object; retain only expected
   semantic/record/history/recovery/public-state comparison digests.
4. Restore into a new directory. Existing directories and symlink targets are
   rejected. Validation finishes before any target/staging file is written.
5. Compare current-domain semantic state and all original canonical wire records,
   including FT/tombstones as preserved evidence. Verify history, server recovery
   evidence and public snapshot equality. Check canonical and pending records with
   the independent current domain validators.
6. Confirm retired records remain inert, conflicts unresolved, device-only edits
   unapplied and publication inactive in the target.
7. Reassemble a new archive from the split target files. It must match the initial
   archive canonically **and byte-for-byte**. It cannot read the destroyed source.

Representative state: **10 active wants, 1 Favorite, 2 private Group/tag labels,
15 source entities, 5 inert historical records, 1 captured device, 2 journal
operations, 1 conflict and 1 unresolved candidate**. It includes distinct Moon/Sun
Pikachu costumes, Alolan Raichu, separate Dynamax/Gigantamax Charizard, Unown A/B,
the same species in distinct source lanes, female/shiny qualifiers, H/M/L, and
Lucky/XXL/XXS with no priority. The source snapshot contains migration/review evidence
and retained legacy-source metadata as well.

Negative tests cover corrupt/missing hashes, rehashed substitution, unsupported
future schemas, malformed ownership, conflicting account/entity/alias authority,
retired UID conflicts, missing alias proof, changed exact catalog identity,
impossible max/gender/XXL+XXS combinations, foreign device/journal/baseline binding,
operation input-hash corruption, cross-device operation-ID collisions, orphan
conflicts, mixed journal metadata types, old queue paths targeting another account,
historical reactivation, structured-secret injection, JSON ambiguities and target
tampering. Failures do not create a restore target.

The standalone-reader test copies only `format.cjs` and `schema.cjs`, denies common
network and subprocess APIs, and restores without the historical application or
Firebase infrastructure. There is no emulator ceremony.

Qualification: **167 selected Node tests passed (including 67 archive tests), zero failures/skips**. Syntax, generated-schema equivalence and diff hygiene passed. The full 558-file frontend artifact digest is unchanged from `.100`: `6f4950e0d505a8fd044db1f73aba0f717658286f2db1d570ceb888a2e548b99b`. No browser, Functions, Rules or unrelated historical identity suites were selected. See [recorded proof results](verification/archive-proof/proof-results.json).

## H. Browser-local and known-device gap

See [Device capture and import-on-return design](verification/archive-proof/DEVICE-CAPTURE-DESIGN.md)
for concrete store/key locations, what the server cannot see, and the proposed
capture/return protocol. A server-only fixture intentionally has no device data,
labels other devices `unknown-not-captured`, and cannot recover the device-only
note. This limitation is part of the archive coverage statement, not hidden by a
successful canonical server round trip.

## I. Restore limitations and retirement gate

The target consists of `active.json`, `account-records.json`, `identity-catalog.json`,
`device-review.json`, `historical-inert.json`, `publication-review.json`,
`capture.json`, and a checksum receipt. `active.json` is an inspectable synthetic
semantic model, **not** a file the running app imports. No SDK, database, Auth
record, accountSync listener or provider is activated.

The core reader understands versioned data contracts; it does not need every old
runtime module. Its exact catalog snapshot contains eight reviewed fixture entries,
not a complete Pokémon legality database. A real adapter must capture/review a
complete catalog identity map and preserve unresolved historical records without
guessing or activating them. Free-text qualifiers remain text, not catalog aliases.

The archive format has no TTL, age cutoff or pruning step. Reader v1 has an explicit
16 MiB input bound, depth/collection limits and known field shapes; excess data
causes failure without truncation. Larger captures need reviewed versioned
segmentation or a newer reader. Original bytes remain retained while unsupported
fields/versions are classified. Never use `.100` cache/history pruning as archive
retention policy.

This proves preservation for the represented synthetic state. It is not a complete
production capture adapter or permission to retire storage today. Real retirement
requires an exhaustive field inventory, trusted capture receipts, complete known
device capture or import-on-return, original archive retention, independent restore
qualification and explicit handling of ownership ambiguity and credential recovery.
No archive can reconstruct an edit that was never persisted/captured, a missing
device, or data already purged by the application. No plaintext/hashed PIN or reusable
credential can be restored from this format.

## J–K. Review contents

- `scripts/archive-proof/`: standalone format/validator/restore code, shape/schema
  generator, allowlisted synthetic adapter, round-trip runner and fixture builder.
- `scripts/archive-proof/fixtures/source-contracts.json`: `.100` source commit and
  hashes for the eight domain/data modules used only in source qualification.
- `tests/offline-archive-restore.test.cjs`: round-trip, semantic preservation,
  credential boundary, corruption, target isolation and portable-reader tests.
- `scripts/select-product-checks.cjs` and its test: archive tooling changes select
  the archive proof without browser, Functions, Rules or historical identity work.
- This document, the JSON Schema and device-capture design.

Branch: `tooling/offline-archive-restore-proof`, in a separate worktree. The final
review response records the commit after qualification. No merge or deployment is
authorized by this document or by the proof executable.
