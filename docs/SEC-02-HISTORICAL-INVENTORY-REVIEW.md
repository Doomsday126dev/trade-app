# SEC-02 Historical Inventory Review

Status: **NOT YET RUN AGAINST PRODUCTION**

This worksheet is for the separately approved, post-D2 aggregate-only inventory of `requests`. It must cite the deterministic report digest and must not contain raw usernames, notes, request IDs, credentials, or request-level rows.

## Evidence

- Inventory report digest:
- Tool commit SHA:
- Execution timestamp:
- Aggregate record count:
- Source database identifier:
- D2 completion evidence reviewed by:

## Username Policy

- Observed trimmed code-point maximum:
- Observed UTF-8 byte maximum:
- Chosen maximum:
- Reason:
- Historical exceptions and treatment:

## Note Policy

- Observed trimmed code-point maximum:
- Observed UTF-8 byte maximum:
- Chosen maximum:
- Reason:
- Historical exceptions and treatment:

## Timestamp Policy

- Observed numeric range:
- Key/payload skew findings:
- Future/impossible-value findings:
- Chosen skew policy:
- Reason:

## Schema Compatibility

- Historical field-set exceptions:
- Unknown-child treatment:
- Historical status treatment:
- Noncanonical key treatment:
- Candidate Rules changes needed:
- Would the current emulator-only Rules reject an observed legitimate shape?

## Cached Clients

- Legacy `.40` writer implications:
- Live `.46` writer implications:
- Compatibility window:
- Client-first rollout requirement:
- Monitoring and rollback criteria:

## Decision

- Human approvers:
- Approved policy:
- Remaining blockers:

The inventory supplies evidence only. It does not choose limits, alter the client contract, modify the emulator fixture, deploy Rules, or authorize production changes.
