const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const worker=readFileSync(path.join(root,'sw.js'),'utf8');
const controller=readFileSync(path.join(root,'js/data/accountSyncController.js'),'utf8');
const product=readFileSync(path.join(root,'js/domain/accountSyncProduct.js'),'utf8');

test('owner-only migration reads are explicitly registered in the Firebase source contract',()=>{
  const window={};
  vm.runInNewContext(readFileSync(path.join(root,'js/data/firebaseReadRegistry.js'),'utf8'),{window});
  const {READ_SURFACES,SOURCE_CALL_CONTRACT}=window.PogoData.firebaseReadRegistry;
  const migration=READ_SURFACES.find(surface=>surface.id==='account_sync_migration_reads');
  assert.deepEqual(JSON.parse(JSON.stringify(migration)),{
    id:'account_sync_migration_reads',
    path:'wishlist/{currentUsername} + dynamax/{currentUsername} + gmax/{currentUsername} + costumes/{currentUsername} + users/{currentUsername}',
    method:'get',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['account_sync_migration'],status:'transitional'
  });
  assert.equal(SOURCE_CALL_CONTRACT.directGetCount,14);
  assert.equal(SOURCE_CALL_CONTRACT.needles.find(item=>item.text==='get(ref(db,path))')?.count,2);
  assert.equal(SOURCE_CALL_CONTRACT.needles.find(item=>item.text.includes('Reading account sync migration source timed out'))?.count,1);
  const source=html.slice(html.indexOf('async function accountSyncReadLegacySources'),html.indexOf('function accountSyncEncodedPriority'));
  assert.match(source,/const paths=\[\.\.\.OWNED_MY_LIST_TYPES\.map\(type=>`\$\{type\}\/\$\{username\}`\),`users\/\$\{username\}`\]/);
  assert.match(source,/paths\.map\(path=>withTimeout\(get\(ref\(db,path\)\),8000/);
});

test('cross-device sync is limited to one domain-separated owner hash and remains inert for every other account',()=>{
  assert.match(html,/const ACCOUNT_SYNC_ROLLOUT=Object\.freeze\(\{enabled:true,writesEnabled:true,allowlistedUidHashes:Object\.freeze\(\['eb5f8130f7def5bab89d84e339e8f46787a33222ff407aa56b1807a835b180c1'\]\),featureVersion:1\}\)/);
  const start=html.slice(html.indexOf('async function ensureAccountSyncRuntime()'),html.indexOf('async function recordAccountSyncUnresolved'));
  assert.ok(start.indexOf('const eligible=await accountSyncRolloutEligible(uid)')<start.indexOf('createAccountSyncJournal'));
  assert.ok(start.indexOf('if(!eligible)')<start.indexOf('createAccountSyncRepository'));
  assert.match(html,/\[accountSyncModel\.SCHEMA_VERSION,'pogo-account-sync-rollout-owner',owner\]/);
  assert.doesNotMatch(accountSyncRolloutSource(html),/allowlistedUids|Doomsday126|pogotrades\.nyc/);
  assert.doesNotMatch(html,/accountSyncRolloutEligible\([^)]*\)\s*\|\|\s*true/);
});

function accountSyncRolloutSource(source){return source.slice(source.indexOf('const ACCOUNT_SYNC_ROLLOUT='),source.indexOf('let managedAccountSyncRuntime='));}

test('every account sync runtime module is versioned in HTML and included in the offline app shell',()=>{
  const modules=[
    'js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/domain/accountSyncMigration.js','js/domain/accountSyncProduct.js',
    'js/data/accountSyncJournal.js','js/data/accountSyncRepository.js','js/data/accountSyncController.js','js/data/accountSyncRuntime.js'
  ];
  for(const module of modules){assert.match(html,new RegExp(`<script src="${module.replaceAll('.','\\.')}\\?v=2026-08-26\\.70"></script>`),module);assert.ok(worker.includes(`'${module}'`),module);}
});

test('canonical sync scope includes current product lanes and excludes retired inventory authorities',()=>{
  assert.match(product,/MY_LIST_LANES=Object\.freeze\(\['wishlist','dynamax','gmax','costumes'\]\)/);
  assert.match(product,/SPECIAL_BOARD_LANES=Object\.freeze\(\{lf:'looking-for',ft:'for-trade'\}\)/);
  assert.doesNotMatch(product,/['"](?:have|inventory|offers|trades|pendingDecrements)['"]/);
  const migrationRead=html.slice(html.indexOf('async function accountSyncReadLegacySources'),html.indexOf('function accountSyncEncodedPriority'));
  assert.doesNotMatch(migrationRead,/(?:^|[`'"/])have\//m);
  assert.doesNotMatch(migrationRead,/(?:inventory|offers|pendingDecrements)/);
});

test('private acknowledgement precedes public projection and projection excludes sync internals',()=>{
  const dispatch=controller.slice(controller.indexOf('async function dispatch'),controller.indexOf('async function drain'));
  assert.ok(dispatch.indexOf('await repository.applyOperation')<dispatch.indexOf('await publishAcceptedProjection'));
  assert.ok(dispatch.indexOf('await journal.acknowledge')<dispatch.indexOf('await publishAcceptedProjection'));
  const publish=controller.slice(controller.indexOf('async function publishAcceptedProjection'),controller.indexOf('async function activate'));
  assert.ok(publish.indexOf('model.publicTradeProjection')<publish.indexOf('await onProjection'));
  for(const privateField of ['fieldRevisions','fieldMutations','fieldMutationHashes','lifecycleMutation','operationId','recoveryCandidates','migrations'])assert.doesNotMatch(publish,new RegExp(`onProjection\\([^)]*${privateField}`));
  assert.match(controller,/catch\(error\)\{lastProjectionError=/);
});

test('normal sync copy is understandable and never exposes raw revision or mutation IDs',()=>{
  const conflictFieldKeys=['fieldGender','fieldLucky','fieldXxl','fieldXxs','fieldShiny','fieldOrder','fieldQuantity','fieldNotes','fieldMirror'];
  for(const file of ['en','ja','es','de']){
    const locale=readFileSync(path.join(root,`js/i18n/locales/${file}.js`),'utf8');
    for(const key of ['accountSync.saved','accountSync.saving','accountSync.offline','accountSync.conflict','accountSync.reviewRequired','accountSync.reviewRequiredDetail','accountSync.error','accountSync.retrySavedChange','accountSync.restartSync','accountSync.reviewConflict','accountSync.recoveryRunning','accountSync.diagnostic'])assert.ok(locale.includes(`'${key}'`),`${file}:${key}`);
    for(const key of conflictFieldKeys)assert.ok(locale.includes(`'accountSync.${key}'`),`${file}:accountSync.${key}`);
    const copy=(locale.match(/'accountSync\.[^\n]+/)||[])[0]||'';assert.doesNotMatch(copy,/operationId|field revision|tombstone|RTDB|Firebase UID/i,file);
  }
  const status=html.slice(html.indexOf('function accountSyncPresentation()'),html.indexOf('function syncLabelForStatus'));
  assert.doesNotMatch(status,/operationId|revision|mutation/i);
  const detail=html.slice(html.indexOf('async function openSyncDetail()'),html.indexOf('function accountSyncConflictFieldLabel'));
  assert.match(detail,/account\.plan\.action!=='none'.*requestAccountSyncRecovery/s);assert.match(detail,/account\.plan\.action==='review-conflict'.*reviewAccountSyncConflicts/s);
  assert.match(detail,/coordinator\.active.*coordinator\.recover/s);assert.match(detail,/performAccountSyncRecovery/);assert.doesNotMatch(detail,/retryBlocked/);
  assert.match(html,/id="sync-pill"[^>]+onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/);
  assert.match(html,/id="trainer-sync-diagnostic" hidden/);assert.match(html,/id="trainer-sync-recovery"[^>]+requestAccountSyncRecovery\(\)/);
  assert.match(html,/onCanonicalEntities:entities=>currentSession\(\)\?applyAccountSyncCanonicalEntities\(entities\):false/);
  const fieldLabels=html.slice(html.indexOf('function accountSyncConflictFieldLabel'),html.indexOf('function accountSyncConflictValue'));
  for(const key of conflictFieldKeys)assert.ok(fieldLabels.includes(`accountSync.${key}`),key);
  assert.doesNotMatch(fieldLabels,/gender:'Gender'|sortOrder:'Order'|quantity:'Quantity'|note:'Notes'|mirror:'Mirror'/);
});

test('My List drag order and priority moves journal canonical sortOrder before local persistence',()=>{
  const reorder=html.slice(html.indexOf('async function reorderMyListEntry'),html.indexOf('function moveMyListEntry'));
  assert.match(reorder,/writeAccountSyncList\(myListType,list,\{orderModel:model,authority\}\)/);assert.ok(reorder.indexOf('writeAccountSyncList')<reorder.indexOf('persistMyListOrder'));
  const move=html.slice(html.indexOf('async function movePriority'),html.indexOf('function dragEnd'));
  assert.match(move,/writeList\(myListType,cur,list,\{orderModel:model\}\)/);assert.ok(move.indexOf('writeList')<move.indexOf('persistMyListOrder'));
});

test('Special Trade Board edits mutate a detached copy and restore UI after journal failure',()=>{
  const read=html.slice(html.indexOf('function getSpecialBoard()'),html.indexOf('async function writeSpecialBoard'));
  assert.match(read,/accountSyncClone\(\{lf:/);assert.doesNotMatch(read,/return\{lf:Array\.isArray\(b\?\.lf\)\?b\.lf/);
  const note=html.slice(html.indexOf('async function setSpecialNote'),html.indexOf('async function setSpecialQty'));
  assert.match(note,/if\(!await writeSpecialBoard\(board\)\)renderSpecialBoard\(\)/);
});

test('tag creation and Favorite assignment are journaled as one atomic product action',()=>{
  const action=html.slice(html.indexOf('async function createLocalTrainerTag'),html.indexOf('function trainerTagInputKeydown'));
  assert.match(action,/controller\.mutateBatch\(\[/);
  assert.match(action,/entityType:'tag'.*kind:'add'/s);
  assert.match(action,/entityType:'favorite'.*kind:'patch'/s);
  assert.doesNotMatch(action,/controller\.addEntity/);
});

test('auth transitions invalidate stale sync starts before publishing account state',()=>{
  const stop=html.slice(html.indexOf('function stopAccountSyncRuntime()'),html.indexOf('async function ensureAccountSyncRuntime'));
  const start=html.slice(html.indexOf('async function ensureAccountSyncRuntime()'),html.indexOf('async function recordAccountSyncUnresolved'));
  assert.ok(stop.indexOf('accountSyncRuntimeGeneration++')<stop.indexOf('runtime.stop()'));
  assert.match(start,/generation===accountSyncRuntimeGeneration/);
  assert.match(start,/auth\?\.currentUser\?\.uid===uid&&cur===username/);
  assert.match(start,/if\(!currentSession\(\)\)\{await runtime\.stop\(\);return Object\.freeze\(\{ok:false,status:'session-changed'\}\);\}/);
});

test('allowlisted mutations cannot fall through to legacy writers while canonical startup is pending',()=>{
  const authority=html.slice(html.indexOf('async function accountSyncMutationAuthority'),html.indexOf('function accountSyncProjectionReady'));
  assert.match(authority,/await ensureAccountSyncRuntime\(\)/);
  assert.match(authority,/started\?\.ok&&accountSyncProjectionReady\(\).*mode:'canonical',uid,username,runtime,controller:runtime\.controller/s);
  assert.match(authority,/authority\.runtime===managedAccountSyncRuntime/);
  assert.match(authority,/authority\.controller===authority\.runtime\?\.controller/);
  assert.match(authority,/mode:'blocked'/);

  const listWrite=html.slice(html.indexOf('async function writeList('),html.indexOf('async function writeListItem'));
  assert.ok(listWrite.indexOf('await accountSyncMutationAuthority()')<listWrite.indexOf('queueListEntryDiff'));
  assert.match(listWrite,/authority\.mode==='blocked'.*return false/s);
  assert.match(listWrite,/authority\.mode==='canonical'.*writeAccountSyncList/s);

  const boardWrite=html.slice(html.indexOf('async function writeSpecialBoard'),html.indexOf('let _specialAcFocus'));
  assert.ok(boardWrite.indexOf('await accountSyncMutationAuthority()')<boardWrite.indexOf('writeAccountSyncSpecialBoard'));
  assert.match(boardWrite,/authority\.mode==='blocked'.*return false/s);

  const favoriteWrite=html.slice(html.indexOf('async function toggleTrainerFavorite'),html.indexOf('function showFavoriteSavedPrompt'));
  assert.ok(favoriteWrite.indexOf('await accountSyncMutationAuthority()')<favoriteWrite.indexOf('controller.addEntity'));
  assert.match(favoriteWrite,/authority\.mode==='blocked'/);
  assert.match(favoriteWrite,/authority\.controller\.addEntity/);
  assert.doesNotMatch(favoriteWrite,/managedAccountSyncRuntime\?\.controller/);
});

test('canonical product mutations remain bound to the exact authenticated runtime captured before the write',()=>{
  const authority=html.slice(html.indexOf('async function accountSyncMutationAuthority'),html.indexOf('function accountSyncProjectionReady'));
  assert.match(authority,/const uid=auth\?\.currentUser\?\.uid,username=cur/);
  assert.match(authority,/uid!==auth\?\.currentUser\?\.uid\|\|username!==cur/);
  assert.match(authority,/runtime\?\.ownerUid===uid&&runtime\?\.controller/);
  assert.match(authority,/authority\.uid===auth\?\.currentUser\?\.uid&&authority\.username===cur/);

  const listWrite=html.slice(html.indexOf('async function writeAccountSyncList'),html.indexOf('async function writeListItem'));
  assert.match(listWrite,/const runtime=authority\?\.runtime\|\|managedAccountSyncRuntime,controller=authority\?\.controller\|\|runtime\?\.controller/);
  assert.match(listWrite,/authority&&!accountSyncAuthorityCurrent\(authority\)/);
  assert.match(listWrite,/applyAccountSyncTradeMutations\(mutations,controller\)/);
  assert.doesNotMatch(listWrite,/managedAccountSyncRuntime\?\.controller/);

  const boardWrite=html.slice(html.indexOf('async function writeSpecialBoard'),html.indexOf('let _specialAcFocus'));
  assert.match(boardWrite,/writeAccountSyncSpecialBoard\(board,\{authority\}\)/);
  assert.match(boardWrite,/!result\?\.ok\|\|!accountSyncAuthorityCurrent\(authority\)/);
  const tagWrite=html.slice(html.indexOf('async function createLocalTrainerTag'),html.indexOf('function trainerTagInputKeydown'));
  assert.match(tagWrite,/authority\.controller\.mutateBatch/);
  assert.match(tagWrite,/!queued\?\.ok\|\|!accountSyncAuthorityCurrent\(authority\)/);
});

test('legacy list and board queue entries are held for migration and retired only after canonical startup',()=>{
  const flush=html.slice(html.indexOf('async function flushSyncQueue'),html.indexOf('function showSyncDot'));
  assert.match(flush,/canonicalOwnsLegacy=await accountSyncRolloutEligible/);
  assert.ok(flush.indexOf('accountSyncMigratedLegacyQueueItem')<flush.indexOf('await update(ref(db,item.path),item.data)'));
  assert.ok(flush.indexOf('accountSyncQueuedProfileBoardItem')<flush.indexOf('await update(ref(db,item.path),item.data)'));
  const retired=html.slice(html.indexOf('function retireMigratedLegacyListQueue'),html.indexOf('function stopAccountSyncRuntime'));
  assert.match(retired,/accountSyncRetainedLegacyQueueEntries\(key,item,cur\)/);
  const runtimeStart=html.slice(html.indexOf('async function ensureAccountSyncRuntime'),html.indexOf('async function recordAccountSyncUnresolved'));
  assert.ok(runtimeStart.indexOf('await runtime.start()')<runtimeStart.indexOf('retireMigratedLegacyListQueue()'));
});

test('legacy queue retirement preserves the board source and converts unrelated profile fields to child updates',()=>{
  const start=html.indexOf('function accountSyncMigratedLegacyQueueItem'),end=html.indexOf('function accountSyncMarkMutationBlocked'),source=html.slice(start,end),context={cur:'Owner',OWNED_MY_LIST_TYPES:['wishlist','dynamax','gmax','costumes'],sessionCacheBoundaryData:{MY_LIST_UPDATE_KIND:'my-list-update'}};
  vm.runInNewContext(`${source}\nthis.retained=accountSyncRetainedLegacyQueueEntries;`,context);
  const profile={kind:'set',path:'users/Owner',data:{friendCode:'1234 5678 9012',wallpaper:'mono',specialTradeBoard:{lf:[],ft:[{name:'Pikachu'}]}},ts:123};
  assert.deepEqual(JSON.parse(JSON.stringify(context.retained('users/Owner',profile,'Owner'))),[
    ['users/Owner/friendCode',{kind:'set',path:'users/Owner/friendCode',data:'1234 5678 9012',ts:123}],
    ['users/Owner/wallpaper',{kind:'set',path:'users/Owner/wallpaper',data:'mono',ts:123}]
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.retained('users/Owner/specialTradeBoard',{path:'users/Owner/specialTradeBoard',data:{lf:[],ft:[]}},'Owner'))),[]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.retained('users/Owner',{path:'users/Owner',data:{specialTradeBoard:{lf:[],ft:[]}}},'Owner'))),[]);
  const foreign={path:'users/Another',data:{specialTradeBoard:{lf:[],ft:[]}}};
  assert.equal(context.retained('users/Another',foreign,'Owner')[0][1],foreign);
});

test('allowlisted profile writes preserve the legacy board before and after canonical migration',()=>{
  const writeUser=html.slice(html.indexOf('async function writeUser(u,data)'),html.indexOf('function canWriteLoginDirectoryNow'));
  assert.ok(writeUser.indexOf('await accountSyncPreserveLegacyBoard(u)')<writeUser.indexOf('saveLocal(s)'));
  assert.match(writeUser,/preserveLegacyBoard\)queueAccountSyncProfileFields\(u,s\.users\[u\]\)/);
  const writeNow=html.slice(html.indexOf('async function writeUserNow'),html.indexOf('async function writeUserStrict'));
  assert.match(writeNow,/preserveLegacyBoard\?update\(ref\(db,`users\/\$\{u\}`\),profileValue\):set/);
  assert.match(writeNow,/acknowledgeAccountSyncProfileFields\(u,profileValue\)/);
  const profileHelpers=html.slice(html.indexOf('function accountSyncQueuedProfileBoardItem'),html.indexOf('function accountSyncMarkMutationBlocked'));
  assert.match(profileHelpers,/delete fields\.specialTradeBoard/);
  assert.doesNotMatch(profileHelpers,/queueSync\(`users\/\$\{name\}`,fields\)/);
});

test('profile acknowledgement cannot erase a newer queued field value',()=>{
  const start=html.indexOf('function accountSyncQueuedProfileBoardItem'),end=html.indexOf('function accountSyncMarkMutationBlocked'),source=html.slice(start,end);
  const canonicalJson=value=>JSON.stringify(value,Object.keys(value&&typeof value==='object'?value:{}).sort());
  const context={accountSyncClone:value=>structuredClone(value),accountSyncModel:{canonicalJson},syncQueue:{
    'users/Owner/friendCode':{kind:'set',path:'users/Owner/friendCode',data:'newer',ts:200},
    'users/Owner/wallpaper':{kind:'set',path:'users/Owner/wallpaper',data:'mono',ts:100}
  }};
  vm.runInNewContext(`${source}\nthis.acknowledge=acknowledgeAccountSyncProfileFields;`,context);
  context.acknowledge('Owner',{friendCode:'older',wallpaper:'mono'});
  assert.equal(context.syncQueue['users/Owner/friendCode'].data,'newer');
  assert.equal(context.syncQueue['users/Owner/wallpaper'],undefined);
});
