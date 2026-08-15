# GitHub Pages Production Deployment

## Identity Model

Pages deployment has two independent immutable identities.

The **control identity** chooses reviewed deployment code:

```text
control_selector_tag = release-pages-control-<full-dispatcher-sha>
dispatcher_sha       = control-selector tag target
control_workflow_sha = full SHA pinned by the dispatcher
```

The **runtime identity** chooses the frontend bytes:

```text
runtime_release_id  = 2026-08-05.46
runtime_release_tag = release-2026-08-05.46
runtime_source_sha  = exact tag target and build checkout
```

`expected_live_sha` is a third identity: the runtime SHA that the public deployment manifest must report immediately before production is overwritten.

The control selector and runtime release tag must not be the same tag. Runtime tags and used control-selector tags are immutable.

## Architecture

The production path is deliberately split:

1. An operator dispatches `.github/workflows/deploy-pages.yml` from an immutable `release-pages-control-<dispatcher-sha>` tag.
2. The dispatcher pins `.github/workflows/pages-release-control.yml` by a full immutable SHA.
3. Explicit inputs select a runtime tag, runtime release ID, runtime source SHA, expected live SHA, mode, and exact confirmation.
4. The reusable workflow validates both identities and checks that the runtime tag resolves exactly to the runtime source SHA.
5. The build job checks out `runtime_source_sha`, never `github.sha`, `main`, or the control-selector commit.
6. It validates release coherence and builds only the reviewed 68-file runtime allowlist.
7. A separate protected-environment job verifies the actually served manifest, deploys the existing artifact without rebuilding, and proves the current run's deployment plus the served schema-2 manifest.

The runtime source cannot replace the workflow, validators, builder, verifier, permissions, or artifact allowlist. Ordinary pushes and tag creation are inert because both workflows remain manual-only.

## Trust Bootstrap And Updates

Every control revision uses two inert commits:

- **Commit A, control fix:** trusted reusable workflow, validators, builder/verifier, tests, and documentation.
- **Commit B, dispatcher repin:** only `.github/workflows/deploy-pages.yml`, updated to the new input contract and to pin Commit A's full SHA.

After both commits are separately reviewed and pushed, create an immutable selector at Commit B:

```bash
CONTROL_FIX_SHA=<40-character-commit-a-sha>
DISPATCHER_SHA=<40-character-commit-b-sha>
CONTROL_SELECTOR=release-pages-control-${DISPATCHER_SHA}

git fetch origin main --tags
git rev-parse "${DISPATCHER_SHA}^{commit}"
git merge-base --is-ancestor "$DISPATCHER_SHA" origin/main
git tag "$CONTROL_SELECTOR" "$DISPATCHER_SHA"
git rev-parse "${CONTROL_SELECTOR}^{commit}"
git push origin "refs/tags/${CONTROL_SELECTOR}"
```

Tag creation alone must not dispatch or deploy. Never move or reuse an old control-selector tag. A later control change gets a new Commit A, new dispatcher-only Commit B, and new selector.

Existing runtime tags never move merely because deployment tooling changes. In particular:

```text
release-2026-08-05.46
-> d7491e83a917bdbbf341bfb68fc947549557a54e
```

remains the immutable `.46` runtime identity.

## External Settings

Source code cannot configure these controls. Verify them independently:

- Pages source is **GitHub Actions** (`build_type=workflow`).
- The `github-pages` environment permits only `release-*` tags. The control selector deliberately fits that policy.
- The required reviewer is `Doomsday126dev`.
- Self-review is disabled unless separately approved.
- Administrator bypass is disabled unless separately approved.

The workflow defaults to `permissions: {}`. Build receives only `contents: read`. Deploy receives `contents: read`, `deployments: read`, `pages: write`, and `id-token: write`. The workflow uses no secret; `github.token` is read-only for deployment provenance.

Concurrency is `pages-production` with `cancel-in-progress: false`. Runs queue, and each queued run rechecks `expected_live_sha` immediately before deployment.

## Control Selector Validation

The dispatcher must run from:

```text
github.ref_type = tag
github.ref_name = release-pages-control-${github.sha}
dispatcher_sha  = github.sha
control_selector_tag = github.ref_name
```

The SHA must be 40 lowercase hexadecimal characters. Branches, runtime release tags, short-SHA selectors, and mismatched selectors fail closed.

The dispatcher passes its own immutable SHA and selector to the reusable control. The reusable control additionally requires its `job.workflow_sha` to equal the dispatcher-pinned `control_workflow_sha`.

## Runtime Validation And Checkout

The runtime inputs are explicit:

```text
runtime_release_tag = release-${runtime_release_id}
runtime_source_sha  = runtime tag target
checked-out HEAD    = runtime_source_sha
runtime_source_sha  is reachable from origin/main
```

The build checkout is always:

```yaml
ref: ${{ inputs.runtime_source_sha }}
```

`github.sha` identifies the dispatcher commit and is never a runtime build source. Runtime release checks still require `index.html`, `clientRelease.js`, `sw.js`, every first-party script query, service-worker release graph, and web-manifest assets to agree with `runtime_release_id`.

## Manual Release

The exact release confirmation is:

```text
DEPLOY <runtime_release_tag> <runtime_source_sha> VIA <control_selector_tag>
```

Conceptual command, not to be run without separate production approval:

```bash
gh workflow run deploy-pages.yml \
  --repo Doomsday126dev/trade-app \
  --ref "release-pages-control-<full-dispatcher-sha>" \
  -f runtime_source_sha=<40-character-runtime-sha> \
  -f runtime_release_id=2026-08-05.46 \
  -f runtime_release_tag=release-2026-08-05.46 \
  -f expected_live_sha=<40-character-current-live-runtime-sha> \
  -f mode=release \
  -f 'confirmation=DEPLOY release-2026-08-05.46 <runtime-sha> VIA release-pages-control-<dispatcher-sha>'
```

Before environment approval, inspect the summary for both runtime and control identities plus the artifact digest.

## Rollback

Rollback uses the current reviewed control selector while selecting an older immutable runtime tag and SHA. Its exact confirmation is:

```text
ROLLBACK <runtime_release_tag> <runtime_source_sha> FROM <expected_live_sha> VIA <control_selector_tag>
```

This permits new deployment control to restore old frontend bytes without executing the historical runtime commit's dispatcher. Version ordering is never inferred. Service-worker rollback still stages a complete target shell, preserves the currently active shell until completeness is proven, removes only owned obsolete caches, and preserves unrelated caches.

## Artifact Contract

`scripts/pages/frontend-files.json` is the reviewed source of truth. It contains exactly 68 runtime files: `index.html`, `manifest.json`, `sw.js`, all 60 HTML-loaded first-party scripts, and five referenced icons. It excludes workflows, deployment scripts, tests, docs, functions, private/local files, logs, reports, `node_modules`, and temporary output.

The runtime payload digest excludes `deployment-manifest.json`, so identical runtime bytes remain deterministic across runs and control revisions. For every allowlisted path sorted lexically, the hash input is the path, a NUL byte, the lowercase SHA-256 of the file bytes, and a newline.

For runtime `.46`, both `d7491e83...` and the control-only main revisions produce:

```text
98fd4696359e7cbc478ef808fe86f57094ae48d59c2f1a2bee55de913556efe4
```

## Deployment Manifest

New deployments publish schema 2:

```json
{
  "schema_version": 2,
  "source_sha": "<runtime-source-sha>",
  "release_id": "<runtime-release-id>",
  "release_tag": "<runtime-release-tag>",
  "deployment_selector": "<control-selector-tag>",
  "dispatcher_sha": "<dispatcher-sha>",
  "github_run_id": "<numeric-run-id>",
  "control_workflow_sha": "<control-workflow-sha>",
  "artifact_digest": "<runtime-payload-digest>",
  "artifact_digest_algorithm": "sha256-path-null-content-sha256-v1"
}
```

The current production `.46` schema-1 manifest predates selector separation. Schema 1 is accepted only by the pre-deploy current-live compatibility check. Post-deploy proof requires schema 2 and exact runtime/control provenance. Both schemas reject extra, missing, malformed, or contradictory fields.

## Pre-Deploy Live Proof

The authoritative pre-deploy question is: what runtime is actually served now?

The verifier fetches the exact production `deployment-manifest.json` over HTTPS with cache busting, no redirect following, a per-request timeout, and bounded retries. The URL is fixed to:

```text
https://doomsday126dev.github.io/trade-app/deployment-manifest.json
```

The strict manifest must report `source_sha = expected_live_sha`; otherwise the run fails closed. Missing, malformed, unreachable, redirected, permanently stale, or wrong-SHA responses do not fall back to GitHub metadata.

GitHub's latest successful deployment is supporting evidence only. The known production state is intentionally covered:

```text
served manifest source SHA = d7491e83a917bdbbf341bfb68fc947549557a54e
latest globally successful deployment SHA = 4505828ca7fc8f48ca1b23dfcadf860691e6e588
```

That historical mismatch is reported but does not block when the served manifest proves the expected live SHA.

## Post-Deploy Current-Run Proof

The pinned `actions/deploy-pages` action exposes `page_url`, not a deployment ID. The verifier therefore derives current deployment identity from the exact tuple:

```text
environment = github-pages
deployment SHA = dispatcher_sha
deployment ref = control_selector_tag
latest status = in_progress
status log_url = exact repository/current github.run_id/concrete job ID
```

Exactly one deployment must match. The GitHub deployment ref is the control selector, not the runtime tag. The served schema-2 manifest separately proves the runtime tag and source SHA.

The deploy action's step conclusion must be `success`. The verifier then requires the cache-busted public manifest to match the runtime source SHA, runtime release ID/tag, control selector, dispatcher SHA, reusable-control SHA, current run ID, artifact digest, and digest algorithm. It also verifies `index.html`, `clientRelease.js`, `sw.js`, and every first-party script URL with one coherent runtime release.

`in_progress` is the correct GitHub environment-deployment state while the enclosing deploy job is still running. After current-run metadata and served bytes are proven, verification exits; only then can GitHub finalize the job/deployment as successful. This avoids the former circular wait for the current deployment to become successful before its job could finish.

Previous successful deployments, concurrent deployments, the wrong control selector, the wrong dispatcher SHA, zero/multiple matches, failed deploy steps, stale manifests, and schema-1 post-deploy manifests all fail closed. CDN convergence retries are bounded; permanent stale state fails.

## Required Validation

`npm run check:pages-release` performs release/allowlist coherence, Pages-control and service-worker tests, client asset/UI tests, and domain/community/global contracts. The workflow also runs the immutable control regression suite from the control checkout.

Before approving the two commits, run focused selector/runtime, manifest, predeploy, postdeploy, rollback, deterministic artifact, and service-worker rollback tests; parse YAML/JSON; check JavaScript/CJS syntax; run sensitive/capability scans; and run `git diff --check`.

No control revision is deployment-eligible until Commit A is immutable, Commit B pins that exact SHA, and a matching immutable control-selector tag exists at Commit B. Do not dispatch from `main` or from a runtime release tag.
