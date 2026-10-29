# Catalogue monitor and finite additions — local review candidate

Base: live .164, commit 185348e2e02611a436cc86c5ae1d0ab552ff9f10. This patch is not a deployment or a complete-catalogue declaration. Auth and account data are unchanged.

## Monitor failure and correction

Scheduled run [40908154962](https://github.com/Doomsday126dev/trade-app/actions/runs/40908154962) ended review-required (exit 1), not a source-fetch failure: 22 observations, zero source issues. The three annotations were the intentional failure plus Node action-runtime and Ubuntu image migration notices. Existing daily cron is `17 9 * * *` UTC; actual recent starts were delayed. Actions summary/artifact/failure are the existing notification surface; owner email/push delivery is unverified.

The old fingerprint hashed all application.js bytes. Substituting only the previous application file restored all 981 mismatching run rows and verified all 1,198 stored runtime pins, with current artwork unchanged. The new AST scope covers sprite declarations, helper/constant dependencies, direct sprite-rendering consumers and top-level fallback listeners. Other resolver/data modules and exact per-variant artwork proofs remain strict. Unrelated Favorites UI no longer invalidates artwork; changed routes, consumer arguments, constants, source URL/hash or selectable identity still re-enter review. Parse/missing core resolver errors fail closed.

The one-time crosswalk conversion records its provenance. All 1,758 prior selectable identities and prior artwork proofs were compared unchanged before repinning 1,198 fingerprints; the four additions are explicit. Raw observations, observation hashes, categories, policy decisions and baseline expiry are unchanged. No automatic baseline renewal or promotion is introduced.

The summary now leads with actual missing Max names, new official announcements and changed miner compare links; head-commit Pokémon filenames are included where supplied, explicitly not the full comparison inventory. Review-required/source-failure emits a bounded escaped Actions error annotation. Raw lead count is never a count of missing Pokémon. Neither fetching successfully nor finishing a finite repair turns the monitor green while unresolved evidence remains.

## Finite picker additions

| Identity | Artwork | Release treatment |
|---|---|---|
| Dynamax Magmar | Already-qualified ordinary-form normal/Shiny HOME originals, hashes rechecked | Released: August 3, 2026 event independently dated by Dittobase and current Max inventory |
| Dynamax Magmortar | Already-qualified ordinary-form normal/Shiny HOME originals, hashes rechecked | Released evolution of Dynamax Magmar; not a separate battle debut claim |
| Dynamax Mawile | Already-qualified ordinary-form normal/Shiny HOME originals, hashes rechecked | Release unverified: current capability list alone does not establish the debut/acquisition date |
| Pikachu (PokeXciting Thailand) | Four original pinned normal/Shiny, default/female files; yellow hair, black regional shirt, exact male/female tails | Announced early want: Bangkok February 13–14, 2027, 10:00–22:00 local; not released now |

Sources: [current Max inventory](https://www.serebii.net/pokemongo/maxbattles.shtml), [Magmar event](https://www.dittobase.com/pokemon-go/events/magmar-max-monday-aug-2026), [official APAC event](https://pokemongo.com/news/event-apac-30th-anniversary-2026), [pinned original miner commit](https://github.com/PokeMiners/pogo_assets/commit/db10df75d6f6f92018d9786af0aecc238fecc4ef). The GO Hub Magmar guide has an inconsistent date and is not used to set the debut. A direct LeekDuck read returned 403; it was not retried or bypassed. Mawile's exact debut remains unresolved, rather than guessed from the unrelated Steel Skyline 2025 article's wild Mawile encounter.

The source code `fANNIVERSARY_2026_THAILAND_01` identifies the Thai regional family; it was not inferred from the separate Bangkok Pokémon Center announcement. The official APAC article announces region-specific costume colors and Shiny eligibility. Four distinct pinned files are decoded, visually inspected and hashed. The new provider validator accepts only this exact identity, commit and four variant paths. Original pixels are unchanged. Gender remains an optional owner preference; unspecified uses default art, explicit female uses the exact female tail. Shiny never falls back to normal or generic costume art.

Packaging proposal is exactly four new `assets/sprites/go/pokeminers-thailand-{default,shiny,female,femaleShiny}.png` files. The local reviewed frontend allowlist and exact count assertions include them; no protected control has been promoted and no runtime registration, push, PR, merge, tag or deployment was performed. Any release needs normal exact-source/control review and hosted qualification.

## Coverage and limits

Actual picker: 1,762 identities (1,758 preserved + four). Pinned Max source: 138/138 identity matches, up from 135/138; this is not a universal release/artwork assertion. Public dex: 34,541 / 35,000 bytes. Existing 7 unsupported legacy costume labels, three Clone Shiny art gaps and other retained source/form/policy questions remain open. Thailand is not marked released; Mawile is not guessed released.

Offline reconciliation is integrity evidence only. It is not a fresh source observation and the failed scheduled run has not been rerun. Existing source/parser/outage failure behavior remains fail-closed. No guarantee about all news sites or instantaneous detection is made.

Tests cover missing entire picker identities, actual option text, exact normal/Shiny/gender URLs, decoded editor art, saved reload, canvas exports, unchanged existing records, fingerprint scoping, actionable summary, stale source behavior and packaging/performance contracts. Six checked-in offline Max test originals match existing approved source hashes, so browser tests do not require production traffic or temporary downloads.
