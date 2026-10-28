# Finite early-want artwork packaging amendment

This is a local proposal, not promoted control or publication authority. Qualified PR 194 remains unchanged and publication approval is pending.

The five form pairs need ten new immutable PNG paths in the protected frontend artifact allowlist. The draft `scripts/pages/frontend-files.json` includes those exact paths and nothing from private/control trees. Frontend file count grows from 1,327 to 1,337; artifact count including deployment manifest becomes 1,338. The existing immutable control `54e7feaad458c06a225b43bdb080508e142aeede` lacks these ten paths and would omit them. Do not deploy the additions with that old artifact manifest.

The reviewed protected-control process must promote the exact allowlist delta and preserve all current read guards, handler contracts, permissions, timeout/performance budgets, deployment provenance and expected-live checks. No requirement is relaxed. Exact-source registration and release stamping belong to that later reviewed release; this draft keeps its inherited stamp and makes no tags or dispatch.

The PNG originals and hashes are pinned in `data/catalogue-sources/early-want-form-evidence.json`. Local artifact/reference validation and decoded browser routes pass. Existing allowlist paths remain present; only ten asset paths are added.

Owner publication approval received for PR194 then PR195 and this specific ten-image amendment. The first release is now byte-verified .162 under control4a979f983be646bf20d9834337a680dad72021b4. Promote the exact ten-path delta into the next immutable control and preserve all other read/access/build guards. The .163 runtime and later exact-SHA registration must be frozen before dispatcher repin and final hosted qualification.
