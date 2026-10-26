# CI-only costume-gap signal refinement

No runtime, app, account, notification or permission changes. Daily09:17UTC source validation and deployed-runtime comparison remain.

The reviewed baseline captures all391catalog fingerprints and acknowledges the27existing missing-art records from audit40249376535. It expires seven days after this review; a baseline may never exceed14days. Acknowledgement does not mean verified art, completeness, or a fix. No workflow writes or renews this file. Renewal/removal/additions require a reviewed code change, keeping exact asset/source validation intact.

Report partitions: New(new missing-art identity); Changed(existing gap's identity/art/provenance differs); Known(unchanged acknowledged missing art); Resolved(no longer a missing-art row). Removed catalog identities are explicitly identified as removal, never proven art resolution. Every changed catalog mapping—including a gap replaced with exact art—still fails for review. Thus a newly attached image cannot self-approve via HTTP200.

Failures remain substantive for New/Changed, any mapping change, removed identity, expired/missing/malformed/future baseline, unavailable/failed/stale source report, missing reviewed release identity, deployed mismatch, runtime parsing/fetch error. The existing source checker separately fails new source files/labels, integrity errors and stale evidence. PR candidate-only mode skips live deployment comparison but not new/changed/expired/input failures.

Known-only records no longer keep the daily workflow permanently red. The summary leads with all four counts and total unresolved; full known-gap names and details remain in the downloadable costume-maintenance.json artifact. Separate Shiny coverage remains explicitly uncertified; this work does not add an exhaustive Shiny release inventory or artwork verification.

Baseline expiry intentionally makes the next review necessary. Check the expiry in data/costume-gap-baseline.json. No automatic acknowledgement, date extension, art substitution, notification setting change, new credentials or outbound message is added. GitHub email/web delivery still depends on the owner's existing Actions notification preferences and remains unverified.

Qualification includes new Astronaut-like omission, changed identity/asset/hash/provenance, resolved and deleted gaps, expiry, future/excessive baseline, unavailable input, failed/stale source report and deployed mismatch. First-run expected partition: New0/Changed0/Known27/Resolved0, unresolved27, zero deployed mismatches, current source input.
