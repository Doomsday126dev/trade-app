# Group E client-foundation canary

This source contract is inactive by default. It does not authorize a production run.

## Boundary

The canary is limited to synthetic D3 slots A and B and the existing
`readE1AccountFoundation` path. The client holds a validated result only in memory. Normal
startup, authentication, navigation, RTDB hydration, and session caches do not open or call
the canary controller. Provider-linking modules are not imported or reachable.

Production admission requires all of the following independent evidence:

- exact private A/B UID and reciprocal trainer hash bindings;
- Firebase Auth and App Check on the existing `pogo` app;
- a fresh 15-minute JIT record created after both same-runtime evidence records;
- a maximum 45-minute activation window;
- separately pinned Pages, gateway, authority, and tooling provenance;
- the accepted 32-document D3 closeout and restored gates;
- a private authority with the gateway as its only Invoker;
- every mutation gate disabled.

The Group E request body is exactly `{ "schemaVersion": 1, "attemptId": "<uuid-v4>" }`.
Normal reads retain `{ "schemaVersion": 1 }`, and Group C retains its own proof schema.

## Call budget

The execution operator permits one A read, reconciles its exact gateway and authority log
records, signs out, then permits one B read and reconciles again. Any extra or ambiguous call
is a containment condition. The process-local limiter is defense-in-depth telemetry only; it
is explicitly not a globally authoritative exact-once mechanism. The canary performs zero
application, Firestore, or RTDB writes.

## Manual operator

The future live operator must use generated same-page-runtime scripts with no credentials or
tokens embedded or printed. Evidence assembly remains in ignored mode-0600 files. The page
prints only a sanitized slot/attempt completion sentinel. Raw ID tokens and App Check tokens
are discarded in page memory, and a callable result is accepted only after authoritative log
reconciliation. There is no automatic retry and no resend after an ambiguous result.

The sequence is:

1. Collect fresh A and B same-runtime evidence while every gate is disabled.
2. Validate both evidence records, then start the 15-minute JIT clock.
3. Enable only client-foundation use, gateway invocation, and authority read.
4. Read A, reconcile, sign out, read B, reconcile.
5. Restore every gate using `RESTORE E1 GROUP E CLIENT FOUNDATION GATES`, even if JIT or the
   activation window has expired.
6. Verify the unchanged 32-document D3 digest, zero writes, IAM/privacy, and exact 2+2 logs.
7. Observe passively for 30–60 minutes after restoration. A write, anomaly, or active gate
   requires a separately reviewed longer response.

## Separate backlog

Event cards currently mix friendly localized date ranges with numeric date/time ranges.
That presentation issue is intentionally outside this Group E contract.
