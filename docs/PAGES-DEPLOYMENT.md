# GitHub Pages Production Deployment

## Hard Stop Before Push

> **DO NOT PUSH THIS CANDIDATE UNTIL PAGES SOURCE HAS BEEN MANUALLY CHANGED TO GITHUB ACTIONS AND `build_type=workflow` HAS BEEN VERIFIED.**

This change replaces legacy branch-root publication with a manual, exact-SHA deployment. A normal push to `main` must perform no Pages deployment.

## Architecture

The production path is deliberately split:

1. A tiny `workflow_dispatch` dispatcher accepts an approved SHA, release ID, expected live SHA, explicit mode, and exact confirmation text.
2. The dispatcher calls `.github/workflows/pages-release-control.yml` from a full immutable commit SHA. The selected release cannot rewrite the control that deploys it.
3. The reusable workflow validates the tag, SHA, checked-out commit, release graph, test gates, and reviewed frontend allowlist.
4. It builds one deterministic artifact and uploads it under a run-specific name.
5. A separate `deploy` job enters the protected `github-pages` environment. A reviewer sees SHA, tag, release, artifact digest, and trusted control SHA before approval.
6. The deploy job verifies the operator's `expected_live_sha`, deploys the existing artifact without rebuilding, then binds the current run's in-progress GitHub deployment to the approved SHA and verifies the served manifest/release graph.

Legacy branch publication was unsafe for this workflow because every push to the configured branch could publish repository-root content without a release-specific approval. The reviewed artifact now contains only the runtime allowlist plus `deployment-manifest.json`.

## Trust Bootstrap

The source change must be split into two commits:

- **Commit 1:** reusable workflow, validators, builder, verifier, allowlist, tests, documentation, and validation dependency.
- **Commit 2:** only `.github/workflows/deploy-pages.yml`, replacing its all-zero fail-closed placeholder with Commit 1's full 40-character SHA.

Commit 1 must not contain an operational dispatcher. Commit 2 must not change deployment logic. GitHub exposes the called workflow's immutable `job.workflow_sha`; the validator requires it to equal the SHA declared by the dispatcher. GitHub does not provide a native way for a reusable workflow to hash the caller YAML blob, so the trusted boundary is the full-SHA `uses:` reference plus the exact control-SHA input comparison. Repository review/branch protection remains responsible for the tiny dispatcher blob.

## External Settings

Source code cannot configure these controls. Before either commit is pushed, configure and read back:

- Pages source: **GitHub Actions** (`build_type=workflow`).
- `github-pages` environment deployment branch/tag policy: `release-*` tags only.
- Required reviewer: `Doomsday126dev`.
- Self-review behavior: disabled unless separately approved.
- Administrator bypass: disabled unless separately approved.

The workflow defaults to `permissions: {}`. Build receives only `contents: read`. Deploy receives `pages: write` and `id-token: write`, plus `contents: read` to check out the immutable verifier and `deployments: read` to verify the latest successful GitHub Pages deployment. No secret is required; `github.token` is used read-only for deployment provenance.

The concurrency group is `pages-production` with `cancel-in-progress: false`. Simultaneous dispatches queue; a later request cannot silently cancel an earlier approved deployment. Each queued run still performs its own expected-live check immediately before deployment, so a stale second request fails.

## Release Selector And Exact SHA

Create a lightweight immutable selector only after the release commit is approved:

```bash
git fetch origin main --tags
git tag release-2026-08-05.46 <40-character-approved-sha>
git rev-parse release-2026-08-05.46^{commit}
git merge-base --is-ancestor <40-character-approved-sha> origin/main
git push origin refs/tags/release-2026-08-05.46
```

The workflow requires all of these to match:

```text
approved_sha = tag target = github.sha = checked-out HEAD
github.ref_type = tag
github.ref_name = release-${release_id}
```

The SHA must be exactly 40 lowercase hexadecimal characters and reachable from `origin/main`. Never force-move a used release tag. If an unused tag points to the wrong SHA, stop; under an explicit procedure delete it before any dispatch and create a corrected tag, or choose a new release ID. If it was used, retain it as evidence and use a new release ID.

## Manual Release

The dispatcher has `workflow_dispatch` only. Creating a tag does not deploy it. A normal release confirmation is exactly:

```text
DEPLOY release-2026-08-05.46 <approved-sha>
```

Example operator command, not to be run without separate approval:

```bash
gh workflow run deploy-pages.yml \
  --repo Doomsday126dev/trade-app \
  --ref release-2026-08-05.46 \
  -f approved_sha=<40-character-approved-sha> \
  -f release_id=2026-08-05.46 \
  -f expected_live_sha=<40-character-current-live-sha> \
  -f mode=release \
  -f 'confirmation=DEPLOY release-2026-08-05.46 <40-character-approved-sha>'
```

Before approving the environment, inspect the build summary for the exact SHA, release, tag, artifact digest, and trusted control SHA.

## Rollback

Rollback uses the same immutable tag, exact-SHA validation, test/build gates, protected environment, and post-deploy proof. Version ordering is never inferred. The confirmation is:

```text
ROLLBACK release-<target-release-id> <target-sha> FROM <expected-current-live-sha>
```

Use `mode=rollback`, the target release tag in `--ref`, and the exact currently successful Pages deployment SHA as `expected_live_sha`. The service worker treats all noncurrent owned caches as obsolete without comparing release numbers. It stages a complete target shell, activates only after completeness is proven, removes newer owned caches after activation, preserves unrelated caches, and serves the rolled-back shell offline.

The dispatcher must exist at the selected tag, so the same-release `.46` tag created at Commit 2 is the first rollback anchor. To restore frontend bytes from a pre-cutover revision, create and review a new commit that restores those runtime files while retaining the deployment controls; do not point the workflow at a historical commit that predates the dispatcher.

## Artifact Contract

`scripts/pages/frontend-files.json` is the reviewed source of truth. It includes `index.html`, `manifest.json`, `sw.js`, all 60 HTML-loaded first-party scripts, and five referenced icons. It excludes `functions/**`, tests, docs, workflows, scripts, private/local files, logs, screenshots, reports, `node_modules`, and temporary output.

The builder rejects missing files, duplicates, symlinks, forbidden paths, nonempty output, release mismatches, and unexpected artifact entries. The generated public `deployment-manifest.json` contains only:

```json
{
  "schema_version": 1,
  "source_sha": "<sha>",
  "release_id": "<release>",
  "release_tag": "release-<release>",
  "github_run_id": "<numeric-run-id>",
  "control_workflow_sha": "<sha>",
  "artifact_digest": "<digest>",
  "artifact_digest_algorithm": "sha256-path-null-content-sha256-v1"
}
```

The payload digest deliberately excludes `deployment-manifest.json` so run ID and provenance do not make identical frontend bytes nondeterministic. For every reviewed payload file sorted by path, the hash input is `path`, a NUL byte, the lowercase SHA-256 of the file bytes, and a newline.

## Required Validation

`npm run check:pages-release` performs release/allowlist coherence, focused Pages and service-worker tests, client asset/UI tests, and domain/community/global contracts. The reusable control also runs its immutable workflow/rollback regression tests. JavaScript/CJS syntax, JSON parsing, YAML parsing, sensitive/capability boundaries, and `git diff --check` are required before the two commits are approved.

The release gate checks `index.html`, `clientRelease.js`, `sw.js`, all first-party query versions, the exact service-worker release graph, web-manifest icons, and file existence. Build failures never reach the environment. Deploy failures retain GitHub run/deployment evidence and must not be retried with changed inputs; create a new reviewed dispatch.

## Expected Live SHA And Verification

`expected_live_sha` is compared with the newest successful `github-pages` deployment from the GitHub Deployments API after environment approval and immediately before deploy. This is stronger than a mutable served file and is why `deployments: read` is present. A mismatch stops the run.

## Post-Deploy Current-Run Proof

The pinned `actions/deploy-pages` action exposes `page_url` but not the GitHub Deployments API ID. Post-deploy verification therefore does not ask for the newest successful deployment: the enclosing job cannot become successful until verification exits, so that would create a circular dependency.

Instead, the verifier queries deployments narrowed to `environment=github-pages` and the approved SHA, then requires exactly one deployment with:

- the exact release-tag ref;
- the exact approved SHA and `github-pages` environment;
- a current `in_progress` status whose `log_url` names this `GITHUB_RUN_ID` and a concrete job ID;
- a successful `deploy-pages` step;
- a cache-busted served manifest containing this run ID and the exact prebuilt artifact digest; and
- the expected release, control SHA, runtime files, and first-party script graph.

`in_progress` is the correct GitHub environment-deployment state while the protected deployment job is still executing. After the current-run deployment and served bytes are proven, the verifier exits successfully; only then can GitHub finalize the job and deployment as successful. Zero or multiple current-run matches fail closed. A previous successful deployment, concurrent run, wrong SHA/ref, failed deploy step, or stale manifest cannot satisfy this proof.

Pre-deploy and post-deploy checks intentionally remain different. Before deployment, `expected_live_sha` still protects against overwriting an unexpected latest successful deployment. After deployment, current-run identity and served artifact provenance replace the globally newest-successful lookup.

After deployment, verification requires:

```text
approved/tag/workflow SHA
= current-run GitHub deployment SHA
= served deployment-manifest source_sha

current workflow run ID
= deployment status log run ID
= served deployment-manifest github_run_id

prebuilt artifact digest
= served deployment-manifest artifact_digest
```

It also fetches `index.html`, `clientRelease.js`, `sw.js`, and every first-party script URL, requiring HTTP success and one release ID. Troubleshooting starts with the build summary, current-run deployment status, and public manifest; never bypass a failed expected-live or release-coherence check.

## Safe Cutover

1. Human changes Pages source from **Deploy from a branch** to **GitHub Actions**.
2. Read back and verify `build_type=workflow`.
3. Verify `.46` remains live.
4. Verify the setting change itself starts no generated legacy Pages run.
5. Configure the `github-pages` environment tag policy, reviewer, self-review, and bypass settings.
6. Push trusted control Commit 1.
7. Confirm no automatic Pages build or deploy occurs.
8. Pin the dispatcher to Commit 1 and push Commit 2.
9. Confirm again that no automatic Pages build or deploy occurs.
10. Under separate approval, create the immutable baseline tag at Commit 2.
11. Confirm tag creation alone performs no deployment.
12. Treat any same-release `.46` rehearsal/deployment as a separate production approval.

The incident lesson is that publication intent must be distinct from source-control intent. This design makes an ordinary push inert and moves release selection, provenance, and approval into explicit controls.

> **DO NOT PUSH THIS CANDIDATE UNTIL PAGES SOURCE HAS BEEN MANUALLY CHANGED TO GITHUB ACTIONS AND `build_type=workflow` HAS BEEN VERIFIED.**
