const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installShareApplication}=require('./helpers/share-application.cjs');
const primary=page=>page.locator('#product-share-primary');
test('pointer-selected radio retains a keyboard continuation point',async({page},testInfo)=>{
  await installShareApplication(page);await page.evaluate(()=>openProductShare('text'));
  const states=[];const record=async label=>states.push({label,...await page.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName,checked:document.activeElement.checked}))});
  await page.locator('#share-scope-top').click();await record('click');
  await expect(page.locator('#share-scope-top')).toBeFocused();
  await page.keyboard.press('Tab');await record('Tab');await expect(page.locator('#share-text-plain')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await record('Shift+Tab');
  testInfo.annotations.push({type:'focus-sequence',description:JSON.stringify(states)});
  await expect(page.locator('#share-scope-top')).toBeFocused();
});
async function providerFixture(page){
  await page.addInitScript(()=>{window.__POGO_PROVIDER_CAPABILITIES__={providerPublicWriteSupport:true,providerPublicReadSupport:true};});
  await installShareApplication(page);
  await page.evaluate(()=>{
    activeCanonicalIdentity={uid:auth.currentUser.uid,username:cur,identityKind:'provider_only',legacyAccessConfigured:false};
    allData.users[cur].lastUpdated=1700000000000;
    __shareTest.transactions=[];__shareTest.runtimeState={pendingCount:0,blockedCount:0,conflictCount:0};
    ref=(_db,path)=>{if(path!=='trainerShares/synthetic-share-owner')throw Error('Unexpected provider path '+path);return path;};
    runTransaction=async(path,update)=>{
      const value=update(__shareTest.stored);__shareTest.transactions.push({path,value});
      if(__shareTest.holdWrite)await new Promise(resolve=>__shareTest.resolveWrite=resolve);
      if(value===undefined)return{committed:false};
      __shareTest.stored=structuredClone(value);return{committed:true};
    };
    managedAccountSyncRuntime={ownerUid:auth.currentUser.uid,username:cur,projectionReady:true,
      snapshot:async()=>structuredClone(__shareTest.runtimeState),
      // The sync-runtime seam supplies its already-hydrated projection. The real
      // provider transaction/readback verifier and frontend adapter run below.
      publishCurrentProjection:async()=>{
        const session=providerPublicProjectionSession();
        if(!session)throw Error('Provider publication is not enabled');
        const built=publicShareSnapshotForUser(cur);if(!built.ok)return built;
        try{return await writeProviderPublicShareSnapshot(session,built.snapshot);}
        catch(error){__shareTest.providerError={message:error.message,code:error.code,snapshot:built.snapshot,capabilities:PROVIDER_CAPABILITIES};throw error;}
      }};
    openProductShare();
  });
}

test('provider frontend verifies UID-rooted readback and recovery retries copy only',async({page})=>{
  await providerFixture(page);
  expect(await page.evaluate(()=>[__shareTest.transactions.length,__shareTest.writes.length])).toEqual([0,0]);
  await page.evaluate(()=>{__shareTest.clipboardFails=true;__shareTest.holdWrite=true;void copyShareLink();void copyShareLink();});
  await expect.poll(()=>page.evaluate(()=>__shareTest.transactions.length)).toBe(1);
  expect(await page.evaluate(()=>__shareTest.copies.length)).toBe(0);
  await page.evaluate(()=>__shareTest.resolveWrite());
  expect(await page.evaluate(()=>__shareTest.providerError)).toBeUndefined();
  await expect(page.locator('#share-manual-link')).toBeVisible();
  const manual=await page.locator('#share-public-url').inputValue();expect(manual).toContain('view=LocalTrainer');
  expect(await page.locator('#share-public-url').evaluate(el=>el.readOnly&&el.selectionEnd===el.value.length)).toBe(true);
  await page.evaluate(()=>{__shareTest.clipboardFails=false;__shareTest.holdWrite=false;});await primary(page).click();
  expect(await page.evaluate(()=>[__shareTest.transactions.length,__shareTest.reads.length,__shareTest.writes.length,__shareTest.copies.length])).toEqual([1,1,0,2]);
  await expect(page.locator('#share-manual-link')).toBeHidden();
  await primary(page).click(); // Exact no-change provider reconciliation is valid.
  expect(await page.evaluate(()=>__shareTest.transactions.at(-1).value)).toBeUndefined();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopied');
  await page.evaluate(()=>__shareTest.readbackMismatch=true);await primary(page).click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.shareFailed');
  await expect(page.locator('#share-public-url')).toHaveValue('');
  expect(await page.evaluate(()=>__shareTest.copies.length)).toBe(3);
  expect(await page.evaluate(()=>JSON.stringify(__shareTest.stored))).not.toContain('PRIVATE_');
});

test('provider runtime replacement during a requested publication rejects the old continuation',async({page})=>{
  await providerFixture(page);
  await page.evaluate(()=>{
    const old=managedAccountSyncRuntime;
    old.publishCurrentProjection=()=>new Promise(resolve=>__shareTest.finishOldRuntime=resolve);
    void copyShareLink();
  });
  await expect.poll(()=>page.evaluate(()=>!!__shareTest.finishOldRuntime)).toBe(true);
  await page.evaluate(()=>{
    managedAccountSyncRuntime={...managedAccountSyncRuntime,snapshot:async()=>({pendingCount:1})};
    accountSyncRuntimeGeneration++;
    __shareTest.finishOldRuntime({ok:true,status:'published'});
  });
  await expect(primary(page)).toBeEnabled();
  expect(await page.evaluate(()=>__shareTest.copies.length)).toBe(0);
  await expect(page.locator('#share-public-url')).toHaveValue('');
});

test('recovery is invalidated by locale, options, runtime loss and hydration failure',async({page})=>{
  await providerFixture(page);await page.evaluate(()=>__shareTest.clipboardFails=true);await primary(page).click();
  await expect(page.locator('#share-manual-link')).toBeVisible();
  await page.evaluate(()=>changeInterfaceLocale('de'));
  await expect(page.locator('#share-manual-link')).toBeHidden();await expect(page.locator('#share-link-status')).toBeEmpty();
  expect(await page.evaluate(()=>__shareTest.transactions.length)).toBe(1);
  await primary(page).click();await expect(page.locator('#share-manual-link')).toBeVisible();
  await page.locator('[data-share-mode=text]').click();await page.locator('#share-scope-top').check();await page.locator('[data-share-mode=link]').click();
  await expect(page.locator('#share-manual-link')).toBeHidden();
  expect(await page.evaluate(()=>__shareTest.transactions.length)).toBe(2);
  await primary(page).click();await expect(page.locator('#share-manual-link')).toBeVisible();
  await page.evaluate(()=>{managedAccountSyncRuntime=null;accountSyncRuntimeGeneration++;});await primary(page).click();
  await expect(page.locator('#share-public-url')).toHaveValue('');
  expect(await page.evaluate(()=>__shareTest.copies.length)).toBe(3);
  await page.evaluate(()=>managedPublicSharePublication.markFailed(activePublicShareHydrationToken,'wishlist'));
  await primary(page).click();await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notReady');
  expect(await page.evaluate(()=>__shareTest.transactions.length)).toBe(3);
});

test('pending provider saves block a fresh action and a clipboard-only retry',async({page})=>{
  await providerFixture(page);await page.evaluate(()=>__shareTest.runtimeState.pendingCount=1);await primary(page).click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notSaved');
  expect(await page.evaluate(()=>[__shareTest.transactions.length,__shareTest.copies.length])).toEqual([0,0]);
  await page.evaluate(()=>{__shareTest.runtimeState.pendingCount=0;__shareTest.clipboardFails=true;});await primary(page).click();
  await expect(page.locator('#share-manual-link')).toBeVisible();
  await page.evaluate(()=>__shareTest.runtimeState.conflictCount=1);await primary(page).click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notSaved');
  await expect(page.locator('#share-public-url')).toHaveValue('');
  expect(await page.evaluate(()=>[__shareTest.transactions.length,__shareTest.copies.length])).toEqual([1,1]);
});

test('current selection command clears after deselection while row focus remains stable',async({page})=>{
  await installShareApplication(page);
  const result=await page.evaluate(()=>{
    const row=document.querySelector('#combined-list .wants-row'),button=row.querySelector('button');button.focus();renderMyList();
    const stable=document.querySelector('#combined-list .wants-row')===row&&document.activeElement===button;
    const index=combinedGroups().findIndex(group=>group[0].name==='Pikachu');selectCombinedGroup(index,true);
    const command=document.querySelector('#combined-search [data-wants-copy]')?.dataset.wantsCopy;
    selectCombinedGroup(index,false);
    return{stable,command,after:document.querySelector('#combined-search [data-wants-copy]')?.dataset.wantsCopy,hidden:document.getElementById('combined-search').hidden};
  });
  expect(result.stable).toBe(true);expect(result.command).toBe('!4*&!traded&CP-2500&!shadow&!purified&!background&xxl&xxs&25');
  expect(result.after).toBeUndefined();expect(result.hidden).toBe(true);
});

test('current recipient sections retain full protected commands through collapse and paging',async({page})=>{
  await installShareApplication(page);
  await page.evaluate(()=>{
    allData.users.Recipient={};allData.wishlist.Recipient={Pikachu:'H',Gengar:'H[shiny]',Snorlax:'[xxl]'};
    document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');renderShareView('Recipient','wishlist');
    __shareTest.recipientBefore=JSON.stringify(allData);
  });
  const high=page.locator('#share-list-out [data-want-section="H"]');
  const command='!4*&!traded&CP-2500&!shadow&!purified&!background&25,94';
  await high.locator('[data-contextual-copy]').click();expect(await page.evaluate(()=>__shareTest.copies.at(-1))).toBe(command);
  await expect(high.locator('.share-pcard-flag.shiny')).toHaveCount(1);
  await high.locator('[data-recipient-section-action=toggle]').click();await expect(high.locator('.share-pcard')).toHaveCount(0);
  await high.locator('[data-contextual-copy]').click();expect(await page.evaluate(()=>__shareTest.copies.at(-1))).toBe(command);
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__shareTest.recipientBefore));
  await high.locator('[data-recipient-section-action=toggle]').click();
  await page.evaluate(()=>{allData.wishlist.Recipient=Object.fromEntries(Array.from({length:999},(_,i)=>['Synthetic '+i,'H']));allData.wishlist.Recipient.Mewtwo='H';renderShareView('Recipient','wishlist');});
  const full='!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&150';
  await expect(high.locator('.share-pcard')).toHaveCount(80);await expect(high.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy',full);
  await high.locator('[data-recipient-section-action=more]').click();await expect(high.locator('.share-pcard')).toHaveCount(160);
  await expect(high.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy',full);
});

test('native clipboard availability and actual local text copying',async({page,context,browserName,browser},testInfo)=>{
  await installShareApplication(page);
  if(browserName==='chromium')await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.evaluate(browserName=>{delete navigator.clipboard;delete document.execCommand;allData.users[cur].intentDeclarations[0].note='Native clipboard proof '+browserName+' '+crypto.randomUUID();openProductShare('text');},browserName);
  const available=await page.evaluate(()=>typeof navigator.clipboard?.readText==='function');
  // An engine's permission/user-activation limitations are reported, not mocked
  // into a successful native result. The app's ordinary copy handler is real.
  await primary(page).click();
  const result=await page.evaluate(async()=>{
    let value='',error='';try{value=await Promise.race([navigator.clipboard.readText(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Native paste permission not granted within 1500ms')),1500))]);}catch(e){error=e.name+': '+e.message;}
    return{value,error,status:document.getElementById('share-link-status').textContent,expected:productShareUi.output};
  });
  const dir=process.env.SHARE_HARDENING_OUTPUT;
  if(dir){fs.mkdirSync(path.join(dir,testInfo.project.name),{recursive:true});fs.writeFileSync(path.join(dir,testInfo.project.name,'native-clipboard.json'),JSON.stringify({browser:browser.version(),available,...result},null,2));}
  if(browserName==='chromium'){expect(result.error).toBe('');expect(result.value).toBe(result.expected);expect(result.status).toBe('Copied.');}
  else{testInfo.annotations.push({type:'native-clipboard',description:result.error||'Native readback matched'});if(!result.error)expect(result.value).toBe(result.expected);}
});
