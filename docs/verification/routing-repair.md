# Verification routing repair

Base: current `origin/main` at `4a25827d8308619d17b55597eb8de67dfe05716a`.
Scope: selector, regression tests and this report. No runtime, UI, schema, Rules,
provider rollout, identity behavior, production infrastructure or release pins change.

## Executing paths and defects

1. `.github/workflows/product-review.yml` checks out the PR tree with full history,
   plans via `scripts/select-product-checks.cjs`, installs the selected Functions /
   Rules / browser prerequisites, then executes the selector. Performance selection
   also calls this selector. Before this repair, `sw.js` selected a nonexistent
   `tests/service-worker-release.test.cjs`. `package.json`'s `test:pages-release`
   and the actual pinned Pages control reference the same missing path. No version
   of that file was found in the available repository history; no rename target was
   found. This was a dangling permanent entry point, not redundant coverage to drop.
2. CLI discovery used `git diff --name-only --diff-filter=ACMR`. Deletions never
   reached ownership matching. Newline splitting also corrupted unusual paths,
   and rename folding lost the old owner when moving between areas.
3. Self-selection only recognized `tests/...test.cjs`, not `functions/test/...`.
   For example, editing only `functions/test/e1-rate-limit.test.cjs` selected
   generic provider contracts and `functions`' `check:contract`, but not its rate
   limiter assertions. Existing Functions npm suites already contained that test;
   the defect was dispatch. The public-share backend pair already had an owning
   command, but only one test path was recognized as part of the public contract.

## Corrected routing and permanent invariants

- Discovery uses NUL-delimited `git diff --name-only --no-renames -z`, with no
  status exclusion. Deletions and type changes are retained, and a rename supplies
  both its old and new paths. Existing qualified-predecessor and ancestry checks
  are unchanged.
- All ownership matching sees deleted paths. Deleted tests/syntax inputs are
  removed from runner arguments only after ownership matching. Missing unchanged
  required tests fail qualification. An empty backend test command is an error,
  never bare `node --test` discovery.
- Deleted members of the product, sync, privacy, service-worker release, public
  backend and rate-limit/handle groups select surviving group members. The rate
  limiter's companion verifies admission, exhaustion and replay bypass in handle
  reservation. Legacy reset tests retain their existing isolated owner group.
  Deleted runtime sources retain their existing source-area routes; deleted
  backend sources retain the contract fallback. Unmapped deleted tests, browser
  specs, helpers and other non-document paths fail with an explicit request to
  declare surviving coverage. Documentation deletions remain documentation-only.
- Changed `functions/test/**/*.test.cjs` select themselves and cause Functions
  dependencies to be installed. The public-share pair retains its explicit owner
  command without duplicate direct execution. Existing generic backend fallback
  checks remain for other backend changes. Both existing backend helper files
  have declared consumer suites, used for edits and deletions; new support files
  require a consumer declaration rather than receiving only generic coverage.
- Service-worker/release changes and edits to their tests select seven permanent
  suites: asset versioning, frontend extraction, release fetch behavior, atomic
  install, cache lifecycle, deployment rollback and install performance. They
  also select the workflow reference guard. Selector, relevant workflow and
  package-script changes select these plus Pages control regression coverage.
- The restored `service-worker-release.test.cjs` exercises actual worker fetch
  events: exact current cache bytes, network behavior for other/unversioned keys,
  reload-and-cache on a current-release miss, offline refusal to substitute other
  release bytes, and Firebase/mutation bypass. Atomic install, lifecycle and
  rollback remain in their existing suites. `client-asset-versioning` already
  checks static release coherence; the restored suite adds runtime fetch proofs.

## Immutable control boundary

`deploy-pages.yml` still calls `pages-release-control.yml` at
`ddcfcddfb33afbaf2d61024018e956f321f69af6`; its control input agrees with that SHA.
The executing workflow checks out `inputs.runtime_source_sha` into `target`,
`job.workflow_sha` into `control`, and the dispatcher into `caller`. The missing
reference is **target/tests/service-worker-release.test.cjs**, so a future approved
runtime containing this repair satisfies the existing frozen control. Its
control-side regression command uses three other tests, all present at the pin.

No new control candidate or repin is required for this repair. No workflow/pin,
existing runtime tag or selector tag is changed, and no deploy is dispatched.
An old immutable runtime lacking the file remains incompatible with this control;
this PR cannot retroactively repair that runtime. Supporting it would need a
separate reviewed control candidate and dispatcher/selector repin, without moving
existing tags. Normal new runtime release approval/tagging still applies.

The new workflow guard reads the dispatcher-selected immutable workflow from Git,
checks every target/control Node test path in its actual checkout, verifies the
local release command, and verifies PR prerequisite ordering. It does not merely
check the mutable workflow on main.

## Validation

- Selector and workflow regressions, including a temporary Git repository with
  deletion, rename, type change, addition, modification and newline-bearing path.
- New release suite: five behavioral tests.
- Exact frozen control's mandatory runtime Node list: 145 assertions passed.
- `npm run test:pages-release`: 106 assertions passed.
- Immutable control's own three regression files, extracted from `ddcfcdd` and
  executed with explicit control/caller/runtime roots: 42 assertions passed.
- Local release coherence, domain helpers, community membership, frozen Firebase
  read checker and global identity static contract checks passed.
- Final branch selection and PR CI results are recorded in the PR.

No historical identity/provider/canary matrix or production operation was run.
Those checks appear in plan-only ownership regressions where relevant.

## Remaining limits

Ownership declarations are routing floors, not proof that every deleted assertion
was redundant. Review must assess lost coverage; unmapped retirement is blocked.
The selector is not a complete production-source dependency graph: unfamiliar
backend source changes retain the existing `check:contract` fallback, and new
fine-grained source ownership remains separate work. Emulator/operator boundaries
and browser exclusion policies remain unchanged. Local tests do not exercise a
live Pages deployment, approval, credentials or production Firebase state.
