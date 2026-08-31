# Trusted-User Testing Wave 1

## Cohort

Invite 3–5 trusted Pokémon GO traders. Test accepted production release `2026-08-31.86`; do not use a preview branch. Each tester should use their own disposable test entries and avoid deleting anything they care about.

## What Testers Receive

1. [`CHECKLIST.md`](CHECKLIST.md)
2. [`FEEDBACK-TEMPLATE.md`](FEEDBACK-TEMPLATE.md)

Do not demonstrate the journeys first. Give only login/access help that is necessary to begin, then let each tester discover the product independently.

## Coordinator Flow

1. Record the tester and device in [`RESULTS-LOG.md`](RESULTS-LOG.md).
2. Ask the tester to complete the checklist in one sitting when practical.
3. Capture the first point of confusion before explaining the feature.
4. Classify every finding with [`SEVERITY-RUBRIC.md`](SEVERITY-RUBRIC.md).
5. Stop and preserve evidence for P0. Escalate P1 before adding more testers. Batch P2/P3 for review.
6. Confirm the tester removes disposable data when finished.
7. Across the wave, exercise EN, JA, ES, and DE where practical; record untested locales honestly rather than inferring coverage.

## Exit Review

Wave 1 is complete when 3–5 testers have recorded outcomes for all practical journeys, all P0/P1 findings have explicit dispositions, and no fabricated or inferred result is entered for an untested journey.

## Carried Maintenance Backlog

These are not Wave 1 blockers unless a tester encounters a concrete product failure:

- 21 pending reviewed costume artworks on the `.81` baseline
- 42 background eligibility mappings
- background artwork/source strategy
- optional Special Trade Board background filter
- account-isolation sync scenario not exercised

Provider linking, Google login, Discord login, and public beta remain outside this wave.
