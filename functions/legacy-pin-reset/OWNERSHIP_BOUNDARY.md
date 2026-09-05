# Immutable Legacy Ownership Boundary

The smallest correct coordination mechanism for the existing legacy architecture
is exclusion, not a renewable lock: an established trainer never changes UID.
The product already rejects replacement-UID repair; enforce that invariant on
every application write, including stale clients and direct Admin client requests.

## Database Enforcement

`firebase.legacy-identity-guard.json` changes only three production `.write`
policies. `scripts/build-legacy-identity-guard.cjs` accepts only the exact reviewed
live baseline hash. It does not deploy the newer profile Rules, provider Rules,
or PR63's operator configuration.

- `users/{username}`: once `authUid` exists, preserve it and established email
  and version. Reject deletes, parent overwrites, UID swaps, and duplicate aliases
  claiming a UID indexed to another name. Missing legacy metadata can be filled.
- `authIndex/{uid}`: preserve an established username; require reciprocal user
  ownership. Recovery review receipts and lastSeen updates still work.
- `loginDirectory/{username}`: a bound account's directory must remain on the
  user record's existing login slot. Same-UID repair remains permitted.

These are `.write` restrictions, including for Admin clients, because `.validate`
does not protect deletion. Atomic multi-path swaps cannot bypass them. No new
product writes, migration, receipt suppression, lock leases or stale-lock recovery
are needed in reset. The GCS ledger still serializes password resets and locks
ambiguous requests without takeover.

## Auth Incarnation Enforcement

An end-user Auth API cannot select/recreate a particular UID. The only production
application principal with privileged create/delete and RTDB-write capabilities
was the old `firebase-adminsdk-fbsvc` account. No deployed Function or Cloud Run
service uses it; no repository deployment secret depends on it. Remove all four
project roles listed in `deployment-plan.json`, including Token Creator and the
SDK role which itself grants create/delete, Rules writes and token minting.
Replace them with Auth/RTDB read-only permissions. Never grant it permission to
impersonate reset or another writer. Retire the old local reset CLI's apply mode
and remove its mutation adapter, keeping its read-only diagnostic path.

The new reset runtime has Auth get/update but no create/delete/import or
impersonation, and no database write authority. The deployed provider services
remain disabled and have no Auth create/delete or legacy RTDB-write authority.
Provisioning creates a new server-assigned UID and cannot replace an established
binding. Therefore an application writer cannot recreate the inspected UID or
transfer its legacy ownership during the password request.

This is not an assertion that Firebase has a cross-service transaction or an
Auth password-update ETag. A project owner can rewrite IAM/Rules or recreate
accounts; no application lock can fence that control plane. Such break-glass
operations must first disable and quiesce reset. Future deployments must preserve
this boundary, or disable reset before enabling ownership-changing services.
Reactivating PR63/provider migration while reset is enabled is not qualified.

## Required Production Proof

Before enablement, inspect effective permissions and test the retired account
and runtime against denied Auth create/delete and RTDB writes. Read-only evidence
must remain available. Verify exact deployed Rules and no unrelated policy change.
The runtime requires `LEGACY_IDENTITY_BOUNDARY=immutable-bindings-v1` in addition
to the existing enablement/owner gates. This configuration records qualification;
the actual exclusion comes from Rules and IAM, not this string or another read.

Use only an obviously synthetic isolated identity for mutation proof. Verify old
PIN rejection, new PIN authentication to the same UID, preserved creation time,
unchanged ownership/product state, exact receipt reconciliation and cross-account
denials. Never reset the friend as a test. Keep production credentials in private
operator state, never in commits, arguments, logs or public PR descriptions.

## Clean Device

Enrollment may append a non-authoritative device receipt. Preserve all existing
receipts, UID/ownership, canonical records and reviewed66 evidence. The new receipt
must have zero seeds, no canonical writes, no repeated account initialization and
no active recovery candidates. Do not suppress legitimate audit evidence.
