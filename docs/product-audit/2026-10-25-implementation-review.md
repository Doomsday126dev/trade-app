# Usability, sharing and Events candidate — 25 October 2026

Base: deployed .131 / 56ae1b8. Branch: `fix/usability-correctness-sharing`. This is a local review candidate, not a deployed release. No production list, billing, credentials, access Rules or legacy seed records changed. No new package/service dependency was added.

## Implemented behavior

- Import accepts a documented bounded grammar: individual Pokédex numbers separated by commas/colon/semicolon/newlines, with supported English positive qualifiers joined by `&` in either order. Unsupported exclusions/ranges/CP/full queries are rejected as a whole instead of coerced. Exact variant expansion starts unselected. Qualifiers survive confirmation; existing entries are preserved; contradictory selections and account changes are blocked. Reopened dialogs ignore old completions.
- Request access acknowledges success only after the existing remote write succeeds. Pending/failed outcomes retain the draft, request ID and in-flight promise in this visit. A 15-second soft deadline says unconfirmed, never saved/sent. Back or account transitions fence late UI/cache effects. There is no new background queue or public-request read.
- Export, N/S/PWA shortcuts and current tour/help point to actual surfaces. Save-status wording matches the existing action. Filtered section searches visibly state full-section scope.
- Share is goal-first: live public list, Pokémon GO inventory candidates, image snapshot, text snapshot. Scope changes preserve the chosen goal. Partial scopes cannot publish/copy a full-list link accidentally. Game language and actual exclusions are visible. Markdown and CSV remain under More formats, explicitly full-list; Markdown contact inclusion is disclosed. Existing publication acknowledgement and snapshot/session guards stay in place.
- Anonymous legacy RTDB public pages watch exactly their own `publicShares/<handle>` projection. No root/directory/private listener or Auth import is added. Duplicate snapshots avoid re-rendering. Removal/malformed data/permission failures clear list/profile controls, and late events after terminal error are fenced. Listener cleanup runs at pagehide and bfcache resume rechecks. Provider callable-only pages remain refresh-based to avoid polling Functions.
- Primary action contrast and selected Medium text are repaired. Priority controls are at least 44px high/wide. Existing responsive structure, wants-only semantics and inert legacy data remain intact.

## Events direction and trustworthy limits

The list and detail header lead with identity, weekday/date, actual hours and timing basis. Supplied bonuses and their exceptions are visible without expansion. Secondary encounters, raid bosses, research tasks/rewards and the event source are inside the app; research steps can expand. Missing bonus/access information is unknown, never “none” or “free.” Venue-style events without a supplied offset explicitly lack a venue timezone and exact countdown; no venue zone is invented.

The existing free ScrapedDuck/LeekDuck feed supplies the data. The inspected 59-record sample had generic metadata for all events, raid details for 12, Spotlight data for 3 and Community Day details for 1. That is not comprehensive coverage of bonuses, research, costs, regional eligibility or secondary deadlines. No new official ingestion or editorial backend was introduced. Attribution stays visible through Sources and limitations; source text may remain English.

Events memory now expires rather than lasting forever. Failed refresh preserves a labeled last-known copy and original checked time. Malformed event arrays are not cached as success; optional raid failure does not discard valid event data. Requests deduplicate and retain the existing 15-second bound/replacement fencing. Visible Events refreshes relative labels on a minute clock and periodically rechecks the feed at its two-hour cache cadence; hidden tabs do not run a recurring render loop. Manual refresh remains available.

“Checked” means this device successfully obtained the feed, not official verification, origin update time or a guarantee that the scraper is current. The source convention maps no-offset times to local wall clock and offset/Z times to fixed instants. Region/venue ambiguity and supplementary bonus/claim/evolution deadlines require reliable structured content, not guessed countdowns.

Primary references: https://github.com/bigfoott/ScrapedDuck/wiki/Events ; https://github.com/bigfoott/ScrapedDuck ; https://pokemongo.com/en/news/communityday-october-2026-zorua . Official examples demonstrate distinct main, bonus/evolution windows and optional paid research; this patch does not copy those facts into unverified event records.

## Invariants reviewed

1. No private/other-owner data read or write is added by public viewing.
2. Import adds only deliberately selected entries, preserving current entries and inert offers; no legacy cleanup occurs.
3. No local request record or success state precedes remote acknowledgement. A timeout cannot become false success.
4. Async request/import/public-read completions cannot update a replacement form/account/read generation.
5. Full-list exports and partial snapshots remain distinct; game searches describe species candidates, not exact inventory or ownership.
6. Failed source refresh never advances the checked timestamp; missing facts never become free/confirmed labels.
7. No billing activation, new paid service, security-policy change or publication of a private list was performed.

## Measured performance

The committed `scripts/profile-events.cjs` ran unchanged .131 and this candidate sequentially with the same local 59-event public-feed fixture, Chromium 148 and 4× CPU slowdown, eight synchronous renders each. Median: 593.4 ms → 50.55 ms (about 91.5% lower main-thread rendering time). DOM increased from 1,166 to 1,417 nodes and HTML from 84,893 to 99,872 bytes because richer information is displayed. This is local render evidence, not network latency or a real phone speed guarantee. Repeat with `node scripts/profile-events.cjs LOCAL_SOURCE_ROOT LOCAL_EVENTS_JSON`; the profiler blocks external traffic and uses synthetic owner data.

## Evidence and qualification

See the accompanying implementation report and local evidence bundle for exact run output. Checks include domain/localization/event lifecycle, real controller/IndexedDB import preservation with memory-only transport, delayed/repeated requests and imports, account transitions, anonymous public listener updates/removal/error/late callback cleanup, and desktop/phone browser interactions.

Targeted gates: 75 domain/localization/event/request tests passed; 111 Pages-release tests passed; 310 account-sync tests passed with one skip; 25 anonymous/new-flow desktop browser cases passed with one deliberate skip, followed by nine current interaction cases on desktop, nine on Chromium phone emulation and eighteen on WebKit/Firefox. The complete current nine-case interaction set therefore passed on four browser/viewport profiles. Existing startup/My List performance profiles passed all seven after the exact traffic-sender test correction. The initial 180-cell three-browser visual matrix had no horizontal overflow; representative Chromium/WebKit screenshots were regenerated from the final tested source. Reproduce the portable interaction matrix with `npm run test:usability:browsers` (browser installations required). The read registry gate passed for its existing 51 application surfaces; the separate new anonymous listener is checked by exact-path/no-private-fallback browser assertions, not by that registry count.

The baseline-wide Node run had 148 failures; the candidate comparison had the same 148 failed names AND normalized error/predicate headers. This is supporting evidence, not proof of equivalent root causes or a green whole repository. 69 cases stop at the same offline-archive provenance guard. Other groups retain old UI/source contracts and fixture/runtime failures (including async selected-trainer and history cases). Two file-load failures were missing `firebase-admin/app`; these were qualified separately using cached existing Functions dependencies: both baseline and candidate then ran 28 tests, with 26 passing and the same two failures (an E1 timestamp-contract INTERNAL_ERROR and an old SDK-version source assertion). Those are not all dismissed as stale tests. A sprite test fails its old source extraction before running. Full source dumps differ wherever the patch changes source; no new error header appeared in the compared run. These baseline limits remain visible, not waived.

The pre-existing startup budget expected zero eager scripts but .131 already includes one privacy-safe traffic sender. It failed on unchanged .131 too. The test now explicitly allows that one exact asset in shell/protected counts; every other eager application script remains forbidden and the existing application module/byte/time budgets remain unchanged.

No physical iOS/Android/Windows, native Safari chrome, screen reader, real login/PIN reset/admin mutation or production save guarantee is claimed. Chromium, WebKit and Firefox ran on the Mac; phone sizes are emulation. Native share dialogs and PWA process-death lifecycle still need dedicated device qualification.

## Remaining decisions and release plan

1. Review this local diff and the desktop/mobile light/dark preview. Obtain a fresh independent review of request replay/session fences, import preservation, source freshness and public listener lifecycle. This patch has no completed independent reviewer approval yet.
2. After authorization to publish the branch, create a scoped PR, integrate only approved runtime changes and run required CI. Do not silently dismiss baseline failures: identify the owning changed-area gates and explicitly resolve/accept the documented baseline limitations.
3. Prepare a new release identifier after approval; current .131 asset versions intentionally remain unchanged during local review. Build through the established immutable-artifact/control pipeline, verify asset provenance and service-worker/cache gates, then deploy only after release approval.
4. Nondestructive live smoke: inspect version/assets; open public synthetic/test projections and verify streaming/removal/reconnect using safe accounts only; check Events source/fallback states. Never edit another member’s list. Keep the previous immutable release available for rollback.
5. Separately approve a persisted publication-consent/server-enforced withdrawal design and revision ordering. Deleting a public projection or hiding a button cannot prevent a late owner retry from republishing. Client streaming also cannot guarantee owner-closed private-to-public freshness after process death. No false Stop sharing control was introduced.
6. Separately decide catalog-only sanitation of historical member associations in the public seed and retention of historical Git/deployment/cache copies. No records were removed here; no new leak or individual consent conclusion is claimed.
7. To reach the fuller Events vision at zero service cost, review a maintained, source-cited static content overlay with explicit verification dates, timing basis, eligibility and per-bonus/deadline windows. Assign an editorial owner/refresh policy. Do not imply the existing scraper already supplies reliable comprehensive official detail.

Request IDs are reused within the current visit; a full browser restart has no new durable request journal. Existing paid/free quotas still apply to Firebase; the new viewer uses one exact projection listener, not global polling. No paid infrastructure was enabled.
