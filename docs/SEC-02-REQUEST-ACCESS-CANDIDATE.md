# SEC-02 Request Access Candidate

Status: local design and emulator candidate only. It is not a production Rules source and must not be deployed. Production remains on the existing Request Access boundary until D2 completes and the compatibility review below is approved.

## Current writer inventory

The supported writer is `submitRequest()` in `index.html`. The `.46` candidate routes its existing behavior through `PogoDomain.requestAccess.build()` and still performs exactly one active write:

```text
set(ref(db, `requests/${requestId}`), payload)
```

The key is `req_<Date.now()>_<lowercase base36 suffix>`. The suffix produced by the current algorithm is one to five characters; the helper guarantees a non-empty `0` suffix for the theoretical `Math.random() === 0` edge. The reviewed pattern is:

```text
^req_[0-9]+_[a-z0-9]{1,5}$
```

The new-request payload is exactly:

```js
{
  username: string,
  note: string,
  requestedAt: number,
  status: "pending"
}
```

The UI trims username and note, requires a username of at least two characters, resolves casing against known login names, rejects registered/pending duplicate names case-insensitively, and stores an omitted/empty note as `""`. The candidate additionally rejects C0/DEL control characters, including line breaks, before constructing the payload. The emulator Rules independently reject boundary spaces, NUL, tab, CR, and LF; the final representable Rules policy for the remaining uncommon controls stays part of compatibility review. It does not impose a username or note maximum.

`requestedAt` remains the same numeric client `Date.now()` value used in the key and payload. No server timestamp or skew policy is introduced. Anonymous submission always creates `pending`. Admin approval changes `pending` to `approved` as part of `createMemberNow()`; denial changes it to `denied`. The supported UI does not use `rejected`.

## Proposed new-request contract

| Field | Create | Normalization | Mutability |
| --- | --- | --- | --- |
| `username` | Required string, at least two characters | Trim outer whitespace; preserve Unicode, case, and internal spaces; reject C0/DEL controls | Immutable |
| `note` | Required in storage; optional in UI and represented by `""` | Trim outer whitespace; preserve Unicode; reject C0/DEL controls | Immutable |
| `requestedAt` | Required non-negative integer client timestamp | None | Immutable |
| `status` | Required literal `pending` | None | Admin-only transition to `approved` or `denied` |

No additional fields are proposed. Unknown and nested children fail closed. Anonymous creation under an arbitrary key fails. Anonymous and authenticated non-admin actors cannot read, overwrite, update, transition, or delete requests. An indexed Admin/owner can read requests, transition `pending` to `approved` or `denied`, and delete a request. Admins cannot rewrite identity, note, timestamp, or add children through this candidate.

The emulator fixture intentionally accepts far-past/far-future integer timestamps and large username/note stress values. Those are test markers for unresolved policy, not endorsements of unlimited production data.

## Authorization matrix

| Operation | Anonymous | Authenticated non-admin | Admin | Owner in Admin index |
| --- | --- | --- | --- | --- |
| Create canonical pending request | Allow | Deny | Deny through this public boundary | Deny through this public boundary |
| Modify username/note/requestedAt | Deny | Deny | Deny | Deny |
| Add unknown child | Deny | Deny | Deny | Deny |
| Change `pending` to `approved` | Deny | Deny | Allow | Allow |
| Change `pending` to `denied` | Deny | Deny | Allow | Allow |
| Delete | Deny | Deny | Allow | Allow |
| Read collection | Deny | Deny | Allow | Allow |

The candidate does not expand any active Firebase surface. Its Rules and Firebase config live only under `tests/firebase/` and are invoked only by `check:request-access-candidate-rules` against a demo emulator project.

## Compatibility decisions deferred until after D2

Perform a narrowly scoped, aggregate-only, read-only inventory after D2. Do not include request text or trainer names in the report. Record only:

1. Request count and key-pattern variants, including suffix lengths.
2. Maximum and distribution buckets for username length.
3. Maximum and distribution buckets for note length.
4. Counts for missing, empty, whitespace-only, multiline, and non-string notes.
5. Field-set variants and unknown-child names/counts.
6. `requestedAt` type counts, minimum/maximum, non-integer/negative counts, and observed clock skew relative to trustworthy adjacent metadata where available.
7. Status value counts and transition-relevant legacy variants.
8. Counts of leading/trailing whitespace, control characters, and non-string usernames without exposing values.

Stop if the inventory requires broad content export, exposes request content, encounters an unexpected schema, or cannot be performed read-only. Use the results to choose actual username/note maxima and timestamp skew. The previously suggested 32/280 limits remain unapproved.

## Cached-client and Rules rollout

Production currently serves `.40`; cached clients can outlive a later client deployment. The safe order is:

1. Complete D2 and its observation.
2. Run and review the aggregate historical inventory.
3. Select compatible size and timestamp policies.
4. Finalize client and candidate Rules together.
5. Deploy the compatible client first.
6. Allow a reviewed cache compatibility window or make the Rules accept the last supported cached writer shape.
7. Re-run adversarial emulator tests against the exact deployable Rules source.
8. Deploy Rules separately with no unrelated Rules change.
9. Monitor permission-denied/request-submission errors and legitimate rejection rate.
10. Roll back to the prior Rules immediately if a supported client or legitimate historical Admin transition is rejected.

Stop before Rules deployment on unknown historical fields/statuses/keys, unresolved bounds, cached-client mismatch, changed Admin transition semantics, emulator divergence, a new active Firebase path, or inability to observe rejection safely.

## SEC-05 boundary

SEC-02 handles exact schema validation, immutable request fields, key validation, least-privilege request authorization, and control-character rejection. Safe Admin DOM rendering remains the independent SEC-01 defense even when input validation succeeds.

Rate limiting/abuse controls, CSP/hosting headers, platform-wide request throttling, bot mitigation, and global monitoring are separate SEC-05 backlog. This candidate does not broaden into those systems.

## Known unrelated Rules debt

The future Global Rules emulator suite still has its pre-existing inactive `accounts` reference failure. The dedicated SEC-02 fixture does not import or alter that suite, production Rules, or any deploy configuration.
