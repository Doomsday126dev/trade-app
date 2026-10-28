# Finite acceptance checklist: provider signup and linking

2026-10-28. This is the bounded release contract. Expanding recovery capabilities
is not a prerequisite for releasing safe same-UID linking or ordinary new signup.
All candidates remain off. Source qualification and CI are not activation approval.

## 1. Local code qualification (implemented; final-head CI required)

- [x] Google existing-account resolution, owner-bound pending creation and profile
  review; cancellation/reload cannot activate or sign out a replacement session.
- [x] Discord server-owned registration review and atomic canonical UID, trainer
  name, provider subject and receipt. Collisions and replay never merge accounts
  by email/label or replace an existing UID. Canceling never deletes a claim.
- [x] Injected server composition connects the existing private Firestore store,
  verified Firebase authority, OAuth transport, token minter and App Check gateway.
  Auth/database project mismatch rejects setup. No runtime export or secret lookup.
- [x] First signup mints only after reciprocal canonical/provider ownership and a
  durable private registration claim. Firebase custom-token exchange creates the
  exact UID; the server needs no Auth user-creation permission. Initial issuance
  is bounded to five minutes after the claim. Verified signed readback activates
  its durable receipt. Missing/disabled/changed activated users fail closed.
- [x] Pre-existing UID collision, infrastructure errors, lost mint response,
  replay, expired initial issuance, unlinked subject and wrong UID are tested.
  The bootstrap window does not shorten Firebase's issued-token lifetime; no
  instant revocation guarantee is claimed for a token already issued.
- [x] Shared auth gate covers SDK commit boundaries, logout, competing tabs,
  blocked persistence and explicit checkpoint reconciliation. A non-cancelable
  commit is reported accurately; no automatic checkpoint expiry/reset.
- [x] Candidate Discord account reads enter the same UID-bound host profile,
  sync and publication runtime. Host/runtime and browser fixtures test reload,
  initial profile interruption and account switching. Staging proof is separate.
- [x] Unlink accepts only the currently implemented verified PIN/password fallback
  and current reciprocal ownership. Do not advertise provider-only unlink or
  removal of the last method. Last-method recovery is not inferred from a file.
- [x] Optional recovery review shows section inventory, actual supported profile/
  display values, explicit selection/acknowledgement, conflicts and reference-only
  permissions/sharing. Upload integrity/owner checks precede writes. Export is
  private/local; a requested download is not proof the user saved the file.
- [x] Same-owner batching/readback, actual IndexedDB reload/two-tab edits, revision
  protection, history archives, unsupported preferences and partial-result retry
  are qualified. Live recovery writer activation remains outside this release.

## 2. Exact staging setup and canary proof (pending; no blanket approval)

- [ ] Owner approves only the pending Secret Manager API, three named secrets and
  narrow existing-runtime permissions in [the staging package](DISCORD-STAGING-MINIMAL-APPROVAL.md).
  Do not generate/transfer secrets or alter IAM before that approval.
- [ ] Independently review the final source head and the new registration bootstrap
  claim lifecycle. No TTL on `discordRegistrationClaims`, canonical mappings,
  activation records or receipts. Optional flow cleanup is a separate choice.
- [ ] Review fresh namespace inventory/certification and exact authority/gateway/
  callback/browser release. Keep PIN available and all unrelated capabilities off.
- [ ] Select named dedicated existing PIN and new-signup Firebase/Discord canaries;
  approve identify-only consent/linkage for those exact accounts. Personal app
  ownership does not identify a canary. No real admin/user lists are test fixtures.
- [ ] On staging: link Google and Discord to the original controlled existing UID;
  compare lists, Favorites, tags, groups, sharing URLs and permissions before/after.
  Exercise collision, wrong-account review, cancellation and PIN fallback.
- [ ] On staging: create each provider's new account, review name/privacy, initialize
  profile once, reload, read/edit synthetic owned data and publish/read the intended
  profile under current visibility policy. Repeat interrupted signup and login;
  verify one UID, one handle and no duplicate account or privilege restoration.
- [ ] Verify popup blocked/canceled, Discord redirect/reload/service-worker behavior,
  disabled backend behavior, cross-tab account switching, and honest failure UI.
- [ ] Approve the fail-closed support response for an expired, unactivated Discord
  bootstrap claim. The identity is retained, not reset or reassigned. Verified
  current Auth readback can finish activation; no source-inaccessible bypass or
  automatic extension is implemented. This known exception must be disclosed
  before public signup, not hidden behind another-account creation advice.

## 3. Production release decision (separate, specific approval)

- [ ] Review staging evidence for this exact source/configuration revision, bounded
  rollout scope, rollback and cost exposure. Approve exact production targets and
  flags at action time. No production change is authorized by this checklist.
- [ ] Release same-UID linking and provider-first signup without requiring returning
  users to recreate accounts, import a file, accept reminders or abandon PIN.

## Later PIN retirement requirements (not signup/linking blockers)

- Full actual-account export coverage certification and independent restore
  readback, including explicit treatment of unsupported fields and product limits.
  A valid SHA-256 file is integrity evidence, not account-control proof or a claim
  that all data was captured. Current coverage certifies the provided schema and
  sections; feature collectors must separately attest complete owner-bound data.
- Final production recovery authorization/UI, conflict handling and durable
  receipt policy. Large cross-UID restore remains demo-limited; permissions,
  memberships, roles and share ownership must never be imported as grants.
- An approved manual recovery policy when source-account control is unavailable;
  no automatic destructive export/recreation or bypass based on possession of a file.
- Accessible dismissible reminders, sensible persisted reminder intervals, a
  verified working replacement and fallback, reviewed staged rollout and explicit
  cutoff approval. Ignoring a reminder never deletes or penalizes an account.

No PIN retirement date or automatic migration is introduced here.
