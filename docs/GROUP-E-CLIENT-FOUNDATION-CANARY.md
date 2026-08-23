# Group E client-foundation canary

This source contract is inactive by default. It does not authorize a production run.

## Boundary

The canary is limited to synthetic D3 slots A and B and the existing
`readE1AccountFoundation` path. The client holds a validated result only in memory. Normal
startup, authentication, navigation, RTDB hydration, and session caches do not open or call
the canary controller. Provider-linking modules are not imported or reachable.

Production admission requires all of the following independent evidence:

- exact private A/B UID and reciprocal trainer hash bindings;
- schema-v2 same-page runtime evidence on the existing `pogo` app, including positive debug-token absence,
  ordered SDK/readiness/instance stages, and one discarded limited-use-token fingerprint per slot;
- a fresh 15-minute JIT record created after both same-runtime evidence records;
- a maximum 45-minute activation window;
- separately pinned Pages, gateway, authority, and tooling provenance;
- the accepted 32-document D3 closeout and restored gates;
- a private authority with the gateway as its only Invoker;
- every mutation gate disabled.

The Group E request body is exactly `{ "schemaVersion": 1, "attemptId": "<uuid-v4>" }`.
Normal reads retain `{ "schemaVersion": 1 }`, and Group C retains its own proof schema.

## Call budget

The execution operator creates one controller generation authorized only for A, reconciles its
exact gateway and authority log records, signs out, then creates a new B-only generation bound
to the A reconciliation digest. In exact Group E mode, the callable uses a fresh limited-use
App Check token and the gateway consumes it; normal and Group C reads remain standard-token
calls. Once a generation crosses the callable boundary it is terminal after success, timeout,
network failure, or malformed response. Clearing memory cannot re-arm it. The process-local
limiter is defense-in-depth telemetry only; it is explicitly not a globally authoritative
exact-once mechanism. The canary performs zero application, Firestore, or RTDB writes.

## Manual operator

The future live operator must use generated same-page-runtime scripts with no credentials or
tokens embedded or printed. Evidence and its replay ledger remain in independent ignored
mode-0600 files. The page
prints only a sanitized slot/attempt completion sentinel. Raw ID tokens and App Check tokens
are discarded in page memory, and a callable result is accepted only after authoritative log
reconciliation. There is no automatic retry and no resend after an ambiguous result.

The sequence is:

1. Collect fresh A and B same-runtime evidence while every gate is disabled.
2. Validate both evidence records, then start the 15-minute JIT clock.
3. Enable only gateway invocation and authority read. `CLIENT_FOUNDATION_USE_ENABLED` remains
   false because deployment does not arm a persistent browser flag; use requires a separately
   authorized explicit same-runtime controller generation.
4. Read A, reconcile, sign out, read B, reconcile.
5. Restore every gate using `RESTORE E1 GROUP E CLIENT FOUNDATION GATES`, even if JIT or the
   activation window has expired.
6. Verify the unchanged 32-document D3 digest, zero writes, IAM/privacy, and exact two gateway
   plus two authority execution calls.
7. Observe passively for at least 30 minutes after restoration, targeting closure by 60 minutes
   with a 15-minute scheduler/operator closeout grace. The observation must contain zero
   additional Group E calls. A write, anomaly, active gate, or unexpected call requires a
   separately reviewed longer response.

## Separate backlog

Event cards currently mix friendly localized date ranges with numeric date/time ranges.
That presentation issue is intentionally outside this Group E contract.
