# Production authority build inputs

This prerequisite is based on production release `2026-09-15.115`
(`df20ddbc5a273b8fef0832c4e38b3de86b69a2dd`). It changes only the
production authority artifact pipeline. The staged authority application remains
the exact source inventory, commit, and fingerprint selected by
`e1-authority-source-manifest.json`. Base `.115` selects nine files at commit
`ad2edab9be2b1c0e6851dfded3a0f3f71a73b987`, fingerprint
`1f28539b8486c05f31bd0922b282945ba809ff3a88622d2fa10383f9e2d76f69`.
PR #96 separately proposes eleven files at commit
`df20ddbc5a273b8fef0832c4e38b3de86b69a2dd`, fingerprint
`516eace167bffa4a51728e11c67fd01d465d72f8cd7ce194fb6282399171c520`;
this pipeline applies the same verification after normal integration. The staging
shell is a separate, hard-coded staging
path and must not be substituted for this production helper.

## Immutable toolchain

The production helper no longer executes Pack or a buildpacks builder. It creates
an explicit Dockerfile and runs one Cloud Build step. Both executable inputs are
content-addressed:

| Input | Immutable reference | Verified evidence |
| --- | --- | --- |
| Cloud Build Docker step | `gcr.io/cloud-builders/docker@sha256:3d00b6c1a9b862621c30fc74d4f2abfc62bcbdee631ed3febd31e7edbdf6252c` | Google Container Registry returned this exact fully-qualified digest on 2026-09-15. |
| Node builder/runtime base | `docker.io/library/node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa` | Docker Registry returned byte-identical OCI manifest bytes and the same content digest on 2026-09-15. |

The Node manifest selects configuration
`sha256:59c575db86dccc264e6b71c316548f05a5c3c7a9aa1c112dc019807e651fd06b`.
The fetched configuration is Linux/amd64 and declares Node 24.20.0. The immutable
Google provenance public key version 1 was re-read from Cloud KMS; its PEM SHA-256
is `f210fd55df9c83fccc07bbd10c615ebcf695da79f6a2a3213abc4ad0f89e9877`.

Registry origin and byte identity were checked. No publisher-signature or
vulnerability-scan claim is made. Container Scanning remains disabled and is not
an input to this approval package.

## Source and dependency binding

The helper reads the exact manifest-selected Git objects, verifies every file hash,
and copies only those files into a private build context. It adds one generated
Dockerfile whose base digest is part of policy. The exact context is archived
locally; the archive SHA-256 is sealed into the build receipt and must equal Cloud
Build's source-provenance hash. The Cloud Build storage object and generation must
match the resolved-source readback.

The lockfile must use lockfile version 3 and every dependency must have SHA-512
integrity from the npm registry. Install scripts, audit traffic, cache reuse, and
Docker BuildKit are disabled. The resulting container runs as the non-root `node`
user.

## Required phase order

The CLI has no combined deployment mode:

1. `--mode=build` submits one asynchronous build and immediately writes a private,
   sealed build receipt. It contains no Cloud Run command.
2. `--mode=qualify` reads that build, requires success, checks the exact project,
   region, approved builder service account, source archive/hash/generation, build
   config, executed step digest, output name/digest, Artifact Registry binding,
   SLSA v1 statement, Google-hosted-worker builder, exact invocation/build ID,
   subject digest, resolved tool digest, and Google's DSSE signature. It writes a
   separate sealed qualification receipt.
3. `--mode=replace` requires both receipts and the exact qualification SHA-256 from
   the later review decision. It verifies that approval binding, the receipt seals,
   and all bindings, then repeats the build and signed-provenance readback before it
   can dry-run or replace Cloud Run. It cannot submit a build. Existing runtime identity, private IAM,
   resource settings, provider compatibility keys, and inactive gates retain their
   existing checks.

A queued/failed build, absent or mismatched source hash, mutable or substituted
step, wrong builder, malformed output, missing provenance, wrong subject, invalid
signature, changed receipt, or platform schema drift fails closed. The build ID is
available promptly because submission uses the documented `--async` mode.

## Validation boundary

Run:

```sh
node --test functions/test/e1-authority-build-policy.test.cjs functions/test/e1-authority-deployment.test.cjs
npm --prefix functions run test:e1-production-hardening
```

Tests use synthetic Cloud Build and Artifact Registry records and a fresh synthetic
ECDSA key while still exercising exact DSSE verification. No live build, image,
service replacement, IAM change, or API change is part of local validation. A real
artifact must complete the build and qualification phases before a later, separate
replacement approval can use it.
