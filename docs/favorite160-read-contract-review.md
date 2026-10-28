# .160 client HTTP failure source registration

Runtime 76c4abd76d636ef09cd75dde406fb2557d2da470 is based on live .159. Only Favorites client HTTP parsing, two focused test files, evidence documentation and standard release stamping change. Non-JSON5xx becomes the existing favorite/unavailable code; no retry allowance, concurrency, timeout, private reads or backend writes change. Structured errors and malformed successful identity responses remain fail-closed. The normal observer re-entry test recovers on503 then200 and stops at two physical requests on repeated failure.

Exact runtime registers under unchanged CATALOGUE_ID_SOURCE_CALL_CONTRACT:24 owner-scoped read sites, handler hashes, UID/session guards, permissions and budgets retained. Archive positive/negative source checks cover the new registration. No catalogue/artwork, auth, billing, IAM or data migration change. Existing maintenance expiry and evidence remain unchanged.

The production503 root cause remains unknown; this separately proven client defect is not represented as the confirmed incident cause. Required existing hosted qualification remains in place; no tests, thresholds or timeout protections removed.
