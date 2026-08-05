# Firebase Realtime Database Security Rules

> This document records the active rules contract and operational source of
> truth. It intentionally does not embed copyable production rules JSON.

## Current Status

| Item | Status |
|---|---|
| Production contract | Narrow-read rules deployed |
| Deployment timestamp | 2026-08-05 10:05:15 EDT |
| Reviewed artifact | `tests/firebase/database.rules.narrow-read.json` |
| Candidate SHA-256 | `e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf` |
| Rollback readiness | Verified private rollback baseline is available |

Production rules must be managed from the reviewed repository artifact. The
browser Admin panel, cached application state, documentation examples, and
historical fixtures are not rules-generation sources.

The private rollback artifact and its contents must remain local, ignored, and
non-public. Verify its hash and file mode through the reviewed deployment
runbook before any rules change.

## Active Read Contract

- Root reads are denied.
- `loginDirectory` remains anonymously readable for lightweight trainer-name
  discovery. Writes remain protected-admin only.
- Exact `publicShares/{username}` records remain anonymously readable and
  realtime-capable. Owners may publish only their own projection; protected
  admins retain reviewed maintenance authority.
- Ordinary signed-in users read only their UID-bound profile, owned list paths,
  Inventory, own auth-index row, memberships, and pending decrements.
- Parent collection enumeration and cross-user private reads are denied.
- Admin-wide collection reads depend only on `admins/{uid} === true` and are
  used on demand by the protected Admin surface.
- Disabled global identity, visibility, preference, and group paths remain
  denied until separately reviewed activation work.

The exact path-to-rule contract and emulator coverage are maintained in
`docs/NARROW-READ-RULES-PLAN.md`, `scripts/check-narrow-read-contract.js`, and
the narrow-read emulator suite.

## Write Contract

The narrow-read deployment retained the reviewed hardened write semantics:

- Mutable usernames, profile `isOwner` / `isAdmin` values, and community
  membership do not grant rules authority.
- Established `authIndex/{uid}/username` mappings cannot be reassigned by an
  ordinary user.
- Privileged profile fields cannot be changed by an ordinary user.
- Community maintenance requires protected UID authority.
- Public-share writes remain limited to the trainer bound to the target
  username or a protected admin.

Any write-contract change requires a separate fixture, emulator coverage,
reviewed SHA, rollback verification, and explicit production approval.

## Deployment Safety

1. Run `npm run check:narrow-read-contract` and
   `npm run check:narrow-read-rules`.
2. Verify the candidate file hash against the reviewed value above.
3. Privately export and verify the currently deployed rules as the rollback
   baseline.
4. Replace the complete Firebase Console Rules editor with the complete
   reviewed artifact. Never merge fragments or generate rules from browser
   state.
5. Publish once, record the timestamp/version, and execute the ordered smoke
   test in `docs/NARROW-READ-RULES-PLAN.md`.
6. At the first rollback trigger, publish the complete verified private
   rollback artifact without improvising live edits.

## Defense In Depth

### API Key Restrictions

Restrict the Firebase Web API key to the production GitHub Pages or custom
domain origin through Google Cloud Console HTTP-referrer restrictions. Update
the private allowlist before changing domains.

### Backups

Maintain reviewed rollback exports before rules deployments. Scheduled RTDB
backups are recommended before the community or write volume grows
substantially.

## Update Log

- **2026-08-05, narrow-read deployed** - Removed the authenticated root read,
  mapped all active client read surfaces to explicit rules, and established the
  reviewed narrow-read fixture as the sole repository rules source of truth.
- **2026-08-03, community hardening deployed** - Replaced mutable username and
  profile-role authorization with protected UID-based authority.
- **2026-05-27, docs-only** - Removed private production identifiers from the
  public security reference.
- **2026-05-25, community foundation** - Added temporary community paths and
  protected owner maintenance behavior.
- **2026-05-24, login directory** - Added the public minimal login directory
  required for pre-login username discovery.
