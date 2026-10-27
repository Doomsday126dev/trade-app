# Favorites HTTP failure classification

The client previously parsed JSON before classifying HTTP failure. A non-JSON HTTP503 therefore became favorite/response-invalid, which the public-summary cache correctly treats as a non-retryable contract error. Infrastructure HTML/empty responses on HTTP500–599 now become favorite/unavailable and reach the existing one-fresh-read-per-favorite/cache-session policy. No new automatic request loop, concurrency change, extra retry allowance or network timeout was introduced.

Structured service codes, Retry-After, oversized-body limits, malformed HTTP200 identity validation, account fences and authentication remain unchanged. Malformed 4xx stays fail-closed. This patch creates no identity, metadata, publication or saved-account write and changes no backend configuration.

## Evidence and limits

Native .159 observation: six Favorites dates loaded and one unavailable. Read-only logs confirm POST503 at 2026-10-27T21:49:06.326936Z, revision resolvelegacyfavoriteidentities-00014-jip, latency0.397125543s, on the same instance as surrounding successful requests. The exact trace has one request log and no application exception. The service handler uses a20-second deadline, so that specific deadline did not explain this397ms failure. The handler deliberately does not log SDK errors, identities, tokens or bodies; several internal failures collapse into structured503. HTTP status alone cannot distinguish an infrastructure response from handler JSON or associate it with a particular Favorite.

The client correction is a separately reproduced defect, NOT a proven cause of this live incident. The retained client code/retry allowance/response type were not obtained because the native inspector view would expose credentials. No raw replay or broader account inspection was performed.

59 focused tests passed: HTTP classification, existing publication retry accounting, session identity batching and summary cache lifecycle. The fix does not resolve an already-exhausted retry allowance; that state has not been established for the observed row.
