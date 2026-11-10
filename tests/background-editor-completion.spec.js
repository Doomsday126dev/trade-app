const {test,expect}=require('@playwright/test');
const {install,addDialog,edit,priority,settled}=require('./helpers/want-editor-application.cjs');
const {enableLocalBackgrounds}=require('./helpers/background-local.cjs');

test.use({serviceWorkers:'block'});
const modal='#combined-editor-modal';
const groudonBackground='lc-go-fest-2026-chicago';

async function setup(page){
  await install(page,null,{backgroundRollout:false});
  await enableLocalBackgrounds(page);
}
async function prepareBackgroundAdd(page){
  await addDialog(page,'Groudon');
  await page.locator('#combined-shiny').check();
  await page.locator('#combined-preferences summary').click();
  await page.locator('#combined-background').selectOption(groudonBackground);
}
async function seedBackground(page){
  await prepareBackgroundAdd(page);
  await page.locator('#combined-save').click();
  await expect(page.locator(modal)).toBeHidden();
}
// Delay one service response, not the editor or persistence implementation.
// Capture its result first so releasing it is independent of a later save's reads.
async function holdPublicationRead(page){
  await page.evaluate(()=>{
    const original=get,path='publicShares/'+cur;
    window.__backgroundCompletionRead={held:false,returned:false,finished:false};
    const publish=publishSavedBackgroundChange;
    publishSavedBackgroundChange=async(...args)=>{
      try{return await publish(...args);}
      finally{__backgroundCompletionRead.finished=true;}
    };
    get=async target=>{
      const snapshot=await original(target);
      if(target===path&&!__backgroundCompletionRead.held){
        __backgroundCompletionRead.held=true;
        await new Promise(resolve=>window.__releaseBackgroundCompletionRead=resolve);
        __backgroundCompletionRead.returned=true;
      }
      return snapshot;
    };
  });
}
async function held(page){
  await expect.poll(()=>page.evaluate(()=>__backgroundCompletionRead.held)).toBe(true);
  expect(await page.evaluate(()=>__backgroundCompletionRead.returned)).toBe(false);
}
async function releasePublicationRead(page){
  await page.evaluate(async()=>{
    __releaseBackgroundCompletionRead();
    // Allow the delayed response and its consumer's promise continuations to run.
    await new Promise(resolve=>requestAnimationFrame(resolve));
  });
  await expect.poll(()=>page.evaluate(()=>__backgroundCompletionRead.finished)).toBe(true);
}
// Hold the result of the actual authority check, rather than every transport
// read: the earlier publication must remain free to finish independently.
async function holdNextAuthority(page){
  await page.evaluate(()=>{
    const original=accountSyncMutationAuthority;
    accountSyncMutationAuthority=async(...args)=>{
      const result=await original(...args);
      accountSyncMutationAuthority=original;
      window.__newEditorAuthorityReady=true;
      await new Promise(resolve=>window.__releaseNewEditorAuthority=resolve);
      return result;
    };
  });
}
async function backgroundState(page){
  return page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot());
}

for(const operation of ['add','edit','remove']){
  test(`durable background ${operation} completes without waiting for optional public-share read`,async({page})=>{
    await setup(page);
    if(operation==='add')await prepareBackgroundAdd(page);
    else{
      await seedBackground(page);
      await edit(page,'Groudon');
      if(operation==='edit')await priority(page,'L');
    }
    await holdPublicationRead(page);
    await page.locator(operation==='remove'?'#wants-remove':'#combined-save').click();
    await held(page);
    const state=await backgroundState(page);
    expect(state.pending).toBe(null);
    expect(state.entries).toHaveLength(operation==='remove'?0:1);
    if(operation==='edit')expect(state.entries[0].priority).toBe('L');
    try{
      await expect(page.locator(modal)).toBeHidden({timeout:1500});
      await expect(page.locator('.wants-row[data-name="Groudon"]')).toHaveCount(operation==='remove'?0:1);
      expect(await page.evaluate(()=>__backgroundCompletionRead.returned)).toBe(false);
    }finally{await releasePublicationRead(page);}
  });
}

test('durable plain-to-background conversion completes before its optional publication read',async({page})=>{
  await setup(page);
  await edit(page,'Pikachu');
  await page.locator('#combined-preferences summary').click();
  const background=await page.locator('#combined-background option').nth(1).getAttribute('value');
  await page.locator('#combined-background').selectOption(background);
  await holdPublicationRead(page);
  await page.locator('#combined-save').click();
  await held(page);
  const proof=await page.evaluate(()=>({
    transition:localStorage.getItem('background-transition-v1:'+auth.currentUser.uid),
    background:backgroundOwnerRuntime.repository.snapshot(),
    source:accountSyncCanonicalEntities.find(e=>e.entityType==='tradeEntry'&&e.identity.catalogId===accountSyncCatalogIdentity('wishlist','Pikachu').catalogId)
  }));
  expect(proof.transition).toBe(null);
  expect(proof.background.pending).toBe(null);
  expect(proof.background.entries).toHaveLength(1);
  expect(proof.source.deleted).toBe(true);
  try{
    await expect(page.locator(modal)).toBeHidden({timeout:1500});
    await expect(page.locator('.wants-row[data-name="Pikachu"]')).toHaveCount(1);
    expect(await page.evaluate(()=>__backgroundCompletionRead.returned)).toBe(false);
  }finally{await releasePublicationRead(page);}
});

test('late background publication cannot close a newer editor or unlock its in-flight save',async({page})=>{
  await setup(page);
  await prepareBackgroundAdd(page);
  await holdPublicationRead(page);
  await page.locator('#combined-save').click();
  await held(page);
  expect((await backgroundState(page)).entries).toHaveLength(1);
  // Also reaches the stale-completion assertions on versions that leave the old
  // modal open. Closing here does not undo the already committed background.
  if(await page.locator(modal).isVisible())await page.keyboard.press('Escape');
  await addDialog(page,'Squirtle');
  await priority(page,'H');
  await holdNextAuthority(page);
  await page.locator('#combined-save').click();
  await expect.poll(()=>page.evaluate(()=>!!window.__newEditorAuthorityReady)).toBe(true);
  await expect(page.locator('#combined-save')).toBeDisabled();
  try{
    await releasePublicationRead(page);
    await expect.soft(page.locator(modal)).toBeVisible({timeout:1500});
    await expect.soft(page.locator('#combined-save')).toBeDisabled({timeout:1500});
    await expect(page.locator('#combined-name')).toHaveValue('Squirtle');
    await expect(page.locator('#combined-error')).toBeEmpty();
  }finally{
    await page.evaluate(()=>__releaseNewEditorAuthority());
  }
  await expect(page.locator(modal)).toBeHidden();
  await settled(page);
  await expect(page.locator('.wants-row[data-name="Squirtle"]')).toHaveCount(1);
});

test('a publication response from the previous session cannot affect a restarted session editor',async({page})=>{
  await setup(page);
  await prepareBackgroundAdd(page);
  await holdPublicationRead(page);
  await page.locator('#combined-save').click();
  await held(page);
  expect((await backgroundState(page)).entries).toHaveLength(1);
  await page.evaluate(async()=>{
    await stopAccountSyncRuntime();
    resetSessionTransientUi('background-completion-test-restart');
    await ensureAccountSyncRuntime();
    renderMyList();
  });
  await settled(page);
  await addDialog(page,'Squirtle');
  await priority(page,'H');
  const before=await page.evaluate(()=>structuredClone(__editorFixture.writes));
  await releasePublicationRead(page);
  await expect(page.locator(modal)).toBeVisible();
  await expect(page.locator('#combined-name')).toHaveValue('Squirtle');
  await expect(page.locator('#combined-save')).toBeEnabled();
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(before);
});

test('late failure after a background commit cannot change a newer in-flight editor',async({page})=>{
  await setup(page);
  await prepareBackgroundAdd(page);
  await page.evaluate(()=>{
    const original=backgroundV2PrototypeAdapter;
    backgroundV2PrototypeAdapter=Object.freeze({...original,async save(...args){
      await original.save(...args);
      window.__backgroundSaveCommitted=true;
      await new Promise((_resolve,reject)=>{
        window.__rejectBackgroundCompletion=()=>reject(Error('synthetic-late-save-failure'));
      });
    }});
  });
  await page.locator('#combined-save').click();
  await expect.poll(()=>page.evaluate(()=>!!window.__backgroundSaveCommitted)).toBe(true);
  expect((await backgroundState(page)).entries).toHaveLength(1);
  expect((await backgroundState(page)).pending).toBe(null);
  await page.keyboard.press('Escape');
  await addDialog(page,'Squirtle');
  await priority(page,'H');
  await holdNextAuthority(page);
  await page.locator('#combined-save').click();
  await expect.poll(()=>page.evaluate(()=>!!window.__newEditorAuthorityReady)).toBe(true);
  await expect(page.locator('#combined-save')).toBeDisabled();
  try{
    await page.evaluate(async()=>{
      __rejectBackgroundCompletion();
      await new Promise(resolve=>requestAnimationFrame(resolve));
    });
    await expect(page.locator(modal)).toBeVisible();
    await expect.soft(page.locator('#combined-save')).toBeDisabled({timeout:1500});
    await expect.soft(page.locator('#combined-error')).toBeEmpty({timeout:1500});
    await expect(page.locator('#combined-name')).toHaveValue('Squirtle');
  }finally{
    await page.evaluate(()=>__releaseNewEditorAuthority());
  }
  await expect(page.locator(modal)).toBeHidden();
  await settled(page);
  await expect(page.locator('.wants-row[data-name="Squirtle"]')).toHaveCount(1);
});

test('an existing public share catches up to newer backgrounds after an older publication write is delayed',async({page})=>{
  await setup(page);await seedBackground(page);
  const initial=await page.evaluate(async()=>{
    const built=publicShareSnapshotForUser(cur,getLocal(),'explicit_share',true);
    if(!built.ok)throw Error('base-not-ready');
    await writeVerifiedLegacyPublicSnapshot(cur,built.snapshot,{explicitBackgrounds:true});
    return structuredClone(__editorFixture.remote.publicShares[cur]);
  });
  expect(initial.version).toBe(3);expect(initial.backgroundRevision).toBe('r1');
  await page.evaluate(()=>{
    const original=set,path='publicShares/'+cur;
    window.__delayedExistingShare={writes:[],held:false};
    set=async(target,value)=>{
      if(target===path){
        if(!__delayedExistingShare.held){
          __delayedExistingShare.held=true;
          __delayedExistingShare.heldSnapshot=structuredClone(value);
          await new Promise(resolve=>window.__releaseExistingShareWrite=resolve);
        }
        __delayedExistingShare.writes.push(structuredClone(value));
      }
      return original(target,value);
    };
  });
  for(const id of ['lc-go-fest-2026-copenhagen','lc-go-fest-2026-tokyo']){
    await prepareBackgroundAdd(page);await page.locator('#combined-background').selectOption(id);
    await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>__delayedExistingShare.held)).toBe(true);
  }
  expect((await backgroundState(page)).entries).toHaveLength(3);
  expect(await page.evaluate(()=>__delayedExistingShare.heldSnapshot.backgroundRevision)).toBe('r2');
  expect(await page.evaluate(()=>__editorFixture.remote.publicShares[cur].backgroundRevision)).toBe('r1');
  await page.evaluate(()=>__releaseExistingShareWrite());
  await expect.poll(()=>page.evaluate(()=>__editorFixture.remote.publicShares[cur].backgroundRevision)).toBe('r3');
  await expect.poll(()=>page.evaluate(async()=>{
    const state=await managedAccountSyncRuntime.controller.snapshot();
    return state.lastProjectionError;
  })).toBe('');
  const published=await page.evaluate(async()=>{
    const snapshot=__editorFixture.remote.publicShares[cur];
    const rows=await BackgroundEditorAdapter.readV3({snapshot,readPublic:async path=>{
      const result=await get(path);return result.val();
    },validateEntries:backgroundOwnerRuntime.protocol.validate});
    return{snapshot:structuredClone(snapshot),backgrounds:rows.map(row=>row.backgroundId),writes:__delayedExistingShare.writes.map(value=>value.backgroundRevision),pending:backgroundOwnerRuntime.repository.snapshot().pending};
  });
  expect(published.snapshot.declarations).toEqual(initial.declarations);
  expect(published.backgrounds).toEqual([groudonBackground,'lc-go-fest-2026-copenhagen','lc-go-fest-2026-tokyo']);
  expect(published.writes).toEqual(['r2','r3']);expect(published.pending).toBe(null);
});
