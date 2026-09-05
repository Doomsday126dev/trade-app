# Firebase read contract reconciliation

The accepted .87 application contains 25 direct `get` sites. The prior registry
expected 17. This is a net delta: 17 prior sites - 1 retired site + 9 additions = 25.

`scripts/check-firebase-reads.js --inventory` emits the machine-readable inventory
with source file/line, enclosing handler, exact expression, normalized path,
surface, gate, audience, lifecycle, classification and retention rationale.
Reviewed site descriptions live in `js/data/firebaseReadRegistry.js`.

## Added and removed sites

| Accepted source line | Handler / path | Class | Decision and reason |
| --- | --- | --- | --- |
| 1295 | resolveGoogleAccountBinding / authIndex | D | Retain inactive migrated-foundation branch: verify current legacy mapping. |
| 1298 | resolveGoogleAccountBinding / users | D | Retain inactive migrated-foundation branch: verify reverse UID binding. These two calls are exclusive with the existing missing-foundation branch, not duplicates in one lifecycle. |
| 2334 | writeProviderPublicShareSnapshot / trainerShares | D | Retain gated publication readback: transaction success/timeout is not matching-projection evidence. |
| 2425 | writeVerifiedLegacyPublicSnapshot / publicShares | C | Retain publication readback: compare content and hydration token before success/copy. |
| 2697 | createMemberNow / users | D | Retain error-path evidence: protect an already committed member from Auth cleanup after ambiguous failure. |
| 2771 | readLegacyProvisioningFreeze / legacyProvisioningFreeze | D | Retain default-disabled existing safety preparation. No gate is enabled here. A planned safety read is not proven dead merely because its gate is off. |
| 2904 | accountSyncRolloutEligible / authIndex | C | Retain fresh forward identity mapping at canonical runtime start. |
| 2905 | accountSyncRolloutEligible / users/authUid | C | Retain fresh reverse binding before adoption; earlier login evidence crosses a lifecycle boundary. |
| 2906 | accountSyncRolloutEligible / accountSync | C | Retain migration/recovery state for fail-closed eligibility. |
| Retired before .87 | checkGoogleOnboardingHandle / loginDirectory | Removed upstream | Remove stale registry entry only. Accepted source defers final handle authority; this task does not restore the lookup. |

Class A covers the sixteen exact pre-existing sites. None is unknown or unjustified.
No runtime read was removed here. Normal login, Admin verification, first adoption,
Board preservation and public v1/v2 compatibility remain unchanged. The explicit
login-health diagnostic and owner community tools remain legacy/transitional;
broader retirement is deferred.

## Other contract drift

The public snapshot handler now marks a validated projection's runtime source as
legacy. Its hash is refreshed to the accepted body after review: it still validates
status, handles unavailable shares, and never persists another trainer's public data
into the protected cache. The legacy broad snapshot hash is unchanged.

The anonymous public bootstrap has a gated `client.read(request.username)` callable
gateway. Its exact expression is registered separately. Repository membership is
derived from parsed calls, excluding strings/comments; exact calls inside those
files are checked too. A filename alone grants no read allowance.

Every direct read is parsed with Acorn and matched in order by file, handler and
expression. The count is derived from the reviewed sites and compared with parsed
source. Token hashes of all fourteen enclosing read handlers bind indirect target
paths and execution gates, not just `get(target)` spellings. Existing exact needles,
snapshot hashes and lifecycle assertions remain. Mutation tests cover added reads,
equal-count substitutions, indirect paths, gates, repository and snapshot changes.

## Immutable runtime and control

The prepared .87 runtime tag and bytes do not move. This correction follows the
existing separate control/runtime procedure: new immutable control commit A,
dispatcher-only pin commit B, and a new selector. Control runs its reviewed read
checker and registry against the selected runtime checkout. The artifact builder
still packages only the unchanged tagged runtime files; it does not substitute
newer registry metadata or the parser into the frontend.

No product behavior, provider capability, backend, credential or data changes are
included. Earlier exact-runtime product/performance evidence remains valid. The
old .86 runtime and compatible original control remain the rollback pair.
