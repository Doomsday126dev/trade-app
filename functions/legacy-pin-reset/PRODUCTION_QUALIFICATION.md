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

## Evidence and Live Acceptance

- 102 focused unit/contracts and installed-SDK boundaries pass with the
  compatible query-parser security patch. Three additional operator-probe
  contracts reject API/network errors masquerading as credential failures and
  reject a successful login to a different UID. No major SDK upgrade is used.
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

On 2026-09-05 the owner completed the designated synthetic reset through the
production UI. The live journal contains one completed request for that fixture
and no requests for other accounts. Independent credential verification from a
fresh browser at the real production origin confirms old-PIN rejection and
new-PIN authentication to the original UID. The synthetic ownership, Auth
creation time/provider identity, and canonical/product snapshot equal baseline.

Read-only preservation checks also confirm unchanged identity, canonical data
and original reviewed evidence. Additional valid, non-authoritative review
receipts are retained, not suppressed to satisfy collection equality. Historical
server candidate collections are not misrepresented as the current device's
active recovery count. The focused clean-device test remains 66 reviewed / 0
active, with no reseeding or canonical writes. Detailed live evidence stays in
private operator records rather than public PR comments.

The browser probe uses the production origin because the Web API key correctly
rejects direct CLI requests with `API_KEY_HTTP_REFERRER_BLOCKED`. No fabricated
Referer header or API-key relaxation is used. Request tokens and PINs are not
returned to the operator console or persisted in a browser profile.

Owner-only authorization, request/UID isolation, and replay mismatch denials are
covered by focused contracts. The automated non-owner live callable probe was
stopped by App Check attestation before dispatch and is not claimed as a passed
post-App-Check authorization test. The real owner reset proves the production
Auth/App Check path. No friend's account was reset during qualification.

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
