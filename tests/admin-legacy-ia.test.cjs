const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
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

test('Legacy Inventory is a secondary read-only archive with compatibility intact',()=>{
  const account=between('<div class="account-popover" id="account-popover"','<!-- Sync recovery banner');
  const archive=between('<div class="page ui-container ui-container-wide" id="tab-have">','<!-- SCHEDULE -->');
  assert.doesNotMatch(account,/openLegacyInventoryTool|inventory\.title/);
  assert.match(html,/openSettingsTool\('inventory'\)/);
  assert.match(archive,/inventory\.archiveTitle/);
  assert.match(archive,/inventory\.archiveHelp/);
  assert.match(archive,/id="legacy-inventory-export"/);
  assert.doesNotMatch(archive,/have-ac-input|have-toggle-row|have-bulk-bar|have-browse-view|addInventoryEntry/);
  assert.match(html,/action==='have'/);
  assert.match(html,/function exportLegacyInventoryCsv\(/);
  assert.match(html,/function renderMyHave\(/);
});

test('future trainer-change summaries remain documented and unimplemented',()=>{
  for(const requirement of [
    'authenticated, immutable Firebase Auth UID',
    'revision or content fingerprint',
    'viewer-specific record',
    'synchronize across the viewer',
    'added, removed, and changed',
    'Baseline advancement'
  ])assert.match(readiness,new RegExp(requirement,'i'));
  assert.match(readiness,/does not calculate, store, sync, or display/i);
  assert.doesNotMatch(html,/lastSeenTrainerRevision|trainerChangeSummary|advanceTrainerBaseline/);
});

test('frontend consolidation preserves disabled feature boundaries',()=>{
  assert.match(shareVisibility,/SHARE_VISIBILITY_MODEL_ENABLED:false/);
  assert.match(trainerPreferences,/SYNCED_TRAINER_PREFERENCES_ENABLED:false/);
});
