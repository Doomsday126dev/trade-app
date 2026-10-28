# Isolated staging login release candidate

This follow-up to reviewed e576de927c34c8e3e5a9be227989db0e80027e2a supplies
previously missing deployable HTTP adapters and a separate canary browser host.
It does not change the live trade site, production provider settings or PIN.
All activation below remains pending specific approval. Secret setup is already
complete; do not repeat it or retrieve payloads for readiness checks.

## Implemented and locally qualified

- `functions/staging/authority.entry.cjs` wraps the existing private E1 handler.
  Disabled Discord returns the unchanged legacy handler. Enabled staging adds
  strict typed Discord routes, named UID/Discord-subject admission, App Check,
  and a bridge to the existing Google account read/create handlers. Google
  creation consumes a limited-use App Check proof.
- `functions/staging/gateway.entry.cjs` serves the isolated host and forwards
  typed requests to the exact private authority with service-to-service OIDC.
  Browser Firebase proof stays separate from gateway OIDC. Caller-supplied
  forwarding headers are discarded. Origin, payload size, routes and methods
  are restricted; bodies/tokens are not logged by these adapters.
- `js/dev/stagingLoginBootstrap.js` composes the reviewed auth commit/checkpoint
  guards, Discord continuation/registration/linking and Google foundation client.
  Explicit configuration is required; production origin is refused. Definite
  Google conflicts clear pending operations; ambiguous outcomes retain recovery.
- `staging/public/` is an auth canary exerciser, not the complete trade product.
  It mounts registration/link reviews and verified checkpoint recovery. It
  cannot establish product-wide profile/list/publication readiness by itself.
- The entry integration test crosses actual loopback public/private HTTP servers,
  the real candidate/E1 handlers, Firebase 12.14.0 Auth SDK and demo Firestore/Auth.
  Discord exchange, Google popup identity, App Check and Cloud Run IAM are
  synthetic seams: real provider consent, Cloud Run IAM and browser CSP/App Check
  still require scoped staging qualification. Callback query routing also has a
  real HTTP regression. No cloud data or secret values are used.

Build source contexts with `python3 scripts/staging/build-login-artifacts.py`.
The generated manifest pins every input and both deterministic tar hashes.
The disabled public config is intentionally unusable until scoped configuration
is approved. The gateway accepts `DISCORD_PUBLIC_CONFIG` as trusted public JSON
configuration, validates its exact staging origin/project/app/Enterprise key and
allowed public fields, and serves it with no-store. It rejects extra fields that
could accidentally publish secrets. Omission retains the disabled template;
activation requires two explicit canary UIDs. Each Secret Manager file must use
a separate mount directory: Cloud Run rejects different secrets sharing one. Docker is unavailable here: these are source contexts, not built
OCI images. Pin base-image and output-image digests during the approved build;
package lockfiles are already included. Do not deploy a floating image tag.

## Smallest proposed staging release scope (not executed)

Target project `trainer-hub-staging-37ib4wct`, region `us-central1`, named
Firestore database `phase-e-identity` only. Preserve all existing E1 environment
and gates except the explicitly reviewed canary changes.

1. Build and pin both images. Revise existing private `e1-identity-authority`
   (current baseline revision `00019-lgm`, origin
   `https://e1-identity-authority-xxxtepp45q-uc.a.run.app`). Use its existing
   `e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com`.
   Mount enabled version **1** of `discord-oauth-client-secret`,
   `discord-oauth-state-key-v1`, `discord-oauth-subject-key-v1` at respectively
   `/var/run/discord/client/value`, `/var/run/discord/state/value`,
   `/var/run/discord/subject/value`. No payload reads by the operator are required.
   Existing narrow secret/read/sign permissions are retained.
2. Create a staging-only public `discord-login-canary` Cloud Run service and
   dedicated `discord-login-canary-runtime` service account. Grant that identity
   invocation on the private authority only; public invocation belongs solely
   to the canary gateway. Gateway receives no secret or database access.
   Build/deploy identities need separately inspected minimal build, artifact,
   service update and service-account-use permissions: do not grant broad roles
   just to make a deploy command succeed. Reuse existing build infrastructure
   where its verified permissions suffice; no unrelated API enablement.
3. Google limited-use verification needs the existing authority runtime to have
   Firebase App Check Token Verifier permissions in this staging project.
   Inspect the current predefined role and choose the smallest supported binding
   before approval; this is additional to completed secret setup. See
   https://firebase.google.com/docs/app-check/custom-resource-backend .
4. Recommended bounded validation configuration: private authority retain
   0.5 CPU/512 MiB, max 2/min 0/concurrency 1; gateway 1 CPU/256 MiB,
   max 1/min 0/concurrency 1. Both request timeouts 30 seconds; relay timeout is
   25 seconds. This changes the observed authority 15-second timeout and must be
   included in deployment approval. A fixed-count runner stops on unexpected
   results. Instance/request limits are not monetary spending caps.
5. Obtain the gateway's actual verified HTTPS origin before changing provider
   configuration. Add exactly `<verified gateway origin>/auth/discord.html` to
   Discord application **1564289039526268938**, PoGo Trades Staging, personal
   doomsday126 ownership. Preserve the existing GitHub Pages redirect. Scope is
   `identify` only: no email, bot or guild access. Add the verified hostname to
   staging Firebase Google authorized domains and reCAPTCHA/App Check settings
   only if not already present, under explicit provider-security approval.
6. Before real OAuth, exclude/redact the gateway callback's authorization-query
   URL from automatic request logs. Cloud Run request logs can otherwise retain
   the code before application code scrubs it. Review a route-specific logging
   exclusion, not a blanket diagnostic disable; this monitoring change needs
   approval. Keep ordinary failure diagnostics, never token/body logging.
7. Supply verified public staging Firebase web/App Check metadata, named existing
   canary UID, fresh Google canary UID and approved Discord subject IDs. Personal
   app ownership does not identify consenting canaries. Existing canary needs
   reciprocal legacy mapping and working PIN fallback. No identities were
   invented or linked. Set exact origin and only reviewed capability flags;
   the checked-in config remains disabled. Real OAuth grant/link consent is a
   separate action-time choice after this deployment scope is approved.

## Data and support decisions before canary activation

Account creation requires a fresh, reviewed legacy namespace inventory and
certification using the existing protection contract. Synthetic zero-inventory
fixtures are not a staging certificate. Any staging provisioning freeze/backfill
must be explicitly scoped and approved; never infer production coverage. New
UIDs and handles must not collide with existing PIN accounts. Linking preserves
the original UID, lists, URLs and permissions; no email merge is introduced.

Recommended delayed bootstrap policy is fail closed: if first Auth activation
falls outside the five-minute claim window, preserve the existing claimed UID
and receipt for reviewed support. A token minted in-window can be accepted by
Firebase later while activation readback fails. Do not promise unconditional
recovery, reset a claim, automatically extend expiry, mint replacements or make
a second account. Agree on an operator support procedure before wider signup.

The mounted checkpoint UI uses actual current-Auth verification; its browser
network/IAM behavior must be qualified at the new staging origin. It never
blindly clears a pending checkpoint. Cross-UID restore remains demo-only;
source-account-inaccessible recovery remains a policy gap. Neither blocks safe
linking/new-signup canaries, but both block claiming PIN retirement readiness.
Full-product profile, preferences, list hydration, permissions and publication
acceptance remain separate staging checks after the auth exerciser passes.

## Cost, rollback and release boundary

New gateway invocations/builds/artifact storage, authority/database operations,
App Check, secret versions/access, logs and egress may be metered. Previously
estimated $0.18/month for three secret versions and about $0.03 direct validation
usage are illustrations before allowances, not an all-in cap. No new cost
control, billing change or paid resource has been executed by this code task.
TTL cleanup is optional, paid, and not needed for logical expiry; do not include
TTL on mappings, registration claims, tombstones or durable receipts.

Rollback: turn off candidate public config/traffic, revert private authority
traffic to inspected baseline revision `00019-lgm`, retain receipts/mappings and
secret versions. Do not delete accounts or rotate keys as a rollout undo.
No production merge/deployment, real linkage, PIN cutoff or forced migration is
part of this scope. Independent focused review plus pinned image/build and the
configuration approvals above precede any live staging test.
