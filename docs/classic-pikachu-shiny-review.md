# Bounded twelve-costume Shiny correction — local review

Depends on the separately reviewable nine-released-costume patch `f7dc8efd`. Production remains .142.

## Coverage

Ash, Santa, Witch, Summer, Flower Crown, Fragment, Straw, Explorer and Captain receive separate male/female Shiny artwork. Libre, Rock Star and Pop Star receive their exact female-only cosplay Shiny models and evidence-backed gender options. Twenty-one original source images; normal mappings preserved. No fallback to normal, base Pikachu or another costume.

Source pages and exact URL/hash metadata are in `data/classic-pikachu-shiny-assets.json`; female files are pinned to Gabrielense/pogorewind commit `5c6bb56c4026e5fe3cd146910c7e9dad9f07d716`. The labelled 21-image contact sheet was inspected. Source metadata, image mapping or reviewed hashes cannot drift without failing validation.

## Checks

- Full local suite: 1,939 passed, zero failed, 12 existing skips.
- Pages release: 111 passed; sprite checks: 18 passed.
- Combined browser qualification: 15 passed (Chromium phone/desktop and WebKit phone), covering this batch and the preceding nine costumes. The twelve-costume flow uses real app controllers and IndexedDB, synthetic Firebase acknowledgement, reload, editor reopen and public-list rendering.
- Production user records, access rules, credentials, baseline acknowledgements/expiry and all design proposals remain untouched.

## Remaining limits

Seven ambiguous legacy labels require identity clarification. Normal-only mapping inventory decreases from 364 to 352 (Pikachu 90 to 78); absent mapping is not evidence every remaining Shiny form exists. Clone/Ph.D. have no established released Shiny in reviewed sources. Detective needs explicit 2019 versus 2023 identity resolution before assigning its artwork. No physical phone, actual production write or deployment qualification is claimed.

Publication of this new batch is pending reviewed approval and required GitHub release gates. Do not auto-acknowledge baseline changes or renew baseline expiry.
