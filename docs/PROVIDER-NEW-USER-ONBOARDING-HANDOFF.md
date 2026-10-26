# New-user provider onboarding handoff

Read-only review on 2026-10-26 against PR173 base candidate
`e3c7aa7f331ea5227887f0819ca3be7687eeae61` and public release `.148`.
This document is a proposed implementation contract, not activation approval.

## Verified availability

- Public HTML enables Google entry and existing-account linking. New app-account
  creation defaults off. No real Google sign-in was performed in this review, so
  visible configuration is not fresh end-to-end service qualification.
- Google popup authentication resolves the canonical account, then reciprocal
  legacy UID/username ownership when appropriate. An existing PIN account on the
  same UID opens that account; it must never enter new-account creation.
- A new Google Firebase identity is not yet a trade-app account. With creation
  disabled, the current host rejects onboarding and signs out the unresolved
  identity; it does not delete the Firebase identity.
- Discord is hidden/unavailable publicly. The PR prototype signs in previously
  mapped identities and supports reviewed same-UID linking. An unknown subject
  returns `onboarding-required` without a Firebase UID, account or registration
  continuation. It cannot yet drive the Google creation endpoint.
- Google uses popup authentication; redirect is explicitly disabled. Discord's
  callback candidate and default-off host wiring are not a live signup flow.

## Frontend contract for the visual task

1. **Entry:** show Google only with the qualified capability. Expose Discord as
   an actionable button only after its service is qualified. Keep “Already have
   a trainer account? Sign in and link it” distinct from new registration.
2. **Authenticate and resolve:** capture provider, UID (once available), auth
   lifecycle and flow generation. Resolve authoritative account ownership before
   asking for a new name. Existing users open their current account. Missing is
   an affirmative result; timeout, conflict or unavailable authority is not missing.
3. **Trainer identity and privacy review:** ask for trainer name; friend code is
   optional. Do not copy provider email, display name or avatar automatically.
   Display the actual existing visibility/sharing behavior before confirmation.
   Do not invent a new visibility default or promise privacy unsupported by the
   current projection model. The current handle check validates syntax only;
   name availability is decided by the server transaction, not this button.
4. **Explicit create and verification:** submit one durable request identity.
   Handle conflicts return to name choice. Unknown outcomes enter “Checking your
   account” and reconcile that request; do not silently create another UID or
   issue a new operation. Verify foundation, profile and owner projection before
   considering setup complete.
5. **First wanted Pokémon:** after verification, offer one normal owner-scoped
   list addition using the existing mutation path, plus “Explore first”. This
   optional step cannot block sign-in or imply consent to sharing. Repeated
   confirmation/reload must not create duplicate entries.

The existing model states map to authentication resolution, name choice,
creation, verification and explicit error states. Privacy review and the optional
first-wanted step are not implemented there yet. Use accessible labels, focused
error summaries and live status text; never refocus or replay a prompt on each
navigation. Keep returning-user link reminders separate and default-off.

## Required edge cases and remaining local work

- **Cancellation:** this patch invalidates pending model startup, handle checks
  and creation results across cancellation/restart, even on the same UID. It
  does not cancel a server transaction already dispatched. Preserve the separate
  foundation request receipt and reconcile it on return. The host's
  `cancelGoogleOnboarding` still signs out whichever user is current; it needs
  exact originating UID/lifecycle validation and auth-gate coordination before
  enablement. A non-cancelable auth commit must be presented honestly as finishing.
- **Provider collision / wrong account:** never merge by email, handle or label.
  Ask the user to sign into the original trainer account and explicitly link.
  A provider already owned by another UID must fail closed; no data transfer.
- **Partial profile / reload:** the model stores only a UID digest, lifecycle,
  provider and bounded flow state, not profile drafts. The account-sync runtime
  has profile initialization/readback and pending mutation reconciliation, but
  the complete host path after foundation creation and interrupted profile
  initialization needs qualification. Ask for omitted optional drafts again;
  preserve any existing canonical profile and never overwrite it with defaults.
- **Tabs / session changes:** bind all continuation and UI updates to the exact
  operation generation and auth lifecycle, use the existing shared auth gate,
  and test actual host cancellation, stale callbacks, reload and competing tabs.
  This model patch is not full browser/emulator qualification of new signup.
- **Recovery:** linking retains the original UID and data. Export/import stays
  explicit recovery, not a condition of ignoring a reminder. Existing recovery
  apply is emulator-only and additive; no production writer is enabled. Imported
  data cannot restore administrator rights, group membership or permissions.

## Backend work and external prerequisites

Google already has `createE1ProviderAccountFoundation` plus a durable client
request/reconciliation path. The authority requires recent verified Google
authentication and current subject ownership. Its transaction claims account,
handle, UID-provider relationship, subject and receipt atomically. It also requires
an active reviewed legacy-provisioning freeze and current complete namespace
certification. Historical inventory in PROVIDER-IDENTITY-COVERAGE.md is not current
certification. Freeze/collision holds/backfill and activation need separate scoped
review and approval; existing PIN sign-in must remain available.

Discord needs a server-owned registration continuation bound to the verified OAuth
subject, browser and flow; it must not trust a client-supplied provider key/UID.
Use the same canonical authority for atomic name/subject/account claims and durable
receipts. Design the Firebase identity provisioning failure/retry boundary before
minting a token; an OAuth success alone cannot commit signup. Reconcile namespace
and subject ownership again at confirmation, reject stale consent, and preserve
the existing-link branch. Add this protocol and emulator tests before frontend
signup wiring; do not weaken the Google-only endpoint to accept arbitrary custom
auth assertions.

Externally, Discord app `PoGo Trades Staging` (`1564289039526268938`) and redirect
`https://doomsday126dev.github.io/trade-app/auth/discord.html` were already approved
and registered. Secret transfer/storage, runtime permissions, TTL, service
configuration/deployment and canary OAuth linkage remain unapproved. The latest
allowed billing check found staging and production billing disabled; no billing
change is approved. The earlier denied Firebase configuration reads were not
retried. Live readiness, privacy behavior and rollout must be qualified before
enabling signup. No PIN cutoff, real-account migration or auth deployment occurs
in this milestone.

## Local verification

Four new regressions first failed against the prior model, then passed with the
generation guard: cancel during initial digest, superseded handle success,
superseded handle failure, and a late dispatched creation result. These verify
that neither current UI state nor its durable continuation is overwritten.
`npm run test:google-provider`: 121 passed. No real account writes.
