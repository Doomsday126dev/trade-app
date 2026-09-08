# Focused My List performance qualification

`tests/my-list-performance.spec.js`: **2 passed in 9.4 seconds**, one desktop Chromium worker. Existing numeric budgets were preserved. No other agents ran browser tests during this benchmark.

The fixture blocks remote requests and measures the local list runtime, not Auth or network startup. Its readiness gate waits for the local renderer and completed Firebase startup attempt; waiting for a successful remote Auth transition would conflict with deliberate network isolation. No authentication runtime was changed.

| At 1,000 synthetic wants | Measured | Existing budget |
| --- | ---: | ---: |
| Initial rendering | 35.8 ms | < 200 ms |
| Filtering | 14.9 ms | < 100 ms |
| Row update | 16.3 ms | < 100 ms |
| Initially rendered rows | 120 | 120 |
| DOM nodes | 1,648 | ≤ 2,500 |
| Controls | 492 | ≤ 1,000 |
| HTML bytes | 319,677 | ≤ 358,400 |

Explicit section paging reached all 1,000 rows. No editors were eagerly hydrated. The 100, 250 and 500-entry cases also passed.

| 120 rows, 4× CPU throttling | Measured | Existing budget |
| --- | ---: | ---: |
| Filter | 20.0 ms | < 50 ms |
| Clear filter | 14.6 ms | < 50 ms |
| Edit | 13.0 ms | < 100 ms |
| Maximum long task | 66 ms | ≤ 200 ms |

The test also verified a single declaration build for filtering, preserved unchanged row nodes, replacement of the changed row, and coalescing rapid filter input to the latest query.

The separate real-artwork review fixture contains **1,004 declarations with 120 initial rows**. It validates bounded presentation alongside the visual sample; its setup time is not treated as a controlled performance benchmark.

Raw measurements: [performance.json](performance.json). Visual fixture: [large-list.json](visual/after/large-list.json).
