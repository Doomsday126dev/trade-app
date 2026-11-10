'use strict';
const {test,expect}=require('@playwright/test');
const {install,edit,addDialog,priority}=require('./helpers/want-editor-application.cjs');
const {enableLocalBackgrounds}=require('./helpers/background-local.cjs');
test.use({serviceWorkers:'block'});

async function preserveOlderCopies(page){
  await page.evaluate(async()=>{
    for(let i=0;i<10;i++)await managedAccountSyncRuntime.recordRecoveryCandidate({reason:'historical-device-value',entityType:'favorite',entityId:'unresolved:earlier-'+i,identity:{displayName:'Earlier '+i,unresolved:true},values:{displayName:'Earlier '+i},source:'background-review-test'});
    renderMyList();refreshSyncUi();
  });
  await expect.poll(()=>page.evaluate(()=>accountSyncUiState.state)).toBe('review-required');
  return page.evaluate(()=>managedAccountSyncRuntime.listRecoveryCandidates());
}
async function backgroundRows(page){return page.evaluate(()=>backgroundV2PrototypeAdapter.list(auth.currentUser.uid));}
async function selectBackground(page,value){
  await page.locator('#combined-preferences summary').click();
  const id=value??await page.locator('#combined-background option').nth(1).getAttribute('value');
  await page.locator('#combined-background').selectOption(id);
}

test('healthy old-copy reviews do not strand either direction of background conversion',async({page})=>{
  await install(page,null,{backgroundRollout:false});await enableLocalBackgrounds(page);
  const reviews=await preserveOlderCopies(page);
  const source=await page.evaluate(()=>accountSyncCanonicalEntities.find(e=>e.identity.catalogId.endsWith(':Pikachu')&&!e.deleted));
  await edit(page,'Pikachu');await selectBackground(page);
  await expect(page.locator('#combined-save')).toBeEnabled();await page.locator('#combined-save').click();
  await expect(page.locator('#combined-editor-modal')).toBeHidden();
  await expect(page.locator('#background-recovery')).toBeHidden();
  expect(await backgroundRows(page)).toHaveLength(1);
  expect(await page.evaluate(id=>managedAccountSyncRuntime.controller.getEntity('tradeEntry',id).deleted,source.entityId)).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('background-transition-v1:'+auth.currentUser.uid))).toBe(null);
  expect(await page.evaluate(()=>managedAccountSyncRuntime.listRecoveryCandidates())).toEqual(reviews);

  await edit(page,'Pikachu');await selectBackground(page,'');await page.locator('#combined-save').click();
  await expect(page.locator('#combined-editor-modal')).toBeHidden();await expect(page.locator('#background-recovery')).toBeHidden();
  expect(await backgroundRows(page)).toHaveLength(0);
  expect(await page.evaluate(id=>managedAccountSyncRuntime.controller.getEntity('tradeEntry',id).deleted,source.entityId)).toBe(false);
  expect(await page.evaluate(()=>managedAccountSyncRuntime.listRecoveryCandidates())).toEqual(reviews);
  await expect.poll(()=>page.evaluate(()=>accountSyncUiState.state)).toBe('review-required');
});

test('overlapping preserved trade still prevents retirement and keeps recoverable copies',async({page})=>{
  await install(page,null,{backgroundRollout:false});await enableLocalBackgrounds(page);
  const source=await page.evaluate(async()=>{
    const source=accountSyncCanonicalEntities.find(e=>e.identity.catalogId.endsWith(':Pikachu')&&!e.deleted);
    await managedAccountSyncRuntime.recordRecoveryCandidate({reason:'historical-device-value',entityType:'tradeEntry',entityId:source.entityId,identity:source.identity,values:{...source.values,note:'Preserved older note'},source:'background-review-test'});
    renderMyList();refreshSyncUi();return source;
  });
  const reviews=await page.evaluate(()=>managedAccountSyncRuntime.listRecoveryCandidates());
  await edit(page,'Pikachu');await selectBackground(page);await page.locator('#combined-save').click();
  await expect(page.locator('#combined-error')).not.toBeEmpty();await expect(page.locator('#combined-save')).toBeEnabled();
  expect(await page.evaluate(id=>managedAccountSyncRuntime.controller.getEntity('tradeEntry',id),source.entityId)).toEqual(source);
  expect(await backgroundRows(page)).toHaveLength(1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('background-transition-v1:'+auth.currentUser.uid)).error)).toBe('account-sync/entity-review-required');
  await page.locator('#combined-close').click();await page.getByRole('button',{name:'Retry saved draft',exact:true}).click();
  expect(await page.evaluate(id=>managedAccountSyncRuntime.controller.getEntity('tradeEntry',id),source.entityId)).toEqual(source);
  expect(await page.evaluate(()=>managedAccountSyncRuntime.listRecoveryCandidates())).toEqual(reviews);
  await expect(page.locator('#background-recovery')).toBeVisible();
});

test('third shiny Groudon background remains addable with ten unrelated older copies',async({page})=>{
  await install(page,null,{backgroundRollout:false});await enableLocalBackgrounds(page);
  const reviews=await preserveOlderCopies(page);
  for(const id of ['lc-go-fest-2026-chicago','lc-go-fest-2026-copenhagen','lc-go-fest-2026-tokyo']){
    await addDialog(page,'Groudon');await priority(page,'H');await page.locator('#combined-shiny').check();await selectBackground(page,id);
    await expect(page.locator('#combined-save')).toBeEnabled();await page.locator('#combined-save').click();
    await expect(page.locator('#combined-editor-modal')).toBeHidden();
  }
  expect(await backgroundRows(page)).toHaveLength(3);
  expect(await page.evaluate(()=>managedAccountSyncRuntime.listRecoveryCandidates())).toEqual(reviews);
  await expect(page.locator('#background-recovery')).toBeHidden();
});
