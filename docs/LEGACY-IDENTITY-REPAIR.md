# Bounded Legacy Identity Repair

This operator repairs one explicitly approved established legacy identity with
one unambiguous current UID, a missing reciprocal index and exactly one older
password-only credential slot. It is not a migration, provisioning tool, PIN
reset, provider operation or mass-repair job.

## Qualification

The source candidate has focused unit, installed-SDK, Rules and real Auth/RTDB
emulator qualification. Deployment and private production evidence are separate
gates; this document does not claim that the candidate is deployed.

```sh
npm ci --prefix functions/legacy-pin-reset --ignore-scripts
node --test functions/legacy-pin-reset/test/*.test.cjs tests/legacy-identity-fences.test.cjs tests/legacy-slot-reconciliation*.test.cjs tests/legacy-identity-audit.test.cjs tests/product-check-selection.test.cjs tests/legacy-pin-reset-login.test.cjs tests/legacy-pin-reset-ops.test.cjs
bash scripts/check-legacy-identity-fences.sh
npx playwright test tests/legacy-pin-reset.spec.js --project=desktop --workers=1
```

The synthetic journey reproduces the missing-v3-index/enabled-v2 shape. Its
already-issued v2 session can create a synthetic alias before fencing and is
denied after retirement while Auth remains enabled. The real transport executes
all six bounded mutations. Strict inspect and same-UID synthetic reset then pass;
old PIN fails, new PIN succeeds, linked-provider identity and 66 reviewed recovery
records are preserved through runtime reopen/clean-device adoption. Tests cover
lost acknowledgements and explicit resume at every mutation boundary. Synthetic
Firestore absence and GCS journal are test doubles, not live IAM proof.

## Before A Production Plan

1. Obtain approval for one exact username. Do not infer permission for any other
   account from a fleet classification. Never use a real user's PIN to test.
2. Merge reviewed source after the owning checks pass. Deploy only the dedicated
   reset codebase disabled and the exact fence Rules configuration. Keep provider
   services/PR63 disabled and existing least-privilege grants unchanged.
3. Verify the deployed revision and traffic, then wait at least 150 seconds. The
   reader requires timeout at most 120 seconds plus a 30-second margin, no pending/ambiguous reset receipt,
   exact Rules, exact application role permissions and exact disabled provider
   configuration. A gate failure is not permission to weaken it.
4. Derive UIDs from fresh forward/Auth evidence, never browser-supplied UID input.
   Require no aliases, conflicting index/directory, future slots, old provider or
   migration authority, or unique obsolete UID-rooted state. Historical ordinary
   community membership may remain only as an exact duplicate of the current
   UID's membership, with no obsolete owner/Admin authority.

## One-Account Commands

Use an absolute private output path outside committed artifacts. Files are
exclusive-create, mode 0600; an existing manifest is never silently overwritten.
The placeholder `Trainer` below is not authorization to operate on that account.

```sh
node scripts/legacy-slot-reconciliation.cjs plan --username Trainer --manifest /private/tmp/approved-trainer.private.json
node scripts/legacy-slot-reconciliation.cjs verify --username Trainer --manifest /private/tmp/approved-trainer.private.json
node scripts/legacy-slot-reconciliation.cjs apply --username Trainer --manifest /private/tmp/approved-trainer.private.json --approve-manifest APPROVED_SHA256
```

Plan and verify have no remote mutation adapter. Apply requires the exact
manifest fingerprint as a separate explicit argument. There is no `all`, batch,
wildcard, account list, automatic next-account or auto-resume mode.

The manifest binds projected inventory, target user/product/public-share hashes,
both UID-rooted ownership trees, community/trade evidence, provider absence,
both Auth incarnations, current Rules and quiesced writer controls. Every step
rereads these conditions and aborts on drift. Credential exports are excluded
server-side; raw product records are hashed in memory, not saved in manifests.

## Exactly Six Mutations

1. Create exact current-UID maintenance fence with `null_etag`.
2. Create exact obsolete-UID maintenance fence with `null_etag`.
3. CAS the obsolete hold to permanent retirement.
4. Send one disable-existing-Auth request for the obsolete UID, without retry.
5. Create only the exact current `authIndex` record with `null_etag`.
6. CAS-remove only the exact current hold after verifying retirement, disabled
   obsolete Auth and the exact current index.

The obsolete retirement is never removed or expired. There is no Auth create,
delete, PIN update, provider change, UID replacement, product move/copy, recovery
activation or metadata lease. Backend reset stays globally disabled throughout.

## Partial Failure

Preserve the private manifest and progress journal. Re-run `verify`; it recognizes
only the seven exact before/partial/final states. Compare readback with the last
acknowledged step. An unknown state, modified fence, changed Auth incarnation,
ownership drift or pending reset requires review. Never roll back completed steps.

After review, the same approved manifest can be passed to `apply` with `--resume`.
Completed mutations are not replayed. A lost disable acknowledgement is resolved
by reading the existing disabled Auth account, not sending another update. Failed
verification leaves holds in place; there is no timeout takeover or compensation.

## After Reconciliation

Require exact reciprocal authority, unchanged current UID/incarnation/provider
identity, disabled but retained obsolete Auth, permanent obsolete fence, no
current hold and unchanged protected-data fingerprints. Re-enable only the
qualified reset backend. Use the real owner/Auth/App Check session to invoke
`ownerResetLegacyPin({action: "inspect", username: approvedUsername})` and compare
the returned UID with the private manifest. Stop before sending any PIN reset.

A missing fresh owner session is an inspect limitation, not a reason to mint an
owner identity, relax App Check or change the user's PIN. An optional live
retired-session proof uses only an existing suitable synthetic account; if none
exists, document the limitation and retain the emulator evidence.

Rollback disables reset and preserves the ledger, all identity evidence and
enforcement-capable Rules. Never restore pre-fence Rules after a retirement, undo
the obsolete disable, delete Auth accounts or restore an old PIN.

## Read-Only Fleet Audit

```sh
node scripts/legacy-identity-audit.cjs /private/tmp/legacy-fleet.private.json
```

Only counts are printed. The private file contains per-account classifications,
evidence fingerprints and orphan-index/unclaimed-Auth findings. The scan is bounded
to 1,000 records/identities, reports partial evidence explicitly, and does not
claim cross-service atomicity. It has no repair adapter or credential setter.

| Classification | Meaning | Fence relevance |
| --- | --- | --- |
| HEALTHY | Exact current authority; any old slots already qualified retired | No new fence needed |
| SAFE STALE CREDENTIAL | Unambiguous older slot owns no independent state | Helps after fresh one-account qualification |
| MISSING RECIPROCAL INDEX | Current forward authority lacks its index | Helps only if a safe stale slot also exists |
| AMBIGUOUS AUTHORITY | Conflicting handles, UIDs or credential-slot evidence | Not safe to auto-retire |
| PROVIDER / CANONICAL REVIEW | Provider authority or distinct obsolete state changes the interpretation | Requires separate ownership review |
| OTHER CONCRETE ISSUE | Disabled/frozen/malformed/unavailable evidence or unfinished maintenance | Diagnose the concrete issue first |

Priority-review flags identify conflicting evidence with multiple enabled slots,
not proof of abuse. No classification authorizes repair. Missing-index-only,
multiple-stale-slot and provider/canonical cases are deliberately outside this
operator's mutation scope. Re-audit after a separately approved one-account repair;
never silently advance to the next account.
