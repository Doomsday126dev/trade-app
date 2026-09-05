# Production Qualification, 2026-09-05

## Applied Controls

- Coordination source PR #68 merged at `76ceb93269cf2b1578a6f12c00df1f3493c9925e`.
- RTDB Rules SHA-256 `a42209aca30fee63c62b9f0494b823106e3c3677e1152b28a56b92fac212053e`.
  Fresh live comparison proved only the three reviewed `.write` guards changed;
  existing read/write scope, validation and provider policy were preserved.
- Dedicated `legacy-pin-reset-runtime` account, exact-object versioned private
  GCS journal, exact-secret access, exact named-Firestore-database read access.
- Retired SDK account now Auth/RTDB read-only. Its broad SDK, Auth Admin, RTDB
  Admin and project Token Creator bindings were removed. No deployed runtime
  used that account. No keys were copied or added.
- Real permission probes confirmed both accounts cannot create/delete Auth
  users or write RTDB. The reset runtime cannot write identity documents, read
  the unrelated control database, or write another bucket object. All temporary
  owner impersonation bindings were removed after these probes.

## Synthetic Fixture

`PINResetSynthetic20260905` is an isolated, explicitly labeled auth/recovery
fixture, not a real trainer. It has no meaningful user data, provider links,
owner/Admin role, or public share. Its UID uses the `synthetic-pin-reset-` prefix.
Creation used create-only RTDB preconditions and an unused Auth UID/login slot.
Credentials and preservation baseline are kept in mode-0600 private operator
files, never in this document, source, public PRs or logs.

Do not recreate or reassign its UID on a partial failure. Reconcile its existing
Auth and RTDB records first. Only this fixture is designated for the live reset.
The friend's account must not be reset as a qualification test.

## Evidence and Remaining Gate

- 101 focused unit/contracts and the installed-SDK boundaries passed before
  the compatible query-parser security patch; rerun with the added regression
  test for this release. No major Firebase SDK upgrade is introduced.
- Three real RTDB/Auth emulator tests enforce immutable ownership, including
  an attempted identity change inside the final-read/password-write interval.
- The focused Auth-emulator/reset/sync journey preserves UID, canonical data,
  and 66 reviewed / 0 active recovery records. A new device may add exactly one
  non-authoritative, zero-seed migration receipt without modifying old receipts
  or reseeding canonical data.
- Owner Admin UI passes desktop and 390px mobile fixture testing with the real
  presentation gate, masked inputs, lost-response reconciliation and session
  cleanup. Ordinary sessions cannot expose the reset action.
- Unauthenticated live callable requests fail with 401; malformed envelopes
  fail with 400. These are not a substitute for a real owner/App Check reset.

Final live acceptance still requires the owner-authenticated callable to reset
the designated synthetic fixture, then old-PIN rejection, new-PIN same-UID login,
unchanged ownership/incarnation/canonical data, and exact receipt reconciliation.
Do not report the feature ready for the friend's reset until that proof passes.

## Dependency Review

The backend pins `qs` 6.16.0 to address the compatible parser advisories and adds
a constructor-shaped input regression test. Remaining moderate UUID findings
require caller-supplied buffers in v3/v5/v6; this endpoint neither accepts those
buffers nor invokes those UUID modes. No high/critical finding was reported by
the production dependency audit. See the
[qs advisory](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) and
[UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

Provider activation and PR #63's operator workflow remain out of scope and were
not run. Control-plane break-glass identity mutation must disable and quiesce
reset first, as documented in `OWNERSHIP_BOUNDARY.md`.
