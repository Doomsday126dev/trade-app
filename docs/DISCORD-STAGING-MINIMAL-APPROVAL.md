# Minimal staging setup approval package

Prepared 2026-10-28. No setup action below was executed by this milestone.
Implementation approval does not authorize these configuration changes.

## Existing targets

- Project: trainer-hub-staging-37ib4wct, region us-central1; private Firestore
  database phase-e-identity. Billing is already enabled by the owner.
- Existing private service: e1-identity-authority, observed revision 00019-lgm,
  https://e1-identity-authority-xxxtepp45q-uc.a.run.app.
- Existing runtime/signing identity:
  e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com.
- Personal Discord owner doomsday126; existing app PoGo Trades Staging,
  ID 1564289039526268938. Registered redirect:
  https://doomsday126dev.github.io/trade-app/auth/discord.html.
  No new app, bot, guild membership or email scope is proposed.

## Required before a live staging canary, individually approval-gated

1. Enable Secret Manager API in the staging project. IAM Credentials API was
   already enabled at the latest read-only check; no additional enablement is
   requested for it.
2. Provision only these secrets and private runtime injection:
   - discord-oauth-client-secret: existing application's confidential code exchange.
   - discord-oauth-state-key-v1: independent HMAC key for state/browser bindings.
   - discord-oauth-subject-key-v1: independent persistent subject-key derivation.
   Keep the subject-key version for as long as mappings depend on it. No secret
   value should pass through chat, Git, screenshots or Pages.
3. Grant only secretmanager.versions.access on those three secret resources to
   the named runtime, firebaseauth.users.get at the staging project for current
   user/revocation checks, and iam.serviceAccounts.signBlob on that same named
   signing identity. Prefer a narrow custom permission binding rather than broad
   Token Creator or Auth Admin roles. No user update/delete, service-account key,
   service-account creation or extra runtime is requested.
4. After independent source review and remaining host qualification, approve a
   specific staging gateway/authority/callback release and capability flags.
   Production activation is a separate request. Namespace protection requires a
   fresh reviewed inventory/certification; no production freeze/backfill or rules
   change is included in this package. The existing all-auth-entry-point gate
   and first-sign-in token-minter composition must be qualified before release.
5. Select dedicated canaries: one existing Firebase UID with reciprocal account
   and trainer handle plus working PIN fallback; one fresh signup test identity;
   and the exact Discord test user for each. Approve identify-only OAuth consent
   and persistent linkage for those named identities at action time. Personal
   application ownership does not select the canary identities. Never request
   credentials or secrets in chat.

## Costs and optional cleanup

Secret versions/access and existing runtime/database usage are metered. Three
new versions may fit shared billing-account free allowances, but available
allowance and a zero bill are not guaranteed. No hard spending cap is implied.
See https://cloud.google.com/secret-manager/pricing and
https://cloud.google.com/run/pricing. No additional paid service is proposed.

TTL is optional cleanup, not a prerequisite for logical expiry. A later scoped
request could set deleteAfter TTL on discordOAuthFlows, discordLinkReviews,
discordRegistrationReviews and discordRateLimits in phase-e-identity. TTL deletes
are billed: https://firebase.google.com/docs/firestore/ttl. Do not TTL canonical
mappings, unlink tombstones, operation/import receipts or consumed transfer
proofs. Recovery transfers/imports remain demo-only and are not staging setup.

No owner input is needed to continue the remaining local integration. This is a
review package, not a request to perform all steps under blanket authorization.
