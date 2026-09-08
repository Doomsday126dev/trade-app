# Signed-in boot dependency reduction

Evidence base: current main `1d8f41529bffc38471ca404157acd71960757234`.
The served production manifest was independently read: `.99`, source
`12e479eea866d04cf09e725230424beb072b1a15`, control `ddcfcdd...`, selector
`release-pages-control-23aee7be64e78ceea12dca1a738e7d1098d46f43`.
The architecture audit at `4a25827...` was a lead, not the implementation baseline.

## Candidate decisions

Every candidate is **REMOVE FROM SIGNED-IN BOOT**, **not DELETE**. All six files
remain byte-identical to current main and hosted. None gained a legitimate
signed-in consumer in .99.

| Candidate | Current-main evidence | Ownership after this change | Raw / gzip bytes avoided per signed-in load |
| --- | --- | --- | --- |
| `js/data/firebaseReadRegistry.js` | Feature template loaded it; `application.js:188-189` only bound/asserted its global. `scripts/check-firebase-reads.js:10-13` loads the registry from **control**, and read-contract/account-sync/share-visibility tests consume it. No runtime use beyond the assertion. | Hosted only; static control/test input. Neither route loads it; SW does not cache it. Registry contents, 25 read sites, 48 surfaces, feature gates and handler hashes are unchanged. | 27,541 / 6,116 |
| `js/domain/trainerPreferenceSync.js` | Feature template; `application.js:222-223` only checked its disabled presentation. Other consumers are candidate sync/UX tests and test-only mock tooling. | Hosted only, no SW or route loading. Active `trainerPreferences.js` and accountSync remain loaded. | 20,177 / 5,125 |
| `js/data/trainerPreferencesRepository.js` | Feature template; `application.js:249-250` load assertion and line 292 unused `createTrainerPreferencesRepository({enabled:false})`. No callers of the constructed repository. | Hosted only; disabled repository model remains available to tests. No initialization on signed-in boot. | 4,299 / 1,188 |
| `js/data/trainerPreferenceSyncQueue.js` | Feature template; `application.js:251-252` existence assertion only. Queue consumers are disabled-preference tests; it is not accountSync's journal/controller/runtime. | Hosted only, no route or SW loading. No queue/storage migration. | 7,605 / 2,171 |
| `js/ui/trainerTagPanel.js` | Feature template; `application.js:253-254` existence assertion only. .99 `renderTrainerGroups`, `saveTrainerGroup`, Favorite rendering and editing operate directly through existing history/canonical accountSync paths. `trainerPreferencesDomain.normalizeTagLabel` and `MAX_TAG_LABEL_LENGTH` remain active. No Group/Favorite rendering calls this UI model. | Hosted only; candidate UI model tests retained. No active Group/Favorite UI code changed. | 12,633 / 3,200 |
| `js/app/publicShareApp.js` | Feature template unnecessarily loaded it. It registers `__pogoStartPublicShare`; only the independent `loadPublicShareScripts` / `ensurePublicShareApp` path calls it. Signed-in Share uses application functions. | Hosted, independently anonymous-route loaded and **required offline cached** in `LAZY_RELEASE_ASSETS`. Not signed-in feature loaded. | 23,283 / 7,110 |

Evidence line numbers above refer to the immutable base, before removal. Repository
searches included globals, aliases and all JS sources, not only the template.
Only six template tags, five assertion pairs and one unused construction were
removed from the runtime. The six module implementations, all active application
functions, CSS, locales, Firebase/Functions/Rules and data schemas are unchanged.

## Inventory boundaries

- **Hosted:** reviewed artifact inventory remains 558 files. New trusted
  `hostedOnlyScriptFiles` class retains the five tooling/disabled modules without
  putting them into a browser or service-worker graph.
- **Signed-in feature loaded:** template goes 85 -> 79 paths. With existing
  provider-capability filtering and English locale selection, actual browser
  resources go 73 -> 67. German/Japanese/Spanish load English plus their locale:
  74 -> 68. Zero first-party JS is added to the pre-auth eager shell.
- **Service-worker cached:** required install graph goes 81 -> 76 assets. The
  five hosted-only files leave installation. The public app moves from
  `RELEASE_ASSETS` to `LAZY_RELEASE_ASSETS`, which is still included in
  `REQUIRED_SHELL_URLS`. Install remains atomic, concurrency remains eight, and
  optional sprite/manifest behavior is unchanged.
- **Anonymous route:** loader and implementation remain byte-identical. All its
  scripts and every supported locale remain required offline shell assets.
  An actual installed-service-worker/offline browser test proves public route
  code loads without accountSync or the signed-in application. Offline code
  availability does not promise an offline public Firebase projection.

## Measured effect

Measurement JSON: `boot-dependency-measurements.json`. Before and after were
measured with .99 markers held constant, isolating this source optimization from
the later normal release-marker increment. Raw = file bytes; gzip = level 9 per
file, summed. These gzip figures are estimates, not claims about CDN transfer
encoding. All six files remain hosted, so artifact hosting does not shrink by
95 KB.

- Six modules: **95,538 raw / 24,910 gzip bytes** stop loading/executing signed in.
- Unused application declarations: **1,087 raw / 174 gzip bytes** removed.
- Default feature JS: **1,867,171 -> 1,770,546 raw**, **467,296 -> 442,212 gzip**
  (96,625 raw / 25,084 gzip saved).
- HTML: **123,436 -> 123,001 raw**, **29,047 -> 29,006 gzip**.
- Required offline asset bytes: **2,585,956 -> 2,512,179 raw**,
  **636,196 -> 618,181 gzip** (73,777 raw / 18,015 gzip saved).

Five serial Chromium runs per profile used the same local server, Firebase mocks,
blocked service worker and unchanged budgets. Protected-startup median ms:

| Profile | Before | After |
| --- | ---: | ---: |
| Desktop | 77.5 | 80.2 |
| 390px, 4x CPU | 199.8 | 192.2 |
| 320px, 6x CPU | 297.8 | 289.5 |

Timing ranges overlap. This is a demonstrated reduction in script requests and
bytes, not evidence of a statistically established latency improvement. The
unchanged My List render/filter/edit budgets passed through 1,000 entries.

## Qualification and test corrections

- 35 existing browser journeys: wants-only editing/save/Copy Search, Groups CRUD
  and membership, Group search, Who wants this?, Favorite baselines and fencing,
  Events, accountSync/IndexedDB reopen/recovery, anonymous/public Copy Search,
  non-English public rendering, App Check/restored-session privacy.
- Three new browser proofs: real application Username/PIN login through synthetic
  SDK transport and authenticated reload, German feature loading, actual offline
  SW/public-route availability. All assert the route boundary or absent globals.
- Two current owner PIN-reset browser tests retain reset/eligibility behavior.
- Four new static boot/inventory tests; existing selector gains permanent routing
  for these proofs on boot entrypoint and release-inventory changes.
- Release/control assertions retain every hosted file, reject unintended eager
  loading, reject missing anonymous offline coverage, and ignore target-supplied
  attempts to alter the immutable inventory. Read-check regression proves target
  registry code never executes in the trusted validator. Existing read-tampering
  negative tests still fail as intended.
- Local Pages release, targeted localization/preference/App Check tests, static
  performance and exact mandatory release/control suites are run. PR CI records
  the final changed-area/performance result and final counts.

Revalidation found three **pre-existing failures on .99 main**, reproduced before
retargeting: localization expected removed `renderMyHave`/`renderMyStrings`
boundaries, and the App Check test banned every callable in the entire app despite
the approved owner PIN-reset callable. Tests now address the active wants renderer,
parse the exact Copy Search function, and check startup Functions absence while
retaining the separate global E1-read/mutation prohibition. No product behavior
was changed to satisfy those tests. Disabled-repository assertion tests now require
absence rather than meaningless disabled construction.

The audit's six-candidate direction remains correct. Its aggregate was 13 bytes
larger because .99 changed the anonymous implementation. No count target drove a
removal. The release-control coupling required explicit additional work.

## Release-control and deployment sequence

The old immutable control is intentionally incompatible with the reduced HTML
inventory; it also incorrectly requires the static registry's script tag. Do not
edit old controls/tags or disguise dead scripts as loaded dependencies.

This PR supplies a reviewed **new control candidate** alongside the exact reduced
runtime graph. The artifact manifest still comes from the trusted control, never
from the runtime. The checker still executes its trusted registry and validates
all original read surfaces/sites/handler hashes; only the obsolete script-tag
ordering requirement is removed.

After candidate qualification/merge, use a **separate dispatcher-only PR** to pin
its full immutable SHA and create a new selector tag. Then prepare the normal next
runtime release marker, qualify it, tag its exact reviewed main SHA, and deploy
through that new selector with the served .99 SHA as the expected-live guard.
All existing runtime/control tags remain immutable. The old selector remains
available for the old .99 graph; the new selector must not be used to bypass its
explicit graph contract for historical runtimes.

No provider rollout, PR #63, account/schema/data migration, identity change or
production setting change is included. Test transport is synthetic; no historical
identity/provider/canary matrix is run. Final PR/merge/control/runtime/deployment
identities are recorded in the PR and final release report.
