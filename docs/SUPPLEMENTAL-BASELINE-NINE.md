# Supplemental Baseline: Nine Reported Failures

## Scope And Reproduction

The nine failures reported in the `.99` production closeout were reproduced again on current `.100` main at `c3fd690a2a2c46dab448873b244e496199283694`. This is baseline remediation, not attribution to the UI consolidation task. No historical-suite sweep, provider rollout, release-marker change, or deployment is part of this work.

The earlier uncommitted `fix/supplemental-baseline-nine` work is preserved in its original worktree. Qualification is reconstructed on the current main SHA in a separate worktree and branch, `fix/supplemental-baseline-nine-100`. Current main's reduced boot graph is retained. The only runtime file changed is `js/app/application.js`, and its only changed function is `ensureAccountSyncRuntime`.

The initial targeted run selected the exact nine test names and the one reported skipped journey. Result: nine failures, one skip. The owning files are `tests/account-sync-integration.test.cjs`, `tests/legacy-pin-reset-admin-errors.test.cjs`, and the single emulator journey in `tests/account-sync-runtime.test.cjs`.

## Nine-Item Disposition

| # | Original reported failure | Classification | Evidence and resolution |
|---|---|---|---|
| 1 | owner-only migration reads are explicitly registered in the Firebase source contract | 2. Stale test expectation | The hard-coded global count of 17 reads is obsolete; the reviewed registry has 25 distinct read sites. The replacement assertion checks the migration handler's exact registered site, not an unrelated global count. Behavioral coverage verifies the five exact current-user paths and rejects a mismatched reverse UID or replaced same-UID session. The existing read-registry checker independently passes at 48 surfaces, 25 `get` sites and zero direct `onValue` sites. |
| 2 | cross-device sync is limited to one domain-separated owner hash and remains inert for every other account | 2. Stale test expectation | Normal reciprocal-identity enrollment superseded the single-owner canary. The updated test verifies server admission before journal/repository construction and the fail-closed `normalSyncEligibility` result. Existing owning eligibility coverage passes for valid enrollment, paused enrollment with initialized-account resumption, invalid/missing reciprocal identity, incompatible canonical metadata, and same-UID session replacement. No rollout configuration was changed. |
| 3 | Special Trade Board edits mutate a detached copy and render only after journal success | 2. Stale test expectation | `getSpecialBoard` now projects declaration references for read-only curation; retained legacy records are read through `getStoredSpecialBoard`. The replacement test proves retained records are detached, toggling a declaration changes only the selection, changing owner resets selection, and the active renderer/HTML does not bind the obsolete editing handlers. Stored data and declarations remain unchanged. Retained write behavior remains covered under item 6. |
| 4 | auth transitions invalidate stale sync starts before publishing account state | 1. Real current product defect found through owning coverage | The original regex was stale because session binding was strengthened to Auth-object identity plus session generation. Replacing that regex alone would have missed a real race: both new and reused runtime snapshots could publish after an awaited snapshot crossed a session boundary. The expanded tests reproduce 54 failing race subcases against untouched `.100` source; all 75 subcases pass with the carried-forward fix. `ensureAccountSyncRuntime` rechecks captured session/runtime/generation before publishing snapshot success or failure, and after stopping a disabled runtime. Tests cover sign-out, other-account sign-in, restored sessions, Auth-object/name/session-generation/runtime-generation/runtime replacement, resolved and rejected snapshots, startup failure, and valid same-generation work. Late captured private/public projection callbacks are rejected before reaching their sinks. Stale work cannot overwrite UI state, clear another session's initial profile, retire its queue, or stop its replacement runtime. |
| 5 | unsafe canonical state outranks conflict presentation and conflict actions recheck authority | 2. Stale test expectation | The old regex omitted the additional `sessionCurrent()` requirement for listener health. The updated assertion retains that stronger condition, unsafe-evidence precedence, and conflict-action health checks. Owning behavioral tests confirm unsafe evidence outranks conflicts without losing retained counts, listener attachment alone grants no authority, and stale/deactivated callbacks cannot publish or mutate a replacement session. |
| 6 | canonical product mutations remain bound to the exact authenticated runtime captured before the write | 2. Stale test expectation | Board writes now pass `{authority,baseBoard}` rather than only `{authority}` so planning uses the captured edit base. The updated assertion preserves runtime/controller identity checks. Behavioral coverage verifies the exact authority and base snapshot are forwarded, existing for-trade records are preserved, blocked/stale/failed writes return false without legacy fallback, and current stored data is not mutated. Existing Board planning coverage confirms unrelated remote fields and new remote entries are not overwritten. |
| 7 | Login ready v3 with absent reciprocal index fails before Firestore eligibility and never repairs identity | 3. Fixture issue | The fake reset adapter omitted the required `readIdentityFence` method, so the test stopped at a TypeError instead of its intended identity check. The fixture now records exact fence reads and returns explicit unfenced evidence. The original identity-conflict expectation passes before eligibility reads, receipts, or credential mutation; evidence remains unchanged. |
| 8 | a second enabled legacy Auth slot still fails when v3 reciprocity is present | 3. Fixture issue | Same missing adapter method. The duplicate Auth slot is now explicitly marked enabled. With fence reads supplied, the unchanged identity-conflict assertion passes and no credential or journal mutation occurs. |
| 9 | consistent existing v3 identity remains inspectable with recent owner auth | 3. Fixture issue | Same missing adapter method. Valid, unfenced reciprocal v3 identity is inspectable and returns the same target UID. Added owning negative coverage proves a fenced owner or target fails before eligibility or mutation. Production reset code and adapter behavior were not weakened or changed. |

None of the nine failures is dismissed as an intentional unsupported scenario. Item 4 includes an obsolete source assertion, but its disposition is a genuine defect because owning behavioral coverage found and reproduced the missing post-await session fence.

## Reported Emulator Skip

The journey is `same-UID PIN reset preserves canonical data and reviewed66 across Auth emulator login and runtime reopen`.

The current journey includes retired-slot reconciliation and therefore requires both local Auth and RTDB emulators, not Auth alone. The Auth-only attempt failed on the helper's missing RTDB prerequisite; that failure was not bypassed. The existing `firebase.legacy-identity-fences.emulator.json` configuration supplies demo Auth at `127.0.0.1:9499` and RTDB at `127.0.0.1:9500` for `demo-legacy-pin-reset`.

The paired-emulator run passed the journey and its additive-receipt subtest: two passes, zero failures, zero skips. It exercises old-PIN denial, same-UID new-PIN login, emulator-only provider-link preservation, retired-UID fencing, unchanged canonical/recovery evidence, and retention of all 66 reviewed recovery records across reopen and clean-device adoption. No real account or production service was used.

Ordinary unit runs intentionally skip only when neither emulator variable is configured, with a concrete reason naming the configuration, ports, and production prohibition. Partial or wrong emulator configuration fails explicit assertions rather than silently skipping.

```sh
firebase emulators:exec --project demo-legacy-pin-reset \
  --config firebase.legacy-identity-fences.emulator.json --only auth,database \
  "node --test --test-name-pattern='same-UID PIN reset preserves' tests/account-sync-runtime.test.cjs"
```

The legacy reset package's existing dependencies must be available for this command. No production credentials are needed.

## Why The Fix Is Narrow

The function previously checked authority before or around startup, but assigned the result of an awaited snapshot directly to shared UI state. A sign-out, account switch, restored session, or runtime replacement during that await could make the result stale. Some error and disabled-runtime paths also awaited work before publishing without another authority check.

The fix holds the result locally and checks the same captured Auth object, trainer name, session generation, runtime identity and runtime generation before publishing it. Existing same-session checks remain satisfied, so successful current-generation work still publishes; deterministic positive controls verify that behavior. Rejected current-session snapshots still report their legitimate failure. No new queue, lock, retry loop, broad synchronization mechanism, schema, hydration bypass, App Check exception, or authority shortcut was introduced. Existing listener fencing and public/private projection checks are retained and exercised.

## Verification On .100

- Exact original reproduction: nine failures and one skip on the stated `.100` main SHA.
- Corrected exact nine regressions: 84 passes (nine top-level tests plus 75 auth-race subcases), zero failures, zero skips.
- Nine selected owning invariants for Board planning, unsafe recovery, listener/session authority and runtime source acquisition: nine passes, zero failures, zero skips.
- Paired Auth/RTDB journey: two passes, zero failures, zero skips.
- Repository-selected changed-area Node contracts: 449 passes, zero failures, one documented emulator prerequisite skip; that journey passed separately with both emulators.
- Required local release/runtime suite: 110 passes, zero failures. Release coherence, domain-helper, community-membership and global-identity checks pass without a version bump.
- Firebase read-registry checker passes: 48 surfaces, 25 `get`, zero direct `onValue` sites.
- All 23 repository-selected changed-area browser journeys pass, including fresh Username/PIN login, restored authenticated startup on the reduced boot graph, App Check-gated public reads, normal canonical edits, and recovery rejection without legacy fallback. Hosted required CI is reported in the focused PR qualification results.
- No test was deleted or marked permanently skipped; two obsolete test titles were renamed to describe the surviving product behavior.

Changes are limited to one runtime function, the three owning test files, and this disposition report. They are prepared on `fix/supplemental-baseline-nine-100` for PR review only. A separately approved runtime release will be required after merge to ship the fix. This qualification does not bump `.100`, merge the PR, or deploy anything.
