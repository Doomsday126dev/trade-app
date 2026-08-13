const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

function between(startMarker,endMarker){
  const start=html.indexOf(startMarker),end=html.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0&&end>start,`Unable to extract ${startMarker}`);
  return html.slice(start,end);
}

test('SEC-01 anonymous requests render through text nodes and bound listeners',()=>{
  const render=between('function renderPendingRequests()','async function approveRequest(');
  assert.match(render,/listEl\.replaceChildren/);
  assert.match(render,/name\.append\('🎮 ',username\)/);
  assert.match(render,/note\.textContent=/);
  assert.match(render,/approve\.addEventListener\('click',\(\)=>approveRequest\(id,username\)\)/);
  assert.match(render,/deny\.addEventListener\('click',\(\)=>denyRequest\(id\)\)/);
  assert.doesNotMatch(render,/innerHTML|insertAdjacentHTML|onclick|onerror|onload/);
});

test('SEC-01 approved-login result keeps persisted identity values out of HTML',()=>{
  const approve=between('async function approveRequest(','async function copyApprovedLogin(');
  assert.match(approve,/card\.replaceChildren\(\)/);
  assert.match(approve,/strong\.textContent=username/);
  assert.match(approve,/pinValue\.textContent=pin/);
  assert.match(approve,/copy\.addEventListener\('click',\(\)=>copyApprovedLogin\(username,pin\)\)/);
  assert.doesNotMatch(approve,/card\.innerHTML|onclick=/);
});

test('SEC-03 active trainer and Admin actions do not interpolate identity data into JavaScript',()=>{
  const favorites=between('async function renderTrainerQuickLists()','function toggleTrainerFavorite(');
  const admin=between('function adminUserRows()','async function repairAccount(');
  const share=between('function publicShareAction(event)','// Body — render in same style');
  const safeTransfer=between('function renderSafeTransferTrainers()','function toggleSafeTransferTrainer(');
  assert.match(favorites,/data-trainer-action="open"/);
  assert.match(favorites,/data-trainer-action="organize"/);
  assert.match(favorites,/data-trainer-action="remove"/);
  assert.doesNotMatch(favorites,/onclick="(?:openTrainerByName|openTrainerOrganizer|openFavoriteTagsFromMenu|removeTrainerFavorite)\('/);
  assert.match(admin,/data-admin-user-action="(?:toggle-role|reset|repair)"/);
  assert.doesNotMatch(admin,/onclick="(?:toggleAdmin|openReset|repairAccount|repairLoginDirectory)\('/);
  assert.match(share,/data-share-action="(?:favorite|list)"/);
  assert.doesNotMatch(share,/onclick="(?:toggleTrainerFavorite|renderShareView)\('/);
  assert.match(safeTransfer,/data-safe-transfer-trainer=/);
  assert.match(safeTransfer,/addEventListener\('click'/);
  assert.doesNotMatch(safeTransfer,/onclick=/);
});

test('DATA-01 production has no restore action, callable restore entrypoint, or whole-root write',()=>{
  assert.equal(html.includes('id="restore-file"'),false);
  assert.equal(html.includes("openSettingsTool('restore')"),false);
  assert.doesNotMatch(html,/function\s+(?:triggerRestore|restoreData|validatedBackupPayload|seedFirebase)\b/);
  assert.doesNotMatch(html,/set\s*\(\s*ref\s*\(\s*db\s*,\s*['"]\/?['"]\s*\)/);
  assert.match(html,/const PRODUCTION_ROOT_RESTORE_ENABLED=false/);
  const exposed=between('Object.assign(window,{','// ── BOOT');
  assert.doesNotMatch(exposed,/triggerRestore|restoreData/);
});

test('DATA-01 safe backup export remains available and non-destructive',()=>{
  const markup=between('data-admin-section="maintenance"','data-admin-section="diagnostics"');
  const implementation=between('function exportData()','function renderSecurityPanel()');
  assert.match(markup,/onclick="exportData\(\)"/);
  assert.match(markup,/admin\.exportBackup/);
  assert.doesNotMatch(markup,/restore-file|restoreData|triggerRestore|admin\.restoreBackup/);
  assert.match(implementation,/new Blob\(\[JSON\.stringify\(s,null,2\)\]/);
  assert.match(implementation,/a\.download=`pogo-backup-/);
  assert.doesNotMatch(implementation,/\b(?:set|update|remove)\s*\(\s*ref\s*\(/);
});

test('SEC-03 retired Inventory and Offers handlers have no supported UI entrypoint',()=>{
  const inventoryMarkup=between('<!-- HAVE (Inventory) -->','<!-- SCHEDULE -->');
  const inventoryRender=between('function renderMyHave(filterVal)','function exportLegacyInventoryCsv()');
  assert.match(html,/const LEGACY_INVENTORY_READ_ONLY=true/);
  assert.match(html,/SEC-03 dead-code backlog: remove the retired Inventory edit\/browse\/Offers/);
  assert.doesNotMatch(inventoryMarkup,/have-browse-view|have-toggle-btn|openOfferModal|openIncomingOffersModal|submitOfferAction/);
  assert.match(inventoryRender,/if\(LEGACY_INVENTORY_READ_ONLY\)[\s\S]*?return;[\s\S]*?openIncomingOffersModal/);
  assert.match(html,/function openLegacyInventoryTool\(\)\{closeAccountMenu\(false\);switchTab\('have'\);\}/);
  assert.match(html,/action==='have'\)\{finalTab='have';switchTab\(finalTab,\{render:false\}\);\}/);
});
