# Wave 1 Severity Rubric

| Level | Definition | Wave 1 handling |
| --- | --- | --- |
| P0 | Data loss, private-data exposure, or account corruption. | Stop the affected test, preserve evidence/state, and escalate immediately. Do not continue rollout until disposition is explicit. |
| P1 | Login, list, sync, public share, or another core journey is broken. | Pause adding testers to the affected path, reproduce narrowly, and require a clear fix or risk decision. |
| P2 | Major confusion, a hard-to-find feature, misleading artwork/identity, or a material mobile/performance issue. | Record with evidence, continue unaffected journeys, and review before the next wave. |
| P3 | Copy, alignment, or minor visual polish. | Record and batch. Isolated P3 findings do not interrupt Wave 1. |

Use the highest level whose definition is actually demonstrated. A worried guess is not a P0, and a workaround does not automatically make a broken core journey lower than P1.
