# .88 closeout

2026-09-05. AUTH CLOSED. No new safety defect identified; no broad requalification.

Fresh read of the public deployment manifest returned release `2026-09-05.88`,
source `b6abc07d103fef194809383cda91e96a39e4531a`, immutable release tag,
and successful deployment run `33948731477`. PR #70's acceptance record is on
the study's base `a30a341c5ff941a5d3b78555792124996e2a6f50`.

Existing valid evidence: synthetic old PIN fails; new PIN authenticates the same
UID; ownership/canonical data unchanged; one completed reset; original reviewed66
receipt preserved. Additive non-authoritative receipts are legitimate evidence,
not a reason to fail whole-collection equality. No friend reset was performed
during qualification or this study. This study does not enumerate live accounts.

The non-owner callable probe was stopped by App Check. It remains UNPROVEN LIVE
after attestation, not a successful authorization denial. Focused authorization
contracts passed. This residual limitation is explicitly retained in
`functions/legacy-pin-reset/PRODUCTION_QUALIFICATION.md`.

Two stale bookkeeping labels corrected on this isolated branch: README status
and deployment-plan state. Runtime code, IAM, Rules and release markers untouched.
README now distinguishes historical gates from current operation.

Disable remains a bounded backend configuration change setting enablement false,
followed by deployed denial verification, quiescence and journal reconciliation.
UI rollback uses guarded immutable Pages control; it does not disable the backend.
Never roll back a PIN/journal, restore mutable bindings, or relax retired-principal
IAM while reset is enabled. Instructions reviewed against the current enablement
check and ownership boundary; not executed as a new production drill.

Owner use: Admin > Maintenance > Reset PIN, for eligible legacy users. No further
auth work is a prerequisite for the design study. Provider rollout and PR #63
operator execution remain explicitly excluded.
