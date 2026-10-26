# Independent review fixes after 8e85912c

The independent read-only review reproduced two correctness issues in the
inactive candidate. Both were reproduced locally before changing the code.

1. A canceled request could later navigate, recreate a review, or call Firebase
   sign-in. Cancellation now increments an operation generation, aborts fetch
   where supported, invalidates the auth commit guard and prevents stale
   finally handlers from releasing a newer operation. Checks run after every
   asynchronous boundary. The Firebase blocking hook also checks cancellation,
   so a request already in flight cannot install the user after cancellation.
   Cancellation is distinct from a backend confirmation already committed:
   that outcome must be reconciled from the receipt/private method snapshot;
   cancellation does not attempt to undo a prior authorized transaction.
2. A second unconsumed review could reconnect a method after another review
   linked it and the user unlinked it. Begin now captures the monotonic provider
   lifecycle revision, including zero for absence. Review creation verifies that
   revision and records the subject mapping revision. Claim verifies both inside
   its transaction. Receipts bind their resulting lifecycle revision, preserving
   exact retry while rejecting stale-consent replay. Fresh explicit consent after
   release remains supported.

Regressions cover held begin/completion/commit cancellation, cancellation in the
real Firebase 12.14.0 custom-token hook, two pending reviews, concurrent claim/
release and a genuinely fresh relink. Demo Auth/Firestore emulators passed all
10 tests after the fixes; no real OAuth grant or account was used.

Performance CI on the reviewed commit reported a 202 ms long task against the
unchanged 200 ms limit, with all other seven browser checks passing. A paired
local run used the exact CI merge tree and current-main baseline, the same host,
same original harness and original budgets. Both passed 8/8; the interaction long
-task maxima were 54 ms for candidate and 0 ms for baseline. No performance
threshold, renderer implementation or test was changed. A first diagnostic
attempt encountered an unrelated occupied local port; the successful paired
run used isolated ephemeral ports. Updated-head CI must still pass normally.
