# Client State and Storage Inventory

This inventory describes active production client state for release
`2026-08-31.86` plus disabled development-only provider-account candidates.
Browser storage is device-local. It is not cross-device sync and
does not establish account ownership; Firebase Auth plus the reciprocal legacy
identity mapping remain authoritative.

## Account and offline data

| Key | Owner / schema | Reads and writes | Logout and account switch | Corruption / migration / bounds | Sensitivity |
| --- | --- | --- | --- | --- | --- |
| `pgu`, `pguts` | Current remembered username and rolling session timestamp; scalar values, 30-day active-session TTL | Login bootstrap, successful login, activity refresh | Both removed on logout, auth mismatch, or expiry; next account replaces them | Legacy `sessionStorage` values migrate once, then are removed; invalid/expired values are discarded | Username is identifying; no token or PIN |
| `pogoSessionCache_v2` | Envelope schema 2; public login directory plus one protected `{uid, username}` owner | `sessionCacheBoundary` hydration and narrow snapshot writes | Protected payload is cleared on logout or different-owner activation; public directory may remain | Invalid JSON resets; `pogo3` migrates only public directory; partial UID/username mismatch fails closed; size follows one verified account snapshot | Protected cached list/profile data |
| `pogoSyncQueue_v2` | Envelope schema 2, exact `{uid, username}` owner | Local narrow-write queue and flush; each My List action durably queues one atomic owner-root `update()` patch before changing the optimistic local list, while legacy whole-list replacements are retained in a non-flushing quarantine | Cleared on logout or different-owner activation | Invalid/wrong schema resets; malformed, path-mismatched, foreign-owner, or unpersistable entries fail closed; legacy `pogoSyncQueue_v1` is discarded, never adopted; exact whole-list paths are quarantined before flush; quarantine is limited to one entry for each of the four owner list roots | May contain pending account list changes and owner-bound quarantined recovery evidence; no credentials or tokens |
| `pogoTrainerHistory_v1:<encoded UID>` | Schema/version/migration 3; exact UID and username | Favorites, Recents, private tags, opened public-list snapshots | Store object and Browse cache are detached at logout/switch; the UID partition remains so returning A recovers A, while B cannot read it | Future schema fails closed; malformed records normalize; 100 Favorites, 6 Recents, 24 tags, 24 tag references/Favorite, 40-code-point labels, snapshots only for current Recents and at most 512 KiB each | Private local organization and public-list snapshots |
| `pogoListSnapshots_v1` | Viewer buckets keyed by encoded Firebase UID plus username | Public trainer change summaries | Signed-out sessions cannot write/read a bucket; another account gets a different bucket | Invalid root resets in memory; legacy unpartitioned snapshots are not adopted; 100 trainers per list type, 2,000 list entries per snapshot | Public-list history associated with a local viewer |
| `pogoActivityLog_v1` | Device-local per-trainer activity map | List-write activity sparklines | Retained device-wide; it does not unlock account data | Invalid root becomes empty; only valid recent events retained; 60 days, 500 events/trainer, 200 trainers | Low-sensitivity interaction metadata |
| `pogoProviderOnboarding:v2` | Disabled provider onboarding; schema 2 with versioned SHA-256 UID digest, Auth lifecycle, provider key, state, handle, and public code | Created only by the development-gated Google new-user flow | Exact digest/lifecycle/provider must match the current Firebase user; stale, cross-owner, malformed, completed, or canceled evidence is cleared | Exact field set; no raw UID, email, provider subject, token, credential, friend code, avatar, bio, or other profile value | Bounded identifying workflow metadata |
| `pogoProviderAccountOperation:v1` | Disabled authority request journal; versioned UID digest, request/fingerprint, normalized handle, lifecycle, client release, and phase | Prevents blind resend and permits one exact reconciliation after an ambiguous transport result | Definite pre-write failures, including namespace-not-certified, clear it; lifecycle/owner mismatch fails closed | Exact fields and bounded hashes/IDs; no raw UID, provider subject, email, token, credential, or profile | Sensitive operation metadata, no credential |

The provider rows above remain dormant unless the provider development gates are
present before bootstrap. They do not describe publicly active production UI.

`pogoTrainerPreferenceSync_v1:<encoded UID>` is a dormant schema contract, not an
active key: the production client does not construct its queue and synchronized
trainer preferences remain disabled.

## Device preferences and compatibility

| Key | Purpose and owner | Lifecycle, recovery, and bounds | Sensitivity |
| --- | --- | --- | --- |
| `pogoUiLocale:v1` | Device-wide app language | Valid supported locale or fallback; retained through logout | None |
| `pogoPokemonGoSearchLocale:v1` | Device-wide Pokemon GO command language override | Removed when following app language; invalid values normalize to follow-app | None |
| `pogoTheme` | Device-wide System/Light/Dark choice | Invalid value falls back to System; retained | None |
| `pogoSelectedCommunityId_v1` | Current device community filter | Normalized to a prepared/default community; retained | Low |
| `pogoOwnerCommunityPreview_v1`, `pogoOwnerCommunityPreviewCommunity_v1` | Owner-only local preview toggles | Capability checks gate use; normalized default; retained | Low |
| `pogoAdvancedOpen`, `pogoSpeedAdd`, `pogoExportStyle` | My List tool presentation preferences | JSON fallback defaults; retained | None |
| `pogoSafeTransferDefault:<encoded UID>`, `pogoSafeTransferPrefilter:<encoded UID>` | Safe-transfer trainer selection and prefilter defaults for one authenticated account | No signed-out access and no adoption of the former unowned key; selected trainers are pruned against active data; malformed values fall back | Trainer names are private local preference data |
| `pogoWhatsNewSeen`, `pogoTourSeen`, `pogoLastBackup`, `pogoBackupDismissed` | Device onboarding/reminder timestamps | Invalid values fall back to unseen/due; retained | None |
| `fbUrl` | Legacy/local Firebase configuration choice | Cleared by app cache reset; normal production boot rewrites the reviewed URL | Configuration only |

## Bounded caches

| Key / cache | Owner and behavior | Bound and invalidation |
| --- | --- | --- |
| `pogoSpriteScales_v4` | Device-wide derived sprite scale metadata | Maximum 800 entries; malformed JSON becomes empty |
| `pogoEventCache_v1` | One shared event/raid response | One payload, 2-hour TTL; malformed JSON ignored; forced newer request wins races |
| `pogoTypeCache_v1` | Pokemon type lookups | Finite Pokedex IDs; malformed JSON becomes empty |
| `shell-pogo-trades-<release>` | Service-worker release shell | One complete active release; failed staging and obsolete release caches removed atomically; arbitrary navigation/query URLs are not added |
| `sprites-pogo-trades-<release>` | External Pokemon sprite responses | Maximum 400 insertion-ordered entries; Firebase is never cached |

The Settings cache reset intentionally removes all `pogo*`/`pg*` browser keys,
matching service-worker caches, and registrations within the app scope.

## Session-only and in-memory state

- `sessionStorage` is used only as a one-time legacy source for `pgu`/`pguts` and
  is cleared. No active private schema lives there.
- `favoriteShareSessionCache` holds projected public shares for at most 100 current
  Favorites, with four concurrent exact reads. It is generation-bound, reset on
  logout/account switch, pruned on Favorite removal, and never persisted.
- `selectedTrainerRuntime` holds one selected public trainer projection and is
  cleared when its selected-trainer listener/view closes.
- Favorite Browse selection, catalog, errors, progress, and results are in memory;
  session reset invalidates them and stale hydration generations cannot repopulate
  another account.
- Events have one in-memory payload and one shared in-flight request. A forced
  request advances a generation so a late older response cannot overwrite it.
- My List category, filters, autocomplete, bulk selections, organizer drafts,
  dialogs, swipe state, copy/undo feedback, and Settings route scroll state are
  transient. The centralized session reset clears or invalidates them.
- Provider-only profile retry evidence uses the existing UID-partitioned
  account-sync IndexedDB journal metadata key `provider-profile-pending-v1`.
  It contains only the four normalized profile values, base revision, owner UID,
  and queue timestamp; another UID partition cannot read it. Successful exact
  write/reconciliation removes it. The canonical cross-device profile is
  `accountSync/{uid}/profile`, not local storage.
- String diffs, sprite fallback state, performance samples, and Pokemon catalog
  indexes are page-memory caches. Their inputs are finite/current-page data.

## Recovery and quota notes

Browsers do not promise one universal local-storage quota. Typical implementations
provide storage on the order of several MiB per origin, but code must treat quota
errors as possible. Writes that are recoverable caches already catch quota errors;
owner-bound cache and queue writes fail closed through their boundary API. Normal
state is expected to remain far below common quotas. The largest realistic local
contributors are the protected offline snapshot, 100-Favorite trainer history,
and bounded public-list snapshots. No browser key stores Firebase ID tokens,
passwords, PINs, App Check tokens, or static service credentials.

My List patches use last-write-wins semantics only for the same Pokemon key.
Successive offline edits to that key are merged so the newest local value is
retried; unrelated Pokemon keys remain independent and are never replaced by a
full cached list snapshot.
