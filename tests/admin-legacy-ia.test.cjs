const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const readiness=readFileSync(path.join(root,'docs/TRAINER-CHANGE-SUMMARY-READINESS.md'),'utf8');
const shareVisibility=readFileSync(path.join(root,'js/domain/shareVisibility.js'),'utf8');
const trainerPreferences=readFileSync(path.join(root,'js/domain/trainerPreferences.js'),'utf8');

function between(startMarker,endMarker){
  const start=html.indexOf(startMarker);
  const end=html.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0&&end>start,`Unable to extract ${startMarker}`);
  return html.slice(start,end);
}

test('Admin uses five operational sections with native section controls',()=>{
  const admin=between('<div class="page ui-container ui-container-wide" id="tab-admin">','<!-- SAFE-TO-TRANSFER MODAL');
  assert.deepEqual(
    [...admin.matchAll(/data-admin-target="([^"]+)"/g)].map(match=>match[1]),
    ['overview','members','access','maintenance','diagnostics']
  );
  for(const section of ['overview','members','access','maintenance','diagnostics']){
    assert.match(admin,new RegExp(`data-admin-section="${section}"`));
  }
  assert.match(html,/const ADMIN_SECTIONS=Object\.freeze\(\['overview','members','access','maintenance','diagnostics'\]\)/);
  assert.match(html,/aria-current','page'/);
});

test('Admin summaries and member scans use already-loaded state without new reads',()=>{
  const rows=between('function adminUserRows()','function renderAdmin()');
  const render=between('function renderAdmin()','async function repairAccount(');
  assert.match(render,/\['admin\.members',users\.length\]/);
  assert.match(render,/\['admin\.admins',admins\]/);
  assert.match(render,/\['admin\.loginReadyAccounts',ready\]/);
  assert.match(render,/\['admin\.activeLists',activeLists\]/);
  assert.match(rows,/allData\.users/);
  assert.match(rows,/allData\.wishlist/);
  assert.match(render,/admin\.updated/);
  assert.match(render,/admin\.viewed/);
  assert.doesNotMatch(`${rows}\n${render}`,/(firebaseGet|managedGet|\bget\(|onValue|subscribe\()/);
});

test('role and account-maintenance actions are separated and retain safety gates',()=>{
  const render=between('function renderAdmin()','async function repairAccount(');
  const toggle=between('function toggleAdmin(','async function addUser(');
  assert.match(render,/id="admin-role-list"|admin-role-list/);
  assert.match(render,/id="admin-maintenance-list"|admin-maintenance-list/);
  assert.match(render,/user\.canMaintain&&!user\.established/);
  assert.match(render,/admin\.secureRepairRequired/);
  assert.doesNotMatch(render,/disabled[^>]*admin\.establishedResetUnavailable/);
  assert.match(toggle,/if\(u===OWNER\)/);
  assert.match(toggle,/confirm\(i18nCore\.t\('admin\.roleChangeConfirm'/);
  assert.ok(toggle.indexOf("confirm(i18nCore.t('admin.roleChangeConfirm'")<toggle.indexOf('writeUser(u,{isAdmin:makeAdmin})'));
});

test('Admin responsive layout uses grouped rows and 48px controls',()=>{
  assert.match(html,/\.admin-nav-button\{[^}]*min-height:48px/);
  assert.match(html,/\.rpin\{[^}]*min-height:48px/);
  assert.match(html,/@media\(max-width:900px\)\{[^@]*\.admin-member-row/);
  assert.match(html,/@media\(max-width:600px\)\{[^@]*\.admin-header/);
  assert.doesNotMatch(html,/\.utbl\{/);
});

test('Admin navigation and data rows use the shared product icon and list language',()=>{
  const admin=between('<div class="page ui-container ui-container-wide" id="tab-admin">','<!-- SAFE-TO-TRANSFER MODAL');
  for(const icon of ['activity','users','key','wrench','shield'])assert.match(admin,new RegExp(`ui-icon-${icon}`));
  assert.match(html,/\.admin-nav-button\{[^}]*border-bottom:2px solid transparent/);
  assert.match(html,/\.admin-nav-button\[aria-current="page"\]\{[^}]*border-color:var\(--accent\)[^}]*background:transparent/);
  assert.match(html,/\.admin-member-list,\.admin-role-list,\.admin-maintenance-list\{[^}]*overflow:hidden[^}]*border:1px solid var\(--border\)/);
  assert.match(html,/\.admin-member-row,\.admin-role-row,\.admin-maintenance-row\{[^}]*border-bottom:1px solid var\(--border\)[^}]*border-radius:0/);
});

test('retired Inventory has no navigable page or Settings entrypoint',()=>{
  const index=readFileSync(path.join(root,'index.html'),'utf8');
  assert.doesNotMatch(index,/id="tab-have"|openSettingsTool\('inventory'\)|openLegacyInventoryTool/);
  assert.match(html,/const LEGACY_INVENTORY_READ_ONLY=true/);
  assert.doesNotMatch(index,/onclick="(?:addInventoryEntry|updateInventoryQty|removeInventoryEntry|submitOfferAction)/);
  assert.match(html,/const RETAINED_TABS=|function switchTab\(/);
});

test('Settings App and Data retains diagnostics without restoring inventory controls',()=>{
  const data=between('data-settings-section="data"','</section>');
  assert.match(data,/accountSync|data|health/i);
  assert.doesNotMatch(data,/have-ac-input|have-toggle-row|have-bulk-bar|addInventoryEntry|openLegacyInventoryTool/);
  assert.doesNotMatch(readFileSync(path.join(root,'index.html'),'utf8'),/id="legacy-inventory-export"|id="have-mine-out"/);
});

test('device-local trainer changes are implemented without claiming cross-device history',()=>{
  for(const requirement of [
    'authenticated, immutable Firebase Auth UID',
    'revision or content fingerprint',
    'viewer-specific record',
    'synchronize across the viewer',
    'added, removed, and changed',
    'Baseline advancement'
  ])assert.match(readiness,new RegExp(requirement,'i'));
  assert.match(readiness,/device-local recurring-trainer comparisons/);
  assert.match(readiness,/No cross-device history backend is enabled/);
  assert.match(readiness,/Explicit \"Mark checked\" advances a Favorite baseline/);
  assert.doesNotMatch(html,/lastSeenTrainerRevision|trainerChangeSummary|advanceTrainerBaseline/);
});

test('frontend consolidation preserves disabled feature boundaries',()=>{
  assert.match(shareVisibility,/SHARE_VISIBILITY_MODEL_ENABLED:false/);
  assert.match(trainerPreferences,/SYNCED_TRAINER_PREFERENCES_ENABLED:false/);
});
