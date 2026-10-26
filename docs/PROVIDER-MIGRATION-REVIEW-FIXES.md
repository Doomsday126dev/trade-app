# Independent review fixes after 8e85912c

The independent read-only review reproduced two correctness issues in the
inactive candidate. Both were reproduced locally before changing the code.

1. A canceled request could later navigate, recreate a review, or call Firebase
   sign-in. Cancellation now increments an operation generation, aborts fetch
   where supported, invalidates the auth commit guard and prevents stale
   finally handlers from releasing a newer operation. Checks run after every
   asynchronous boundary. The Firebase blocking hook also checks cancellation,
   so cancellation accepted before that hook cannot install the user.
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

## Later Firebase middleware and the commit boundary

The reviewer subsequently identified a narrower ordering: our blocking hook
accepts the UID, then a later asynchronous hook waits while Cancel is pressed.
The pinned Firebase 12.14.0 SDK reproduced this in the demo Auth emulator:
the old promise rejected as canceled even though `auth.currentUser` was installed.
Firebase does not rerun earlier middleware after the later hook resolves.

The gate now signals an explicit commit boundary when its middleware accepts
the transition. Before that boundary Cancel still invalidates the operation and
the hook rejects the transition. From that boundary until settlement the client
reports `{status:'committing',canCancel:false}`; `cancel()` returns that same
nonaccepted outcome and does not invalidate the operation. Hosts must disable
Cancel and display “Finishing sign-in” during this state. A successful commit
reports sign-in success, and a later middleware failure reports that actual
failure. The gate never reports a completed transition as canceled or tries to
undo it by signing out a possibly newer account. This is a deliberate short
non-cancelable boundary, not a guarantee Firebase can abort a committed login.

The real-SDK regression registers a later held hook after our hook, presses
the actual client Cancel while it waits, verifies cancellation is refused, then
checks the terminal success and exact installed UID. The earlier real-SDK
regression still proves cancellation before our hook leaves the account signed out.

Performance CI on the reviewed commit reported a 202 ms long task against the
unchanged 200 ms limit, with all other seven browser checks passing. A paired
local run used the exact CI merge tree and current-main baseline, the same host,
same original harness and original budgets. Both passed 8/8; the interaction long
-task maxima were 54 ms for candidate and 0 ms for baseline. No performance
threshold, renderer implementation or test was changed. A first diagnostic
attempt encountered an unrelated occupied local port; the successful paired
run used isolated ephemeral ports. Updated-head CI must still pass normally.
