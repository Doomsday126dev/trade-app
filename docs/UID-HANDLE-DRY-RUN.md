# UID/Handle Reconciliation Dry Run

This tool is a local, read-only migration analysis. It does not reserve a
trainer handle, approve a mapping, create a Firebase update, or establish
consent to publish a profile. Every report record has `seedEligible: false`.

## Identity sources

The four permitted Realtime Database sources are fixed:

- `loginDirectory`: current login-discoverability and `authReady` metadata.
- `users`: legacy username records and their existing `authUid` bindings.
- `authIndex`: the reverse UID-to-username mapping used by login.
- `admins`: protected UID authority; matching records always require manual
  review and are never automatically ready.

Firebase Authentication is a separate sanitized local input. The CLI does not
use the Admin SDK and does not accept service-account credentials. The schema
is:

```json
{
  "schemaVersion": 1,
  "identities": [
    {
      "uid": "synthetic-uid-a",
      "disabled": false,
      "emailVerified": false,
      "providers": ["password"],
      "expectedSyntheticEmailMatches": true
    }
  ]
}
```

Only those five identity fields are accepted. Raw email addresses, tokens,
provider account payloads, and credentials are rejected. For a production read,
the sanitized Auth file must live under the git-ignored
`.local/uid-handle-audits/` directory.

The earlier documentation count of 44 names cannot be reproduced from a
checked-in snapshot or executable audit and is treated as an unverified stale
or broader manual count. The verified production audit read exactly
`loginDirectory` and found 35 names. This reconciliation deliberately reports
the independent counts and set differences among all four sources; it does not
interpret their difference as nine deletions or assume every legacy `users`
record should become public.

## Classification contract

Each record receives exactly one primary classification. Precedence is fixed:

1. `duplicate_or_conflicting`
2. `inconsistent_username_uid`
3. `missing_uid_binding`
4. `legacy_or_inactive`
5. `manual_review`
6. `ready_for_mapping`

`ready_for_mapping` requires exact corroboration from `loginDirectory`,
`users`, `authIndex`, and the sanitized Auth input. Missing/incomplete Auth,
disabled identities, `authReady: false`, malformed records, illegal Firebase
keys, trim/NFKC transformations, or protected authority prevent readiness.
Existing community membership, public shares, lists, inventory, and old profile
publication are intentionally not read and never imply publication consent.

Reason codes and classifications are locale-independent domain identifiers.
Human-readable CLI output is separate and aggregate-only.

## Private report

Reports are confined to `.local/uid-handle-audits/`, written with mode `0600`,
and contain source snapshot hashes, source counts, the normalization contract,
tool/schema versions, deterministic classifications, and a staleness warning.
Private record identifiers use a report-specific secret that is not persisted,
so identifiers cannot be correlated across reports or guessed from a trainer
name or UID. Raw authentication email is never stored.

The detailed report contains private identity facts and must not be copied into
tracked documentation. Console output contains aggregate counts only.

## Local conflict review

`npm run review:uid-handles -- ...` is a separate, local-only evidence
organizer for an existing reconciliation report. It accepts only local fixture
inputs or files confined to `.local/uid-handle-audits/`; it has no production,
network, token, credential, Admin SDK, or Firebase write mode. The four-source
RTDB snapshot is rejected if it contains any root other than
`loginDirectory`, `users`, `authIndex`, and `admins`.

The private review artifact records the source-report SHA-256, recomputed
source hashes, and a staleness warning. A mismatch marks the artifact stale and
explicitly unsuitable for decisions. Each record remains `seedEligible:false`
and `reviewDecision:unreviewed`. Suggested dispositions are stable review
labels only: `passive_login`, `conflict_review`, `protected_review`,
`legacy_hold`, `unassociated_hold`, and `no_action`.

For private review, the artifact may show trainer names and candidate UIDs plus
allowlisted evidence: UID-bound user records, username-to-UID index rows,
sanitized Auth presence/disabled/verification/provider facts, protected-admin
membership, and non-secret account-history timestamps. It never stores raw
Auth email, password material, provider payloads, or credentials. Email
prefixes, Firebase display names, lists, public shares, communities, profile
privilege flags, and similar names are explicitly non-authoritative. The tool
does not choose a winning UID or create an approval manifest, reservation,
migration payload, Firebase update object, rollback write plan, or executable
command.

Production review generation requires a separately approved fresh read because
the raw production snapshots are intentionally not retained after the original
audit. The current milestone adds and tests the offline workflow only; it does
not perform that read or create a production review artifact.

After a separately approved collection places all three inputs under the
private directory, the local-only command shape is:

```sh
npm run review:uid-handles -- \
  --source private \
  --report .local/uid-handle-audits/reports/RECONCILIATION.json \
  --rtdb-input .local/uid-handle-audits/inputs/RTDB-SNAPSHOT.json \
  --auth-input .local/uid-handle-audits/inputs/firebase-auth.sanitized.json \
  --output .local/uid-handle-audits/reviews/IDENTITY-REVIEW.json
```

The placeholders are local filenames, not Firebase paths or credentials. The
command performs filesystem reads and one private artifact write only.

## Running safely

The default command uses synthetic fixtures only:

```sh
npm run audit:uid-handles
```

Production mode requires an explicit production-read flag, exact project and
database confirmations, an HTTPS database URL matching those identifiers, a
token supplied only through an environment variable, and a sanitized Auth file
inside the private directory. The adapter performs exactly four `GET` requests
and exposes no write method.

The report becomes stale as soon as any source changes. A later, separately
approved seeding tool must re-read and revalidate every approved mapping after
narrow-read privacy rules are live. This report is evidence for review, never
permanent authority and never an executable seed manifest.

## Explicit exclusions

- No Firebase writes, reservations, renames, migrations, rules changes, or
  production client wiring.
- No approval manifest, Firebase update object, rollback write plan, or seed
  command.
- No inference of public-profile consent.
- No production seed before authenticated root reads are removed and private
  path isolation is verified.
- No automatic ownership decision or owner-side bulk repair for missing
  `authIndex` records.
