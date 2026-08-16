# SEC-02 Request Access Candidate

Status: final source-only candidate, emulator validated and **not deployed**. The `.49` client must be served for a full 24-hour cached-client window before a separately approved Rules deployment.

## Current writer inventory

The supported writer is `submitRequest()` in `index.html`. The final client routes its behavior through `PogoDomain.requestAccess.build()` and still performs exactly one active write:

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

The centralized builder trims username and note, resolves casing against known login names, requires a username of 2–32 UTF-16 string units, permits Unicode and internal spaces, and stores an omitted, empty, or whitespace-only note as `""`. Notes may contain 0–280 UTF-16 string units. This matches the RTDB Rules `String.length` convention, including supplementary Unicode characters counting as two units. Both fields reject C0 and DEL control characters. The candidate Rules independently enforce the same accepted size boundary and the complete C0/DEL exclusion through emulator-proven expressions.

The builder captures the client clock once and uses that exact nonnegative integer for both the key timestamp and `payload.requestedAt`. Rules do not compare the value to current time, so historical administration cannot fail because a creation timestamp has aged. Anonymous submission always creates `pending`. Admin approval changes `pending` to `approved`; denial changes it to `denied`. Both are terminal. The supported UI does not use `rejected`.

## Proposed new-request contract

| Field | Create | Normalization | Mutability |
| --- | --- | --- | --- |
| `username` | Required string, 2–32 characters | Trim outer whitespace; preserve Unicode, case, and internal spaces; reject C0/DEL controls | Immutable |
| `note` | Required string, 0–280 characters; optional in UI and represented by `""` | Trim outer whitespace; preserve Unicode and internal whitespace; reject C0/DEL controls | Immutable |
| `requestedAt` | Required non-negative integer client timestamp | None | Immutable |
| `status` | Required literal `pending` | None | Admin-only transition to `approved` or `denied` |

No additional fields are proposed. Unknown and nested children fail closed. Anonymous creation under an arbitrary key fails. Anonymous and authenticated non-admin actors cannot read, overwrite, update, transition, or delete requests. An indexed Admin/owner can read requests, transition `pending` to `approved` or `denied`, and delete a request. Admins cannot rewrite identity, note, timestamp, or add children through this candidate.

The emulator fixture accepts far-past and far-future nonnegative integer timestamps because no current-time window is part of the final policy. It rejects usernames above 32 characters and notes above 280 characters.

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

## Accepted aggregate compatibility evidence

The approved read-only production inventory aggregated 20 historical requests without retaining record content. It found 19 `approved` and 1 `denied`; username lengths 3–15; note lengths 0–37; 11 empty notes; 20 nonnegative integer timestamps; 20 exact four-field shapes; no unknown or nested children; and no candidate-policy violations. The aggregate report digest is `decbcac573b8bebdabc965b1914f89677343c7cf60358d09e8f0bd9cfb006fae`.

All observed records fit the final 2–32 username and 0–280 note policy. The note ceiling is a product ceiling with future room, not a claim about the historical maximum. Fifteen key timestamps equaled `requestedAt`; five payload timestamps followed their key by 1 ms–1 s. The client now eliminates that skew by capturing one timestamp, while Rules intentionally avoid brittle key parsing or a current-time window.

## Cached-client and Rules rollout

Production currently serves `.48`; cached clients can outlive the `.49` deployment. The safe order is:

1. Deploy the compatible `.49` client only.
2. Begin the exact 24-hour window when the served deployment manifest converges.
3. Keep production Rules unchanged throughout that window.
4. Re-run adversarial emulator tests against the exact candidate after the boundary.
5. Deploy only the reviewed `/requests` Rules diff under separate approval.
6. Read back Rules and monitor permission-denied/request-submission errors.
7. Roll back to the prior Rules immediately if a supported client or legitimate historical Admin transition is rejected.

Stop before Rules deployment on unknown historical fields/statuses/keys, unresolved bounds, cached-client mismatch, changed Admin transition semantics, emulator divergence, a new active Firebase path, or inability to observe rejection safely.

## SEC-05 boundary

SEC-02 handles exact schema validation, immutable request fields, key validation, least-privilege request authorization, and control-character rejection. Safe Admin DOM rendering remains the independent SEC-01 defense even when input validation succeeds.

Rate limiting/abuse controls, CSP/hosting headers, platform-wide request throttling, bot mitigation, and global monitoring are separate SEC-05 backlog. This candidate does not broaden into those systems.

## Known unrelated Rules debt

The future Global Rules emulator suite still has its pre-existing inactive `accounts` reference failure. The dedicated SEC-02 fixture does not import or alter that suite, production Rules, or any deploy configuration.
