# My List simplification candidate

Review [the screenshot gallery](index.html): normal list, List tools, and expanded Combine searches at 1440, 390, and 320 pixels. All screenshots use synthetic Avery data with 48 High wants, many exact variants, five Medium, two Low, and six independent special wants. The existing priority sections, row layout, and grouped exports are retained.

Known variants no longer produce numbered manual-check links or per-entry checklists. List tools contains Find in list, Import string, and optional About searches. Find opens focused; closing clears the filter. Combine searches is a single collapsed disclosure with 44 px wrapping toggles and the existing independent section union semantics.

Unresolved species remain explicitly marked as not included, with their names available in the disclosure. Split queries and clipboard recovery retain the canonical serializer and exact per-part bytes. Full-section copies remain available through filtering, collapse, and pagination.

Validation: the changed-area static plan plus priority/performance contracts passed (414 tests, one intentional skip). Focused My List, exports, shared compact-search, and anonymous recipient journeys passed after updating obsolete presentation expectations. Required pull-request CI results are recorded on the candidate PR.

Reproduce the screenshots:

```sh
MY_LIST_SIMPLIFICATION_REVIEW_DIR=docs/my-list-simplification-review/after npx playwright test tests/my-list-simplification.spec.js --project=desktop --workers=1
```

This is a review candidate. Do not merge or deploy before owner visual approval.
