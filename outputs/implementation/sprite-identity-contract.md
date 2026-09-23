# Sprite identity implementation proof

Baseline: `47be8c5b16117cf2bab02d49e3d9000c205d0683` (safe-transfer containment, based on the exact `.115` review base).

The numeric form oracle is pinned to PokeAPI commit `575291cdb197a7e3a320297be276c9de4ef8401a` in `tests/fixtures/sprite-identity-oracle.json`. The runtime contract now distinguishes explicit forms, punctuation identities, and species with visible female artwork. A female request may use same-form default artwork only when the pinned gender contract declares it visually equivalent. Explicit forms never reach base-species URLs. Exhausted inline and canvas art paths render an unavailable marker, and the special-board export retains every declared row.

The Slowbro 2021 display correction keeps `Slowpoke 2021` as a runtime alias and retains the existing persisted catalog ID `pokemon:80:standard:legacy:Slowpoke%202021`; it performs no storage migration.

Validation:

- `npm run check:costume-sprites`: 14/14 tests passed; generated catalog and 1,062-name public sprite dex are current.
- `node --test tests/sprite-identity-contract.test.cjs tests/pokemon-catalog.test.cjs tests/domain-display-localization.test.cjs tests/i18n.test.cjs tests/safe-transfer-containment.test.cjs`: 75/75 tests passed.
- `node --test --test-name-pattern='canvas renderer uses reviewed sprites|export domain owns' tests/special-trade-board-export.test.cjs`: 2/2 focused renderer tests passed.
- Adapted read-only audit runtime over all 1,286 canonical entries confirmed all nine corrected numeric identities, form-only Urshifu export candidates, gender-and-form-specific female Gigantamax Venusaur candidates, and the declared Salandit same-art fallback.
