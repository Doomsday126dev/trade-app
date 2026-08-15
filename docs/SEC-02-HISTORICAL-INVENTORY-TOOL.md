# SEC-02 Historical Inventory Tool

Status: local tooling only. **No production inventory has completed successfully.** One separately approved read attempt returned HTTP `401`; it produced no report or raw-data output. Any additional attempt requires separate human approval.

## Boundary

`scripts/sec02/request-inventory.cjs` is a pure aggregate engine. `scripts/sec02/inventory-request-access.cjs` is the only reader. It accepts fixture mode before D2, but production mode requires all of the following:

- `--production-aggregate-inventory`
- exact normalized confirmation `READ SEC02 REQUEST AGGREGATES AFTER D2`
- wall-clock time at or after the D2 boundary
- exact origin `https://trade-list-a4297-default-rtdb.firebaseio.com`
- an externally supplied short-lived Firebase Auth ID token
- an exact 40-character tool commit SHA

The production reader constructs only `GET https://trade-list-a4297-default-rtdb.firebaseio.com/requests.json` and adds the Firebase ID token through a programmatically encoded `auth` query parameter. The credential-bearing query string is never logged, reported, or preserved. The reader refuses redirects, uses a 15-second timeout, enforces a 10 MiB streaming ceiling even without `Content-Length`, performs no retries, and sanitizes all errors. It contains no Firebase SDK, Admin SDK, OAuth access-token support, mutation API, configurable path, or arbitrary URL support. It never reads `users`, `authIndex`, `publicShares`, E.1, or another RTDB root.

RTDB returns the selected subtree as one JSON snapshot, so the tool cannot paginate server-side. The streaming byte ceiling and 100,000-record post-parse ceiling fail closed rather than allowing unbounded processing. Invalid, partial, malformed, denied, or oversized responses produce no compatibility conclusion and cannot overwrite a prior successful report.

## Authentication Recommendation

For a separately approved run, use a short-lived Firebase Auth ID token for an exact reviewed operator identity whose existing RTDB Rules permit the required `requests` read. Supply it only through `SEC02_RTDB_ID_TOKEN`; the reader sends it as `auth=<ID_TOKEN>`, the Firebase-documented user-token mechanism. This preserves Rules evaluation and avoids Admin SDK/database-admin bypass, Google OAuth2 access tokens, static credentials, IAM changes, or credential files. The token must be obtained and approved outside this tool and discarded after the run.

A structurally valid token for the correct project is not proof that the operator has Rules authorization. The tool locally checks token structure and claims (algorithm, audience, issuer, subject, and expiration) but does not verify the signature cryptographically. Firebase documents HTTP `401` for both invalid or expired credentials and Security Rules violations, so `SEC02_AUTH_OR_RULES_REJECTED` deliberately does not claim which condition caused rejection. See [Authenticate REST Requests](https://firebase.google.com/docs/database/rest/auth) and the [Realtime Database REST API error conditions](https://firebase.google.com/docs/reference/rest/database/#section-error-conditions).

Current Rules may grant that Firebase user access beyond `requests`; the tool cannot narrow that existing Rules identity to one JSON path. The operational containment is therefore: exact host and hard-coded `requests.json` in the tool, short token lifetime, isolated invocation, no shell tracing, no redirects, aggregate-only output, and post-run token disposal. Creating a dedicated narrower identity or changing Rules would be a separate reviewed operation, not part of this candidate.

## Privacy And Evidence

Raw request keys, usernames, notes, and request-level rows are transient input only. They never enter stdout, reports, audit metadata, errors, or digests. Username/note hashes are deliberately absent. Field-set reports contain field names only; unknown-child reports contain child names and aggregate counts only. Status labels are allowed categorical product metadata.

Small-cell suppression is not applied because exact schema counts are needed to determine whether a Rules shape would reject historical records. The output remains non-record-level and contains no raw or pseudonymous content. Lengths use deterministic inventory-only buckets: `0`, `1`, `2-8`, `9-16`, `17-32`, `33-64`, `65-128`, `129-280`, `281-512`, `513-1024`, and `>1024`. These are evidence buckets, not approved limits.

The deterministic aggregate report covers key families, suffix lengths, field shapes, missing/unknown/nested children, text types and lengths, Unicode/control indicators, timestamp types/ranges/skew buckets, status counts, and `.40`/`.46`/candidate-Rules compatibility. It never chooses a username maximum, note maximum, or timestamp-skew policy.

## Output And Audit

A successful production run writes one mode-`0600` deterministic envelope to ignored path `functions/.local/sec02-request-inventory-report.json`. The report digest is SHA-256 over sorted, two-space-indented JSON plus one trailing newline. Runtime metadata is isolated under `audit`: execution time, source database identifier and path, tool version/commit, record count, success, confirmation acknowledgement, and report digest. Failed reads emit only a stable error code and do not replace the prior successful report. Network exceptions, including exceptions that embed the credential-bearing URL, are reduced to stable non-secret codes; failed authorization bodies are not read for diagnostics.

Human policy selection belongs in `docs/SEC-02-HISTORICAL-INVENTORY-REVIEW.md`. Findings must be compared with both the cached `.40` writer and live `.46` writer, then used to review the emulator-only Rules candidate. Neither the report nor the worksheet modifies client validation or Rules.

Safe local command:

```sh
npm run sec02:inventory:fixture
```

The production-named command remains unusable without every post-D2 gate and must not be run without separate approval.
