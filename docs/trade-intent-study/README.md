# PoGo Trades: Trade Intent Study

2026-09-05. Design/prototype only. Based on accepted `.88` and source
`a30a341c5ff941a5d3b78555792124996e2a6f50`. Branch:
`design/trade-intent-study-2026-09`. Not merge-ready production code.

## Recommendation

Two durable destinations: **My List** and **People**. A shared picker edits wants
and offers independently. Sharing is one scope-first action with link, image and
text outputs. A person opens two explicit candidate sets, then a private preparation
checklist and contextual Pokemon GO searches. No separate Board or Compare object.

Build contextual, honest search first. It is useful without a large network,
reuses an existing strength and does not require a data or identity migration.
Fresh reciprocal discovery is the larger opportunity, but not novel by itself.
The advantage to test is exact, current, permissioned intent carried all the way
into a useful real-world trade workflow. No measured '10x faster' claim is made.

## Read the study

| Artifact | Purpose |
|---|---|
| [Auth closeout](00-closeout.md) | `.88` coherent; App Check limitation retained; no new account operation |
| [Research notebook](01-research.md) | Dated observations, primary links, community evidence and access limits |
| [Competitor matrix](02-competitor-matrix.md) | Required tool/workflow comparisons, observed vs documented vs unknown |
| [Current-product audit](03-product-audit.md) | Personas, source-grounded friction and existing strengths |
| [Deletion matrix](04-deletion-matrix.md) | Keep/simplify/merge/demote/remove/defer and DO NOT BUILD |
| [Three concepts](05-concepts.md) | Collection-first, opportunity-first and session-first structures |
| [Workflow specification](06-workflows.md) | A-G flows, collectible rules, honest search, accessibility contracts |
| [Discovery and bets](07-discovery-and-bets.md) | Qualification before ranking, freshness, privacy, directional opportunity ranking |
| [Recommended product](08-recommendation.md) | Coherent target product and visible concepts |
| [Legacy retirement](09-legacy-retirement.md) | Verified archives, same-UID restore, writer fencing, finite compatibility |
| [Test economy](10-test-economy.md) | Permanent boundaries vs temporary proof; explicit deletion gates |
| [Roadmap](11-roadmap.md) | Bounded phases, data impact, rollback, feedback and next-phase prompt |
| [Prototype evidence](12-prototype-evidence.md) | Built interactions, screenshots, checks and honest limits |

## Open the prototype

[Recommended My List](http://127.0.0.1:8912/#list) |
[People](http://127.0.0.1:8912/#people) |
[Three concepts](http://127.0.0.1:8912/#concepts)

The local server must be running. [Reproduction instructions](../../prototypes/trade-intent-study/README.md).
Everything is synthetic and stored only in the browser on this local origin.
Nothing here changes production, enables providers, runs PR #63, or resets a user.

## Review without running

[Mobile list](screenshots/list-390.png),
[combined row editing](screenshots/combined-rows-390.png),
[People](screenshots/people-390.png),
[reciprocal view](screenshots/match-mira-390.png),
[recipient](screenshots/public-390.png),
[desktop](screenshots/list-1440.png).

Next evidence should be observed participant tasks, not another unaided redesign:
first useful list, exact costume/BG distinction, anonymous offer selection, and
preparing both search directions. No participant timings were invented here.
