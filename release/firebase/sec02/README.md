# SEC-02 RTDB Rules Release Package

This package is prepared for `trade-list-a4297` and the single RTDB instance `trade-list-a4297-default-rtdb`. Preparation does not authorize deployment.

The production candidate is `tests/firebase/database.rules.sec02-production.json` (SHA-256 `c94bf64f129cb7a09643a72892d6e85dc3ff3374e34344ee31c36bdcb9d8a81e`). It is generated from the authoritative narrow-read Rules and changes only `/rules/requests`.

The exact pre-SEC-02 live export is `rollback/database.rules.trade-list-a4297-default-rtdb.pre-sec02-20260817T040808Z.json` (SHA-256 `b1fe3b0a7ac4158fb29df8408b199a5ec865a51d1ceec89a013ef0d08bad5d62`). Its acquisition metadata is stored beside it.

From the repository root, the separately approved Rules-only deployment command is:

```sh
npx --yes --package firebase-tools@15.24.0 firebase deploy --only database --project trade-list-a4297 --config firebase.sec02-production.json --non-interactive
```

The separately approved Rules-only rollback command is:

```sh
npx --yes --package firebase-tools@15.24.0 firebase deploy --only database --project trade-list-a4297 --config firebase.sec02-rollback.json --non-interactive
```

Each config contains exactly one `database` entry with the production instance named explicitly. Neither config contains Hosting, Functions, Firestore, Storage, Auth, or other deployable resources.
