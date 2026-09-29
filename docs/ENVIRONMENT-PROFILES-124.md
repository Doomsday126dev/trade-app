# Explicit .124 environment profiles

The application source retains the reviewed production configuration. The
`scripts/environments/build-profile.cjs` command requires an explicit
`ENVIRONMENT_PROFILE=production` or `staging` and validates all Firebase web-app,
Auth, database and App Check identities against the reviewed profile. No runtime
hostname chooses a backend, no missing field falls back to production, and a
staging setup call cannot substitute another database URL.

The signed-in and anonymous-public App Check clients use the same configuration.
Favorite REST and resolver endpoints derive from the configured database/project;
the staging project has no deployed resolver, so that unrelated service is not
claimed as qualified by the device checklist. Existing application capabilities,
Auth policy, publication and persistence contracts are unchanged.

The profile builder calls the current immutable Pages builder at
`6f58a1a39065c6d1b6070c9ed8fc4fd25efdab43`. The trusted frontend file inventory,
script order and service-worker graph do not change. Production runtime bytes are
exactly what that builder copies from the committed source. For staging, the only
runtime difference is the delimited environment JSON block in `index.html`.
`deployment-manifest.json` additionally records profile, configuration digest and
source tree. The usual artifact digest still hashes every approved runtime file.
The comparison rejects any other byte or provenance difference.

Build both profiles from one clean committed source using explicit SOURCE_DIR,
ARTIFACT_DIR, ENVIRONMENT_PROFILE, PAGES_CONTROL_ROOT, RUNTIME_SOURCE_SHA,
RUNTIME_RELEASE_ID, RUNTIME_RELEASE_TAG, DISPATCHER_SHA and CONTROL_SELECTOR_TAG.
Before loading any control code/data, both building and comparison require the
exact reviewed control SHA and a clean Git index/worktree (including untracked
control files). One shared guard rejects any modified control input. Source
tracked/index cleanliness remains enforced before its configuration is read.
These local builds
use run ID 0 and do not create a runtime tag or deploy anything.

The fixed staging profile targets only project `trainer-hub-staging-37ib4wct`,
app `1:391359988648:web:d5455df9a12624d3f8d39d`, isolated database
`trainer-hub-staging-37ib4wct-share124` and its existing staging App Check key.
No credential or service-account key is a frontend input. Tests reject incomplete
and mixed profiles, execute ordinary transport calls under both profiles, check
the local browser bootstrap and compare complete generated artifacts. Native
device checks apply to the staging profile; automation and byte equivalence
establish their applicability to the production profile. Human results remain
NOT TESTED until the owner performs them.
