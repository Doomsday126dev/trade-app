# Durable Authentication Readiness

Status: E.2 provider-link contract only. The contract and deterministic in-memory adapter are local source scaffolding. No provider, client action, callable, authority route, Rules change, Firebase adapter, OAuth exchange, token issuer, or migration is enabled.

## Identity invariants

- The existing Firebase UID remains the immutable account authority. Linking a provider cannot create, replace, merge, or move an account.
- The existing E.1 account foundation, trainer-handle claim, reciprocal legacy ownership, lists, public shares, preferences, and Admin state must remain unchanged.
- Provider display name, email, subject, trainer handle, legacy profile data, and public-share content grant no authority.
- The ordinary request may contain only `schemaVersion`, a fixed admitted provider, and a bounded request ID. UID and verified provider identity come from trusted server boundaries.
- Provider collisions, contradictory account state, missing or disabled accounts, stale evidence, and exact-request mismatches fail closed without partial provider-link state.

## E.1 authority schema

The E.2 contract extends the existing private `phase-e-identity` model rather than creating parallel RTDB roots:

```text
accounts/{uid}/providers/{provider}
  schemaVersion, provider, providerId, providerSubjectKey, state,
  linkedAt, updatedAt, revision

providerSubjects/{providerAndSubjectHash}
  schemaVersion, uid, provider, providerId, providerSubjectKey,
  linkedAt, revision

operationRequests/{uid}/requests/{requestId}
  schemaVersion, operation, fingerprint, status, timestamps, redacted result
```

The UID-owned provider document, global reverse claim, and operation evidence are one authority transaction. Exact replay returns the recorded redacted result and writes nothing. Reusing a request ID with different verified evidence fails with a replay mismatch. A new request for an already-consistent link records `already_linked`; inconsistent one-sided state is never silently repaired.

Provider-subject keys use a versioned, keyed, domain-separated digest of the fixed provider ID and verified subject. Raw provider subjects, emails, OAuth codes, access tokens, refresh tokens, and client secrets are not durable fields, logs, results, or client-readable data.

The local in-memory adapter models these exact ownership and transaction boundaries for adversarial tests. It has no arbitrary path, bulk, provider-exchange, or token-issuing method. A production Firestore adapter remains future work.

## Trusted evidence boundary

The contract accepts `google` and can represent future `discord` evidence. It does not perform either provider flow.

- Google is the first admitted contract provider. A future trusted integration must observe `google.com` on the already-authenticated Firebase user and prove the same UID.
- Discord is schema-representable as `discord.com`, but its web OAuth design is deferred. A later provider-specific implementation must use OAuth `state` and a server-side authorization-code exchange; PKCE cannot be required unless official Discord web documentation and a local protocol proof establish support for the selected flow.
- Email link is unsupported and deferred. Firebase identifies both email/password and email-link authentication with provider ID `password`, so E.2 cannot safely model them as two independent provider links without a separately reviewed UID- and PIN-preserving credential-conversion proof and rollback contract.
- Missing, unknown, stale, future-dated, cross-UID, or wrong-provider evidence fails closed.

The current source-only boundary still requires authenticated UID, App Check, recent authentication, an explicit disabled-by-default E.2 operation gate, and fresh trusted evidence. Those checks do not authorize a deployment or activation.

## Existing and new users

Provider evidence for an existing account may only add the two E.2 link records and exact idempotency evidence. It may not modify the account foundation or product data.

Provider authentication for an unknown UID creates nothing. New-user onboarding, explicit handle reservation, account initialization, provider unlink, recovery, provider-first login, custom-token issuance, and email migration are separate future designs.

## Client and deployment boundary

The current Account & Security UI remains informational and disabled. No link, unlink, recovery, migration, or provider-login control is added. Existing Group E authorizes only client-foundation activation and does not authorize E.2 provider linking. Current Rules remain unchanged and deny client access to authority data. Existing Functions and authority exports are unchanged; `linkVerifiedProvider` is not a callable or authority route.

Operator-only recovery state is outside this contract. No collision can invoke recovery, unlink, merge, transfer, deletion, or reassignment automatically.

Feature-branch source publication does not activate the contract. A later production path would require, at minimum, separate review of the Firestore adapter, provider verification, rate limiting, observability, reconciliation, IAM, gateway/App Check boundary, client UX, rollout guard, and rollback.

## Threat and test contract

| Threat | Required behavior |
| --- | --- |
| Client chooses UID or subject | Exact request schema rejects identity, subject, token, code, email, and handle fields |
| Provider subject linked elsewhere | One atomic global claim winner; all losers have no provider-link writes |
| Account already linked differently | Conflict; no overwrite, merge, or repair |
| Missing/disabled account or broken ownership | Fail before provider-link writes |
| Interrupted/partial prior state | Fail closed; future recovery is separate |
| Request replay | Exact replay is write-free; changed replay is rejected |
| Forged or stale evidence | Evidence must be fresh and bound to exact UID and provider by the trusted boundary |
| Raw credential disclosure | No raw subject, code, token, email, or secret in durable state or result |
| Provider success for unknown user | No account, handle, list, share, preference, or Admin initialization |

The focused contract suite covers Google success, Discord representability, account-foundation preservation, atomicity, collision races, exact replay, changed replay, partial-state rejection, stale and contradictory evidence, domain separation, redaction, and absence of generic or deployed surfaces.
