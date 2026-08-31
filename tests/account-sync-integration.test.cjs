const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const worker=readFileSync(path.join(root,'sw.js'),'utf8');
const controller=readFileSync(path.join(root,'js/data/accountSyncController.js'),'utf8');
const runtime=readFileSync(path.join(root,'js/data/accountSyncRuntime.js'),'utf8');
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
  const releaseId=html.match(/window\.__POGO_RELEASE_ID='([^']+)'/)?.[1];
  assert.ok(releaseId,'active release id');
  const modules=[
    'js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/domain/accountSyncMigration.js','js/domain/accountSyncProduct.js',
    'js/data/accountSyncJournal.js','js/data/accountSyncRepository.js','js/data/accountSyncController.js','js/data/accountSyncRuntime.js'
  ];
  for(const module of modules){assert.match(html,new RegExp(`<script src="${module.replaceAll('.','\\.')}\\?v=${releaseId.replaceAll('.','\\.')}"></script>`),module);assert.ok(worker.includes(`'${module}'`),module);}
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
  const apply=dispatch.indexOf('executeAuthorizedMutation(()=>repository.applyOperation'),acknowledge=dispatch.indexOf('await journal.acknowledge'),project=dispatch.indexOf('await publishAcceptedProjection');
  assert.ok(apply>=0);assert.ok(acknowledge>=0);assert.ok(project>=0);assert.ok(apply<acknowledge);assert.ok(acknowledge<project);assert.match(dispatch,/listenerAuthorityCurrent\(canonical\.authority\).*await journal\.acknowledge/s);
  const publish=controller.slice(controller.indexOf('async function publishAcceptedProjection'),controller.indexOf('async function activate'));
  const projection=publish.indexOf('model.publicTradeProjection'),publication=publish.indexOf('executeAuthorizedMutation(()=>onProjection');assert.ok(projection>=0);assert.ok(publication>=0);assert.ok(projection<publication);assert.match(publish,/listenerAuthorityCurrent\(authority\).*executeAuthorizedMutation\(\(\)=>onProjection/s);
  for(const privateField of ['fieldRevisions','fieldMutations','fieldMutationHashes','lifecycleMutation','operationId','recoveryCandidates','migrations'])assert.doesNotMatch(publish,new RegExp(`onProjection\\([^)]*${privateField}`));
  assert.match(controller,/catch\(error\)\{lastProjectionError=/);
});

test('entity, direct watched, and public projection writes retain operation-specific authority contracts',()=>{
  const dispatch=controller.slice(controller.indexOf('async function dispatch'),controller.indexOf('async function drain'));
  assert.match(dispatch,/executeAuthorizedMutation\(\(\)=>repository\.applyOperation/);
  assert.match(dispatch,/acceptCanonicalResult\(result\.value,record\.operation,authority\)/);

  const watched=controller.slice(controller.indexOf('function runAuthorizedWatchedMutation'),controller.indexOf('function waitForListenerReady'));
  assert.match(watched,/const binding=listenerAuthority\(\)/);
  assert.match(watched,/await repository\.readAccount\(\)/);
  assert.match(watched,/acceptedSnapshot\(account\)/);
  assert.match(watched,/await reconcile\(/);

  assert.equal((runtime.match(/controller\.runAuthorizedWatchedMutation\(\{/g)||[]).length,3);
  for(const method of ['createMigration','createRecoveryCandidate','updateMeta'])assert.match(runtime,new RegExp(`write:\\(\\)=>repository\\.${method}\\(`));
  assert.doesNotMatch(runtime,/runAuthorizedMutation/);

  const publish=controller.slice(controller.indexOf('async function publishAcceptedProjection'),controller.indexOf('function handleListenerData'));
  assert.match(publish,/executeAuthorizedMutation\(\(\)=>onProjection/);
  assert.doesNotMatch(publish,/readAccount|runAuthorizedWatchedMutation/);
});

test('normal sync copy is understandable and never exposes raw revision or mutation IDs',()=>{
  const conflictFieldKeys=['fieldGender','fieldLucky','fieldXxl','fieldXxs','fieldShiny','fieldOrder','fieldQuantity','fieldNotes','fieldMirror'];
  for(const file of ['en','ja','es','de']){
    const locale=readFileSync(path.join(root,`js/i18n/locales/${file}.js`),'utf8');
    for(const key of ['accountSync.saved','accountSync.saving','accountSync.offline','accountSync.conflict','accountSync.reviewRequired','accountSync.reviewRequiredDetail','accountSync.error','accountSync.retrySavedChange','accountSync.restartSync','accountSync.reviewConflict','accountSync.recoveryRunning','accountSync.diagnostic','accountSync.preservedReviewTitle','accountSync.preservedReviewDetail','accountSync.useSavedAccountCopy','accountSync.preservedReviewPrompt','accountSync.preservedReviewSucceeded','accountSync.preservedReviewFailed','accountSync.preservedReviewUnavailable'])assert.ok(locale.includes(`'${key}'`),`${file}:${key}`);
    for(const key of conflictFieldKeys)assert.ok(locale.includes(`'accountSync.${key}'`),`${file}:accountSync.${key}`);
    const copy=(locale.match(/'accountSync\.[^\n]+/)||[])[0]||'';assert.doesNotMatch(copy,/operationId|field revision|tombstone|RTDB|Firebase UID/i,file);
  }
  const status=html.slice(html.indexOf('function accountSyncPresentation()'),html.indexOf('function syncLabelForStatus'));
  assert.doesNotMatch(status,/operationId|revision|mutation/i);
  const detail=html.slice(html.indexOf('async function openSyncDetail()'),html.indexOf('function accountSyncConflictFieldLabel'));
  assert.match(detail,/account\.plan\.action!=='none'.*requestAccountSyncRecovery/s);assert.match(detail,/account\.plan\.action==='review-conflict'.*reviewAccountSyncConflicts/s);
  assert.ok(detail.indexOf("account.plan.action!=='none'")<detail.indexOf("account.state==='review-required'"));
  assert.match(detail,/coordinator\.active.*coordinator\.recover/s);assert.match(detail,/performAccountSyncRecovery/);assert.doesNotMatch(detail,/retryBlocked/);
  assert.match(html,/id="sync-pill"[^>]+onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/);
  assert.match(html,/id="trainer-sync-diagnostic" hidden/);assert.match(html,/id="trainer-sync-recovery"[^>]+requestAccountSyncRecovery\(\)/);
  assert.match(html,/id="trainer-sync-preserved-review" hidden/);assert.match(html,/id="trainer-sync-preserved-review-action"[^>]+useSavedAccountCopyForPreservedReview\(\)/);
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

test('Special Trade Board edits mutate a detached copy and render only after journal success',()=>{
  const read=html.slice(html.indexOf('function getSpecialBoard()'),html.indexOf('async function writeSpecialBoard'));
  assert.match(read,/accountSyncClone\(\{lf:/);assert.doesNotMatch(read,/return\{lf:Array\.isArray\(b\?\.lf\)\?b\.lf/);
  for(const [start,end] of [['async function removeSpecialEntry','async function toggleSpecialFlag'],['async function toggleSpecialFlag','async function clearSpecialBoard']]){
    const action=html.slice(html.indexOf(start),html.indexOf(end));
    assert.match(action,/if\(!await writeSpecialBoard\(board\)\)return;\s*renderSpecialBoard\(\)/);
  }
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

test('recovery presentation is bound to session, coordinator, and runtime generations',()=>{
  const reset=html.slice(html.indexOf('function resetSessionTransientUi'),html.indexOf('function resetTransientUiBeforeSessionActivation'));
  const activation=html.slice(html.indexOf('function activateOwnedSession'),html.indexOf('function storedSessionMatches'));
  const suspension=html.slice(html.indexOf('function suspendOwnedSession'),html.indexOf('function showSessionStorageNotices'));
  const recovery=html.slice(html.indexOf('function accountSyncRecoveryStatus'),html.indexOf('async function recordAccountSyncUnresolved'));
  assert.match(reset,/invalidateAccountSyncRecovery\(reason\)/);
  assert.match(activation,/invalidateAccountSyncRecovery\('session_activation'\)/);
  assert.match(suspension,/invalidateAccountSyncRecovery\(reason\)/);
  assert.match(suspension,/invalidateAccountSyncRecovery\('logout'\)/);
  assert.match(recovery,/accountSyncRecoveryPresentationBinding\(binding,runtimeGeneration=accountSyncRuntimeGeneration\)/);
  assert.match(recovery,/binding\.uid.*binding\.username.*binding\.sessionGeneration.*binding\.coordinatorGeneration.*runtimeGeneration/s);
  assert.match(recovery,/accountSyncRecoveryStateBinding===accountSyncRecoveryPresentationBinding\(accountSyncRecoverySessionBinding\)/);
  assert.match(recovery,/accountSyncRecoveryCoordinatorRuntimeGeneration===accountSyncRuntimeGeneration/);
  assert.match(recovery,/accountSyncRecoveryCoordinatorRuntimeGeneration!==accountSyncRuntimeGeneration/);
  assert.match(recovery,/healthySnapshot\([^)]*accountSyncUiState/s);
  assert.match(recovery,/accountSyncRecoveryState=accountSyncIdleRecoveryState\(\);accountSyncRecoveryStateBinding=''/);
});

test('unsafe canonical state outranks conflict presentation and conflict actions recheck authority',()=>{
  assert.match(controller,/const state=!eligible\?'local-only':unsafeEvidence\?'sync-error':journalState\.conflictCount\?'conflict'/);
  assert.match(controller,/listenerHealthy=!eligible\|\|active&&listenerState==='healthy'/);
  assert.doesNotMatch(controller,/\['listening','healthy'\]\.includes\(listenerState\)/);
  assert.match(controller,/async function acceptConflict\(conflictId\)\{\s*const authority=await snapshot\(\)/);
  assert.match(controller,/async function reapplyConflict\(conflictId\)\{\s*const authority=await snapshot\(\)/);
  const review=html.slice(html.indexOf('async function reviewAccountSyncConflicts'),html.indexOf('let _modalPrevFocus'));
  assert.match(review,/const plan=accountSyncCurrentRecoveryPlan\(\)/);
  assert.match(review,/plan\.category==='unsafe-evidence'\|\|plan\.action!=='review-conflict'/);
});

test('fieldless lifecycle conflicts expose saved-copy-only review instead of a dead-end toast',()=>{
  const review=html.slice(html.indexOf('async function reviewAccountSyncConflicts'),html.indexOf('let _modalPrevFocus'));
  assert.match(review,/const reviewPlan=accountSyncConflictReviewPlan\(details\)/);
  assert.match(review,/reviewPlan\.fieldless\.map/);
  assert.match(review,/accountSync\.itemState/);
  assert.match(review,/accountSync\.earlierDeviceAction/);
  assert.match(review,/accountSync\.currentSavedItem/);
  assert.match(review,/reviewPlan\.canReapply\?async\(\)=>/);
  assert.match(review,/savedOnly:!reviewPlan\.canReapply/);
  const modal=html.slice(html.indexOf('function showConflictModal'),html.indexOf('// ── IMPORT FROM SEARCH STRING'));
  assert.match(modal,/\{savedOnly=false\}=\{\}/);
  assert.match(modal,/const canKeepDevice=typeof onLocal==='function'&&!savedOnly/);
  assert.match(modal,/canKeepDevice\?`<button[^`]+conflict\.keepDevice/);
  assert.match(modal,/if\(canKeepDevice\)document\.getElementById/);
});

test('preserved device changes expose an exact owner-confirmed saved-copy review without replay or remote mutation',()=>{
  const readiness=html.slice(html.indexOf('function accountSyncPreservedReviewReady'),html.indexOf('function accountSyncProjectionReady'));
  assert.match(readiness,/runtime\?\.projectionReady===true/);assert.match(readiness,/runtime\.ownerUid===auth\?\.currentUser\?\.uid/);assert.match(readiness,/snapshot\?\.state==='review-required'/);
  assert.match(readiness,/snapshot\?\.listenerHealthy===true/);assert.match(readiness,/snapshot\?\.controllerHealthy===true/);assert.match(readiness,/Number\(snapshot\?\.recoveryCandidateCount\)>0/);
  const authority=html.slice(html.indexOf('async function accountSyncPreservedReviewAuthority'),html.indexOf('function accountSyncProjectionReady'));
  assert.match(authority,/snapshot\.state!=='review-required'/);assert.match(authority,/runtime\.listRecoveryCandidates\(\)/);assert.match(authority,/candidates\.length!==Number\(snapshot\.recoveryCandidateCount\)/);
  assert.match(authority,/candidate\?\.ownerUid!==authority\.uid/);assert.match(authority,/candidate\?\.resolved===true/);assert.match(authority,/sessionGeneration:_sessionTransientGeneration/);assert.match(authority,/runtimeGeneration:accountSyncRuntimeGeneration/);
  const action=html.slice(html.indexOf('async function useSavedAccountCopyForPreservedReview'),html.indexOf('async function requestAccountSyncRecovery'));
  assert.match(action,/confirm\(i18nCore\.t\('accountSync\.preservedReviewPrompt'/);assert.match(action,/accountSyncPreservedReviewAuthorityCurrent\(authority\)/);
  assert.match(action,/authority\.runtime\.completeRecoveryReviews\(authority\.candidateIds\)/);assert.match(action,/accountSyncUiState\.state!=='saved'/);assert.match(action,/accountSyncUiState\.recoveryCandidateCount!==0/);
  assert.match(action,/applyAccountSyncCanonicalEntities\(Object\.freeze\(authority\.controller\.activeEntities\(\)\)\)/);
  assert.doesNotMatch(action,/retryBlocked|addEntity|updateEntity|removeEntity|mutateBatch|repository\.|writeList|writeSpecialBoard|toggleFavorite/);
  const runtimeReview=runtime.slice(runtime.indexOf('async function completeRecoveryReviews'),runtime.indexOf('function stop'));
  assert.match(runtimeReview,/before\.state!=='review-required'/);assert.match(runtimeReview,/before\.listenerHealthy/);assert.match(runtimeReview,/before\.controllerHealthy/);assert.match(runtimeReview,/before\.recoveryCandidateCount!==ids\.length/);
  assert.match(runtimeReview,/journal\.resolveRecoveryCandidates\(ids\)/);assert.match(runtimeReview,/after\.state!=='saved'/);
  const recovery=html.slice(html.indexOf('function getAccountSyncRecoveryCoordinator'),html.indexOf('async function recordAccountSyncUnresolved'));
  assert.match(recovery,/if\(!started\?\.ok&&!accountSyncPreservedReviewReady\(\)\)throw/);
  const request=html.slice(html.indexOf('async function requestAccountSyncRecovery'),html.indexOf('function updateSyncUi'));
  assert.match(request,/result\.category==='review-required'/);assert.match(request,/openAccountSettingsSection\('data'/);
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
  assert.match(favoriteWrite,/if\(!targetUid\)\{toast\(i18nCore\.t\('organizer\.favoriteSyncUnavailable'/);
  assert.ok(favoriteWrite.indexOf('if(!targetUid)')<favoriteWrite.indexOf('authority.controller.addEntity'));
  assert.doesNotMatch(favoriteWrite,/recordUnresolvedFavorite|saveFavoriteOrganization\(username\).*favorite-add/s);
  assert.doesNotMatch(favoriteWrite,/managedAccountSyncRuntime\?\.controller/);

  const favoriteReview=html.slice(html.indexOf('async function accountSyncFavoriteReviewAuthority'),html.indexOf('function accountSyncProjectionReady'));
  assert.match(favoriteReview,/\['review-required','saved'\]\.includes\(state\)/);assert.match(favoriteReview,/runtime\.projectionReady===true/);
  assert.match(favoriteReview,/accountSyncUiState=await runtime\.snapshot\(\)/);assert.doesNotMatch(favoriteReview,/ensureAccountSyncRuntime\(\)/);
  assert.match(favoriteReview,/listenerHealthy===true/);assert.match(favoriteReview,/controllerHealthy===true/);
  assert.match(favoriteReview,/!Number\(accountSyncUiState\?\.pendingCount\).*!Number\(accountSyncUiState\?\.blockedCount\).*!Number\(accountSyncUiState\?\.conflictCount\)/s);

  const favoriteRemove=html.slice(html.indexOf('async function removeTrainerFavorite'),html.indexOf('function organizerMessage'));
  assert.match(favoriteRemove,/favorite\?\.targetUid\?await accountSyncMutationAuthority\(\):await accountSyncFavoriteReviewAuthority\(\)/);
  assert.match(favoriteRemove,/authority\.mode==='canonical-review'.*completeUnresolvedFavoriteReview/s);
  assert.match(favoriteRemove,/completeUnresolvedFavoriteReview[\s\S]*store\.toggleFavorite/);
  assert.doesNotMatch(favoriteRemove,/recordRecoveryCandidate|controller\.addEntity/);

  const favoriteReviewCompletion=html.slice(html.indexOf('async function completeUnresolvedFavoriteReview'),html.indexOf('async function queueFavoriteTags'));
  assert.match(favoriteReviewCompletion,/listRecoveryCandidates\(\{unresolvedOnly:false\}\)/);
  assert.match(favoriteReviewCompletion,/favorite-uid-unresolved/);assert.match(favoriteReviewCompletion,/entityType==='favorite'/);
  assert.match(favoriteReviewCompletion,/recovery-evidence-missing/);assert.match(favoriteReviewCompletion,/if\(item\.resolved===true\)continue/);
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
