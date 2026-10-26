# Costume gender and picker follow-up (local review)

Base: exact deployed `.141` runtime `748ad63a7b0d2e1efbc7689b660483b95fdab4e3`. No discarded design work or unpublished main changes are included. This follow-up is not pushed or deployed.

## Completed comparison release

PR #170 merged as `d38983a4b8bf4f50b4e7c0283459d720fcfc0d02`. Deployment [40262317241](https://github.com/Doomsday126dev/trade-app/actions/runs/40262317241) succeeded. Served runtime: `748ad63a7b0d2e1efbc7689b660483b95fdab4e3`; trusted control: `b485499ea858bda9fd9bfe65b6412ac6bea58e64`; dispatcher: `bc7f099d2caf4301ad50d2b355ef15ba96741d2d`. Deterministic digest: `06e65473e38fa790249a3be2c9a711a5258e7a26121f49d0718938844cc611bf`.

Twelve served code/image files matched local reviewed bytes. The actual fetched comparison function then passed seven explicit normal/Shiny/gender/invalid-female cases per engine in Chromium and WebKit synthetic fixtures. Firebase transport was isolated; no production account reads or writes. This is browser-engine simulation, not physical iOS/Android qualification.

## Follow-up scope

- Correct Cosmog Spacesuit/PokémonXP normal and Shiny art using two original Serebii PNGs with independently checked female heart-tail pixels and recorded hashes. The previous straight-tail DittoBase assets are marked superseded, not relabelled as female.
- Per-costume availability for all eleven recent imports: Cosmog female-only; Astronaut and Worlds 2026 male-only; Fossil, Marathon, Mystic/Valor/Instinct, Willow Assistant, turquoise and blue PokéXciting shirts retain both. Evidence and confidence limits are in `data/reviewed-costume-genders.json`. The shirt evidence is moderate database/sex-specific listing evidence, not independently verified catch screenshots.
- Unspecified gender automatically resolves the valid art for a reviewed single-gender costume. New editor choices omit impossible genders. An existing conflicting saved value remains selected and clearly marked for review. Opening, cancelling, rendering, or a priority-only save does not rewrite it. Choosing a valid gender is an explicit correction; no bulk migration runs. Its existing qualifier is preserved in lists/public data, with an accessible conflict description instead of a wrong-sex substitute.
- The name-only datalist previously contained 1375 options with 68 repeated values because category-specific catalogue IDs can share the same name. It now presents 1307 unique values. This changes only picker presentation; it does not merge catalogue IDs, distinct named forms, genders or saved data. The subtitle omits the repeated canonical title and retains useful aliases.
- Compact Edit want requirements fieldset, clear Pokémon label, correct Add/Edit heading. Accessible validation remains; the screenshot's priority instruction was a validation error, not permanent copy.
- Share format tiles are replaced by one labelled Format selector. Search format retains scope/language configuration and exactly one Copy search string action. No new routes or sharing/publication logic.

## Remaining art inventory (not fixed by this follow-up)

| Identity | Classification / reason |
|---|---|
| Charmander, Charmeleon, Charizard — Friede's Goggles | Three released identities; no reviewed exact assets registered |
| Teddiursa, Ursaring, Ursaluna — Witch Hat | Three released identities; no reviewed exact assets registered |
| Galarian Corsola — Pink Sunglasses | Released identity; no reviewed exact asset registered |
| Noibat, Noivern — Headband | Two released identities; no reviewed exact assets registered |
| Pikachu — Gloria, Victor | Two legacy labels without established exact GO identities |
| Pikachu — GO Fest 2023 | Missing crown colour; named exact crown variants exist separately |
| Pikachu — GO Fest 2024 | Missing Sun/Moon choice; named exact variants exist separately |
| Pikachu — Jeju | Location does not identify citrus shirt versus balloon variant |
| Slakoth — Night Cap | Unverified legacy label; official Slakoth visor is not Snorlax's nightcap |
| Pumpkaboo — Spooky | Missing size; four exact size-specific assets exist separately |

Total 16: 9 released identities lacking registered art and 7 ambiguous/unverified legacy identities. The released non-Pikachu rows currently lack the runtime `identityStatus:released` marker used for picker admission, so this inventory does not imply they can all currently be newly selected. Existing saved entries can still encounter unavailable-art rendering. No labels are silently remapped or deleted.

There are also 364 records (90 Pikachu) with normal artwork but no registered `shinyUrl`. The resolver returns no image for such explicit Shiny requests; it does not substitute normal/base art. This is a mapping inventory, **not 364 confirmed released Shiny bugs**: released/unreleased Shiny state, gender relevance and exact assets still need evidence-based review. It includes non-costume forms and older identities; the normal-art catalogue count is not complete Shiny coverage. Existing tests explicitly expect no Detective Pikachu Shiny URL, illustrating this unresolved policy/data gap.

Other unavailable paths: unknown/ambiguous identity, unsupported saved gender combination, and an actual image-load/decode failure. The latter retains a labelled placeholder after exhausting only that identity's vetted chain, never a different costume.

## Validation and release boundaries

Targeted unit/metadata checks verify 11 availability records, exact Cosmog hashes, normal/Shiny/gender resolution, invalid-form nonmutation, and rejection of source/gender mapping drift. Browser checks cover unique suggestions, cancellation, synthetic server-acknowledged add/persist/reopen/public render, explicit correction of saved gender, single Copy action, keyboard Escape, 390 px phone and 1440 px desktop, English/light and Japanese/dark. Clipboard writes are captured at the browser boundary rather than changing the user's host clipboard.

The original maintenance baseline and its expiry remain untouched. A future release needs review of changed source/mapping fingerprints without acknowledging unrelated gaps, exact immutable runtime/control qualification for the two added asset paths, all required CI and explicit publication approval. No notification preferences, permissions, credentials or real user data were changed.

Library upload of the two synthetic phone previews was rejected by automatic approval review before execution because persistent Library creation was not explicitly authorized. No Library files were created and no alternate delivery path was attempted. The previews remain local under `/tmp/costume-gender-review/`.
