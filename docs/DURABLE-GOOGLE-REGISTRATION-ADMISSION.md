# Durable existing-namespace admission candidate

This branch is source preparation stacked on PR #97. It changes no production
resource. Google-only account creation, provider-public writes, and the durable
admission mode remain disabled in deployable defaults. The existing bounded
freeze/certification path and existing-account Google/PIN login are unchanged.

## Admission boundary

`CREATE_PROVIDER_ACCOUNT_ENABLED` and `DURABLE_PROVIDER_ADMISSION_ENABLED` must
both be explicitly true before the authority route can use the durable path.
The authority runtime also pins `DURABLE_ADMISSION_GENERATION_ID` and the
operator public key; replaying an older signed pointer after supersession cannot
activate it under a runtime pinned to the new generation. A pin does not reject
a restored, still-valid signed pointer for the same generation.
The route still derives the UID from a verified Firebase ID token and checks a
fresh, linked Google subject. The same Firestore transaction reads the signed
`authorityConfig/durableProviderAdmission` active pointer, its sealed
`protectedNamespaceGenerations/{generationId}` record, and the account, handle,
provider, subject, and request documents. The operator signature binds the
generation digest, permanent policy digest, writer-closure evidence digest,
generation ID, and activation state. Missing, stale, invalidated, superseded,
malformed, or unsigned evidence denies new creation. An exact prior request can
still replay after invalidation, but it must reconcile to all five original
documents; a new request cannot bypass the gate. Firestore retries a transaction
that races a control-document change.

Only a separately authorized operator holding the offline Ed25519 private key
may sign an active generation. The signature authenticates the specified
generation and activation fields; it supplies no independent freshness or
anti-replay clock. The runtime receives only the pinned public key.
The registration client has no write access to the Firestore identity database;
its Rules remain deny-all. Operator establishment and supersession use a new
signed pointer. Invalidation changes or removes the pointer and blocks new
creation while the reviewed runtime and configuration remain intact. Firestore
IAM create/get/update permissions are scoped to the identity database, not to
individual admission or held-claim documents. The authority runtime can update
those documents using its Admin SDK credentials; deny-all client Rules do not
restrict it. IAM can exclude other application principals and impersonators,
but it cannot prevent a compromised authority runtime from altering held claims
or restoring an old pointer. That restriction depends on independently reviewed
authority code, exact serving image/configuration readback, and no unreviewed
deploy or runtime impersonation. Resilience to authority-runtime compromise
would require a different control plane or monotonic revocation anchor.

Before invalidating an active pointer, all reachable creation routes must be
read back with creation disabled and a never-reused replacement generation pin;
`verifyRevocationBarrier` rejects an incomplete route set. Re-enable creation
only with a newly reviewed generation. The old pointer then fails the pin check
in reviewed code even if its document is restored. This is a future operator
procedure, not a live IAM qualification or a current deployment.

## Permanent legacy closure and name protection

`scripts/build-permanent-legacy-allocation-candidate.cjs` emits an undeployed
RTDB Rules candidate and a pinned policy digest. The candidate denies new
`users/{username}`, `loginDirectory/{username}`, and `authIndex/{uid}` bindings,
request approval, deletions, and identity-changing repairs. Existing records
retain same-UID profile and PIN-version updates. This enforces old-client and
admin UI writes at Rules, regardless of a visible button or client-side check.
An old client can still ask Firebase Auth to create an Auth-only record before
Rules deny its app binding. The synthetic signed-out Google flow confirms that
an unmapped UID receives no existing app-account resolution or protected name.
It also reproduces a concrete interference path: the Google credential stays
allocated to the Auth-only UID, so a later `linkWithPopup` from a legitimate
PIN account fails `auth/credential-already-in-use`. This fails the proposed
orphan-tolerance condition. Cutover needs an explicit, reviewed credential
collision/recovery decision that preserves legitimate login and PIN recovery.
This candidate neither blocks Auth globally nor deletes/cleans up accounts.
Synthetic tests do not prove every stale provisioning or repair path is
isolated; those remain part of the preflight inventory.

`scripts/plan-protected-legacy-namespace.cjs` accepts synthetic fixtures only.
Its pure planner requires complete users, loginDirectory, authIndex, alias, and
canonical-claim source sets. It uses the reviewed v1 normalization, preserves
only reciprocal canonical account/handle claims, emits create-only holds for
unclaimed names, and refuses conflicting claims. A collision never chooses an
owner; a held name conveys no authentication or account. Exact key and document
readback, not matching counts, is required before a generation can be sealed.
Hold records deliberately omit the directory sort field, so directory listing
skips them; direct public identity lookup returns unavailable for a valid hold.
Invalid legacy strings are recorded separately because the new registration
normalizer rejects them; a future private inventory must review that list.
The fixture inventory is synthetic. Historical aggregate inventories cannot
qualify a production generation.

The privileged-writer verifier checks the exact permanent Rules digest, project
roles and permissions, service-account impersonation grants, drained operations,
and quiesced provisioning scripts. The former four-service inventory was
insufficient: the expected serving set now includes the reset function, the
authority service, and six gateway exports (foundation read, reserve, public
share read, directory list, favorite identity resolution, and provider-account
creation). It also tracks authority builder/deployer principals, service-account
policy bindings, and every reachable route. Future live readback must enumerate
all allocation, deployment, and impersonation paths; a missing inventory is
not proof of absence. Each serving revision needs 100% traffic and the
independently reviewed image digest, source fingerprint, environment, account,
and route set. A synthetic negative with a correct service account and matching
ready/serving names but an unreviewed writer-enabled image is rejected. The
approved review digest must be pinned by a separate review, not computed from
the live inventory under test. Readback references and digests are traceable
inputs, but synthetic fixtures and caller-supplied readbacks are not production
closure proof. Live provenance and completeness remain preflight inputs.
That inventory must prove application principals lack Firebase Auth create/import,
RTDB privileged writes, identity database delete, service-account impersonation,
and Rules/IAM/deployment modification.
The authority's scoped Firestore create/get/update role still supports the
reviewed atomic transaction; unrelated mutation gates must remain false while
provider creation is on. Project-owner break-glass power cannot be neutralized
by application Rules; it is an operator control and must be recorded separately.

## Finite transition and recovery

The resumable stage checker consumes Rules/freeze readbacks, empty operation
ledgers, exact protection readback, a reverified writer-closure receipt, sealed
generation, signed control, and runtime configuration digest. Caller-supplied
`complete` booleans alone cannot advance a stage. It requires, in order: block competing writes with the
bounded fence; account for in-flight allocations by readback, never by timeout;
protect and exactly verify the complete name set; read back permanent Rules,
IAM and serving revisions; seal the generation; invalidate and drain temporary
admission; activate the signed durable pointer and qualified runtime gate; then
end the temporary fence while proving the permanent Rules still deny old
allocation. Each stage must re-read the active temporary fence until permanent
closure is verified, then re-read the exact permanent Rules and privileged
writer closure at every subsequent stage. RTDB, IAM, and Firestore are separate systems. The signed control
record attests the completed cross-system transition; a Firestore transaction
does not make those external changes atomic. An interruption leaves creation
disabled until the relevant stage is requalified.

Before the first provider-only account, creation can be disabled and the
pre-provider compatibility floor retained. After one exists, disable further
creation but retain provider-account reads, Google/PIN existing-account entry,
required provider-subject keys, provider-public read support, and permanent
legacy writer closure. Never delete accounts, unlink credentials, or restore an
older runtime/Rules state that strands an existing provider-only account.

## Separate production approval package

The future approval must identify the exact PR #97 and prerequisite heads,
runtime/source manifest and Rules hashes, Ed25519 public-key fingerprint,
private-key custodian, full current private namespace inventory and exact
name/claim digests, alias and invalid-name review, live IAM/service-account and
serving-revision readback, in-flight operation ledger, protection-only hold
plan/readback, signed generation, gate values, same-UID/PIN/product-state
canary plan, monitoring and stop criteria, and both rollback plans. It must
explicitly authorize each live Rules/IAM/write/deploy step. No production
inventory, hold, account mutation, Rules/IAM change, or deployment is performed
by this branch.

The private first-mutation harness contract is unchanged by this branch.
`functions/test/e1-production-first-mutation-guard.test.cjs` contains the
private-harness test; this checkout lacks
`functions/.local/e1-group-d-reserve-console.js`, so that subtest is unavailable
locally. Synthetic admission tests do not substitute for live IAM/OAuth
qualification or the private harness.
