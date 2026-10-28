# Local host and recovery qualification after de4f1a35

This follow-up is not a deployment or a provider activation. The host canary
flag is absent by default. A local fixture must load providerAuthCommitGate.js
and providerHostAuthGate.js before application.js, set
`__POGO_PROVIDER_AUTH_GATE_CANARY__ = true`, and supply an exact dedicated
`__POGO_PROVIDER_AUTH_GATE_CANARY_UID__`. Missing modules or UID fail closed.
The host installs the wrapped SDK before assigning every auth mutation used by
the app. PIN, Google and custom-token sign-in must resolve to that exact UID;
link, reauthentication, unlink and password changes preserve it. Creation and
deletion are unavailable in this existing-account canary. Google unlink also
requires the retained password method. This is not public provider-first
registration; arbitrary-UID Google sign-in remains outside this canary scope.

All wrapped operations share the Web Lock used by the Discord guard. Overlapping
local mutations are refused. Sign-out cancels and awaits a still-cancelable
operation; a commit already accepted by Firebase must settle first. The host
emits `pogo:auth-commit-state` with `status` and `canCancel`. The late-hook boundary
and real pinned-SDK test are documented in PROVIDER-MIGRATION-REVIEW-FIXES.md.
Older unguarded tabs cannot be made cooperative by this flag; live qualification
must use isolated canary sessions and a reviewed all-host release.

The Discord runtime now offers `startPopup` from a user gesture. It opens the
window before network work, installs the exact-origin/source listener, then
navigates that window while retaining host session state. A blocked popup makes
no gateway call. Explicit cancel closes the popup and clears continuation unless
the Firebase commit boundary has passed. Closing or reloading the callback does
not persist OAuth codes; the user can cancel/restart from the retained host.
Same-window redirect continuation is intentionally not activated: a standalone
callback without its opener provides a safe restart rather than signing in.
The service worker routes the exact callback path directly to the network with
no-store and no referrer, never caches it, and gives a plain failure on offline
fetch rather than the cached account shell. The callback still is not in the
release inventory and is not registered with Discord.

`accountRecoverySyntheticApply` is an in-memory qualification executor with no
database/network writer. It accepts only an explicit accepted, revalidated dry
run for the current UID/lifecycle, issues an opaque in-memory review ticket,
and serializes additive application plus idempotent readback before an atomic
snapshot publish. Repeat/concurrent application of the same ticket returns the
receipt. Edited plans, forged tickets and switched accounts are refused. Only
validated canonical trade entries, Favorites and tags can be added. Every other
section remains untouched, including permission/admin/group membership and
sharing references. Fresh application tickets are required after reload.

This proves the local algorithm, not production recovery authorization or full
fidelity. Profile, legacy-only list content, local ordering/history/preferences,
shared URLs, memberships and permissions remain review/reference data. Enabled
provider-only/share-visibility/synced-preference collectors still fail closed
until implemented. A production executor requires separately reviewed server
identity proof, durable receipts and transaction/readback contracts; an exported
file's checksum is not ownership evidence.

Morning configuration approvals remain those in DISCORD-BACKEND-DECISION.md:
owner-selected staging Discord application, identify-only scope, proposed exact
callback https://doomsday126dev.github.io/trade-app/auth/discord.html, managed
secret/HMAC material, narrow existing runtime permissions, private-store TTL,
and dedicated-canary OAuth grant/release. No credential, grant, IAM, Rules or
Firebase provider changes were made, and Firebase configuration read 403s were
not bypassed. PIN remains available. No merge or deployment is authorized.

## Cross-tab checkpoint follow-up

CI exposed two successful competing synthetic sign-ins despite a Web Lock: a
cached local auth/storage observer is not a fresh shared-state proof. The gate
now opens `pogo-auth-commit-ledger` in IndexedDB and checks its revision and UID
in a fresh transaction under the Web Lock. It records pending before invoking
Firebase, and settled only after outcome validation. Another gate initialized
against an older revision must restart/reload; it cannot act on a stale observer.
Browser/host qualification fails closed without IndexedDB. No token is stored.

A crash or uncertain write leaves pending and blocks further operations. There
is deliberately no automatic lease expiry or reset: those could allow an older
Firebase request to commit after another tab takes over. A reviewed local
checkpoint recovery flow, including quiescing old tabs and reconciling actual
Firebase identity, remains unimplemented and required before broader activation.
If auth succeeds but the settled checkpoint cannot be written, the gate returns
that successful result with `authCoordinationBlocked:true`; it does not falsely
report failed/canceled sign-in. The host must expose that warning before rollout.
This ledger coordinates cooperating candidate tabs, not old unguarded releases.

Verification includes deliberately stale isolated browser observers (20 repeated
passes), pending/storage-failure cases, and two independent Firebase 12.14.0 SDK
Auth instances against the demo emulator. The SDK test proves only one instance
installs its mapped UID. Production persistence propagation and interrupted-tab
recovery remain separate canary qualifications, with no live grant performed.

The follow-up browser-emulator test now also loads the exact pinned browser SDK
from local packages in two Chromium tabs using Firebase indexedDBLocalPersistence.
Both tabs start signed out; competing custom-token commits produce exactly one
success, both tabs converge to the winning UID, and the losing tab retains it
after reload. All network requests are restricted to loopback demo services.
The first harness run lacked local idb/postinstall module mappings and timed out
before initialization; adding those local dependencies produced 11/11 passing
emulator tests. This qualifies actual SDK browser persistence in the emulator,
not live Discord grants, production network behavior or interrupted-tab recovery.

## Blocked-checkpoint UI and logout contract

A focused review found that the host discarded the successful-commit warning
and could clear local identity before a subsequent sign-out rejected the pending
checkpoint. The host now latches and exposes `authCoordinationBlocked`, emits
`coordination-blocked` rather than idle, and displays a signed-in warning. The
Discord client preserves the flag in its successful result and blocked state.
`prepareSignOut` checks the shared checkpoint under the Web Lock before the
application clears local identity; both the original host and a fresh host refuse
a pending checkpoint. The UI explicitly says the account remains signed in.
The original local-cleanup-before-Firebase-signout ordering is retained for a
permitted logout. These changes do not reconcile/reset a pending checkpoint;
that recovery path remains unimplemented. Regressions inject a settled-write
failure, verify actual application logout leaves local identity intact, and
verify the Discord result/state never silently drops the warning.
