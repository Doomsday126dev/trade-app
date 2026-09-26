const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {install,settled,addDialog,edit,priority,entities}=require('./helpers/want-editor-application.cjs');
test.use({serviceWorkers:'block'});
const modal='#combined-editor-modal';
async function save(page){await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();await settled(page);}
async function declarations(page){return page.evaluate(()=>productDeclarations().entries);}

test('ordinary quick add and independent special-only wants persist through IndexedDB reopen',async({page,context})=>{
  await install(page);
  await page.locator('#wants-add-name').fill('Charmander');await page.locator('[data-wants-add-priority="M"]').click();await page.locator('.wants-add-form [type="submit"]').click();
  await expect(page.locator(modal)).toBeHidden();await settled(page);await expect(page.locator('#wants-add-name')).toHaveValue('');
  await page.locator('[data-wants-add-priority="M"]').click();
  for(const [name,flag]of [['Squirtle','shiny'],['Bulbasaur','lucky'],['Eevee','xxl'],['Meowth','xxs']]){
    await addDialog(page,name);await expect(page.locator('#combined-editor-title')).toHaveText('Add want');await page.locator('#combined-'+flag).check();await save(page);
    expect((await declarations(page)).find(e=>e.name===name)).toMatchObject({p:'',[flag]:true});
  }
  expect((await declarations(page)).find(e=>e.name==='Charmander')).toMatchObject({p:'M'});
  const before=await entities(page),remote=await page.evaluate(()=>structuredClone(__editorFixture.remote));
  expect(remote.wishlist.LocalTrainer).toEqual({Pikachu:'H',Psyduck:'',Rotom:'M'});
  expect(remote.users.LocalTrainer.specialTradeBoard).toEqual(await page.evaluate(()=>__editorFixture.original));
  await page.evaluate(()=>stopAccountSyncRuntime());await page.close();
  const reopened=await context.newPage();await install(reopened,remote);expect(await entities(reopened)).toEqual(before);
});

test('grouped exact entries retain untouched data; saved notes appear in Share output',async({page})=>{
  await install(page);
  // Seed an exact alias through the real canonical mutation pipeline, not a
  // replacement save handler. Extra fields exercise unchanged-field retention.
  await page.evaluate(async()=>{
    const catalog=accountSyncCatalogIdentity('wishlist','Pikachu'),identity={surface:'my-list',lane:'looking-for',catalogId:catalog.catalogId};
    const a=await accountSyncMutationAuthority();
    const result=await applyAccountSyncTradeMutations([{kind:'add',entityType:'tradeEntry',entityId:accountSyncModel.tradeEntryId(identity),identity,values:{...accountSyncProduct.tradeValues({p:'H'}),quantity:3,sortOrder:17}}],a.controller);if(!result.ok)throw Error(JSON.stringify(result));
  });await settled(page);
  const before=await entities(page);await edit(page,'Pikachu');await priority(page,'L');await page.locator('#combined-shiny').check();await page.locator('#combined-lucky').check();
  await page.locator('#combined-mod').fill('Exact public qualifier');await page.locator('#combined-gender').selectOption('f');
  await page.locator('#combined-note-details summary').click();await page.locator('#combined-note').fill('First public line\nSecond exact line');await save(page);
  const after=await entities(page),changed=after.filter(e=>before.some(b=>b.entityId===e.entityId&&JSON.stringify(b)!==JSON.stringify(e)));
  expect(changed.length).toBeGreaterThanOrEqual(2);
  for(const entity of changed){expect(entity.values).toMatchObject({priority:'L',shiny:true,lucky:true,note:'First public line\nSecond exact line'});const old=before.find(e=>e.entityId===entity.entityId);for(const key of ['backgroundId','quantity','sortOrder','mirror'])expect(entity.values[key]).toEqual(old.values[key]);}
  expect(after.filter(e=>!changed.includes(e))).toEqual(before.filter(e=>!changed.some(x=>x.entityId===e.entityId)));
  await edit(page,'Pikachu');await expect(page.locator('#combined-note-details')).toHaveAttribute('open','');await expect(page.locator('#combined-note')).toHaveValue('First public line\nSecond exact line');
  await save(page);expect(await entities(page)).toEqual(after);
  await page.locator('.wants-list-toolbar').getByRole('button',{name:'Share',exact:true}).click();
  await page.locator('#product-share-tab-text').click();await expect(page.locator('#product-share-preview')).toContainText('Second exact line');
  await expect(page.locator('#product-share-modal')).not.toContainText('Changes since confirmation');
});

test('validation, durable-write failure and retry preserve the editable draft; removal keeps confirmation',async({page})=>{
  await install(page);const before=await entities(page);
  await addDialog(page,'Squirtle');await page.locator('#combined-save').click();await expect(page.locator('#combined-error')).toContainText('Choose a priority');
  await page.locator('#combined-xxl').check();await page.locator('#combined-xxs').check();await page.locator('#combined-save').click();await expect(page.locator('#combined-error')).not.toBeEmpty();expect(await entities(page)).toEqual(before);
  await page.locator('#combined-xxs').uncheck();
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='operations'){IDBObjectStore.prototype.put=put;throw new DOMException('Synthetic journal full','QuotaExceededError');}return put.apply(this,args);};});
  await page.locator('#combined-save').click();await expect(page.locator('#combined-error')).not.toBeEmpty();await expect(page.locator(modal)).toBeVisible();await expect(page.locator('#combined-save')).toBeEnabled();expect(await entities(page)).toEqual(before);
  // A real journal failure puts the existing runtime into sync-error. Its
  // established recovery boundary is a restarted runtime, not a fake success.
  await page.keyboard.press('Escape');await page.evaluate(async()=>{await stopAccountSyncRuntime();await ensureAccountSyncRuntime();});await settled(page);
  await addDialog(page,'Squirtle');await page.locator('#combined-xxl').check();await save(page);await edit(page,'Squirtle');await page.locator('#wants-remove').click();await expect(page.locator(modal)).toBeHidden();await settled(page);expect((await declarations(page)).some(e=>e.name==='Squirtle')).toBe(false);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('.wants-row[data-name="Rotom"] .myrow-remove').click();expect((await declarations(page)).some(e=>e.name==='Rotom')).toBe(true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('.wants-row[data-name="Rotom"] .myrow-remove').click();await settled(page);await expect(page.locator('.wants-row[data-name="Rotom"]')).toHaveCount(0);
});

test('cancel, stale runtime/session and repeated activation cannot commit the wrong draft',async({page})=>{
  await install(page);const before=await entities(page);
  await edit(page,'Rotom');await page.locator('#combined-mod').fill('Discard me');await page.locator('#combined-cancel').click();expect(await entities(page)).toEqual(before);
  for(const boundary of ['cancel','session','runtime']){
    await addDialog(page,'Squirtle');await priority(page,'H');
    await page.evaluate(()=>{__editorFixture.holdReads=true;});
    await page.locator('#combined-save').click();await expect(page.locator('#combined-save')).toBeDisabled();
    await expect.poll(()=>page.evaluate(()=>__editorFixture.readWaiters.length)).toBeGreaterThan(0);
    // Repeated activation reaches the actual handler while its first call waits.
    await page.evaluate(()=>saveCombinedEditor());
    if(boundary==='cancel')await page.keyboard.press('Escape');
    if(boundary==='session')await page.evaluate(()=>{_sessionTransientGeneration++;});
    if(boundary==='runtime')await page.evaluate(()=>stopAccountSyncRuntime());
    await page.evaluate(()=>{__editorFixture.holdReads=false;__editorFixture.readWaiters.splice(0).forEach(resolve=>resolve());});
    if(boundary!=='cancel'){await expect(page.locator('#combined-save')).toBeEnabled();await expect(page.locator('#combined-error')).not.toBeEmpty();await page.keyboard.press('Escape');}
    if(boundary!=='runtime')expect(await entities(page)).toEqual(before);
    await page.evaluate(async()=>{await stopAccountSyncRuntime();await ensureAccountSyncRuntime();});await settled(page);expect(await entities(page)).toEqual(before);
  }
  await addDialog(page,'Squirtle');await priority(page,'H');await page.locator('#combined-save').dblclick();await expect(page.locator(modal)).toBeHidden();await settled(page);
  expect((await declarations(page)).filter(e=>e.name==='Squirtle')).toHaveLength(1);
});

test('exact form, background and multiline legacy notes survive no-op and only requested edits',async({page})=>{
  await install(page);await addDialog(page,'Rotom (Frost)');await priority(page,'H');await page.locator('#combined-note-details summary').click();await page.locator('#combined-note').fill('Exact Frost form\nKeep both lines');await save(page);
  await page.evaluate(async()=>{const e=accountSyncCanonicalEntities.find(e=>accountSyncCatalogEntryForId(e.identity.catalogId)?.name==='Rotom (Frost)');const a=await accountSyncMutationAuthority();const result=await applyAccountSyncTradeMutations([{kind:'patch',entityType:'tradeEntry',entityId:e.entityId,patch:{backgroundId:'location-background',note:'Legacy CRLF\r\n'+('Complete older public note. '.repeat(4)),quantity:2,mirror:true}}],a.controller);if(!result.ok)throw Error(JSON.stringify(result));});await settled(page);
  const before=await entities(page);await page.locator('.wants-row[data-name="Rotom (Frost)"] .myrow-edit').click();await expect(page.locator('#combined-identity')).toContainText('Frost');await expect(page.locator('#combined-note-details')).toHaveAttribute('open','');await save(page);expect(await entities(page)).toEqual(before);
  await page.locator('.wants-row[data-name="Rotom (Frost)"] .myrow-edit').click();await priority(page,'M');await save(page);
  const after=await entities(page),old=before.find(e=>e.values.backgroundId==='location-background'),updated=after.find(e=>e.entityId===old.entityId);expect(updated.values).toEqual({...old.values,priority:'M'});
  await edit(page,'Psyduck');await save(page);await edit(page,'Psyduck');await page.locator('#combined-mod').fill('Retained legacy details');await save(page);expect((await declarations(page)).find(e=>e.name==='Psyduck')).toMatchObject({p:'',mod:'Retained legacy details'});
});

test('account change rejects an in-flight Add; offline save retains the existing durable pending boundary',async({page})=>{
  await install(page);await addDialog(page,'Squirtle');await priority(page,'H');const before=await entities(page);
  await page.evaluate(()=>{__editorFixture.holdReads=true;});await page.locator('#combined-save').click();await expect.poll(()=>page.evaluate(()=>__editorFixture.readWaiters.length)).toBeGreaterThan(0);
  await page.evaluate(()=>{window.__oldIdentity={cur,auth};auth={currentUser:{uid:'second-local-uid'}};cur='SecondLocal';activateOwnedSession('second-local-uid',cur);__editorFixture.holdReads=false;__editorFixture.readWaiters.splice(0).forEach(resolve=>resolve());});
  await expect(page.locator(modal)).toBeHidden();await expect(page.locator('#app')).not.toHaveAttribute('inert','');expect(await page.evaluate(()=>__editorFixture.writes.some(path=>path.includes('second-local-uid')))).toBe(false);
  await page.keyboard.press('Escape');await page.evaluate(async()=>{cur=__oldIdentity.cur;auth=__oldIdentity.auth;await stopAccountSyncRuntime();activateOwnedSession(auth.currentUser.uid,cur);await ensureAccountSyncRuntime();renderMyList();});await settled(page);
  await addDialog(page,'Squirtle');await priority(page,'H');await page.evaluate(()=>{__editorFixture.offline=true;});await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
  await expect.poll(()=>page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).pendingCount)).toBeGreaterThan(0);expect((await declarations(page)).some(e=>e.name==='Squirtle')).toBe(true);
  await page.evaluate(()=>{__editorFixture.offline=false;});await settled(page);expect((await declarations(page)).filter(e=>e.name==='Squirtle')).toHaveLength(1);
});

test('a completed journal write cannot close or reset a subsequently opened editor',async({page})=>{
  await install(page);await edit(page,'Rotom');await priority(page,'H');
  // Hold only delivery of the real IndexedDB commit-complete callback. The
  // transaction actually commits; cancellation must not pretend to undo it.
  await page.evaluate(()=>{const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){const transaction=this;descriptor.set.call(this,event=>{if(transaction.mode==='readwrite'&&transaction.objectStoreNames.contains('operations')&&transaction.objectStoreNames.contains('entities')){Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);window.__releaseEditorCommit=()=>handler.call(transaction,event);}else handler.call(transaction,event);});}});});
  await page.locator('#combined-save').click();await expect.poll(()=>page.evaluate(()=>typeof __releaseEditorCommit)).toBe('function');
  await page.keyboard.press('Escape');await addDialog(page,'Eevee');await page.locator('#combined-shiny').check();
  await page.evaluate(()=>__releaseEditorCommit());await settled(page);
  expect((await declarations(page)).find(e=>e.name==='Rotom')).toMatchObject({p:'H'});await expect(page.locator('#combined-editor-title')).toHaveText('Add want');await expect(page.locator('#combined-name')).toHaveValue('Eevee');await expect(page.locator('#combined-shiny')).toBeChecked();await expect(page.locator('#combined-save')).toBeEnabled();await expect(page.locator('#combined-error')).toBeEmpty();expect((await declarations(page)).some(e=>e.name==='Eevee')).toBe(false);
});

test('keyboard stays contained, native radio and checkbox selection work, Escape restores the trigger',async({page})=>{
  await install(page);await page.setViewportSize({width:390,height:520});
  const trigger=page.locator('.wants-row[data-name="Rotom"] .myrow-edit');await trigger.focus();await page.keyboard.press('Enter');await expect(page.locator('#combined-close')).toBeFocused();
  const visited=[];
  for(let i=0;i<16;i++){visited.push(await page.evaluate(()=>document.activeElement.id||document.activeElement.tagName));await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.querySelector('#combined-editor-modal').contains(document.activeElement))).toBe(true);}
  expect(visited).toEqual(expect.arrayContaining(['combined-close','combined-mod','combined-gender','combined-shiny','combined-lucky','combined-xxl','combined-xxs','SUMMARY','combined-save','combined-cancel','wants-remove']));
  while(!(await page.evaluate(()=>document.activeElement.type==='radio')))await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');await expect(page.locator('#combined-priority')).toHaveValue('L');await page.keyboard.press('Tab');await page.keyboard.press('Space');await expect(page.locator('#combined-shiny')).toBeChecked();
  while(!(await page.evaluate(()=>document.activeElement.tagName==='SUMMARY')))await page.keyboard.press('Tab');await page.keyboard.press('Enter');await page.keyboard.press('Tab');await expect(page.locator('#combined-note')).toBeFocused();await page.keyboard.type('Keyboard draft');
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(page.locator('#app')).not.toHaveAttribute('inert','');
  await trigger.press('Enter');await expect(page.locator('#combined-note')).toHaveValue('');await expect(page.locator('#combined-shiny')).not.toBeChecked();
});

test('localized Add and populated Edit fit desktop, narrow, short and enlarged-text layouts',async({page},info)=>{
  test.setTimeout(120000);await install(page);
  const out=process.env.WANT_EDITOR_OUTPUT_DIR||info.outputPath('review');fs.mkdirSync(out,{recursive:true});const measurements=[];
  for(const locale of ['en','ja','es','de'])for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await page.evaluate(async locale=>{await changeInterfaceLocale(locale);applyTheme('dark');},locale);await expect(page.locator('#toast')).toBeHidden();
    await addDialog(page,'Rotom');
    await page.screenshot({path:path.join(out,`add-${locale}-${width}.png`)});await page.keyboard.press('Escape');
    await page.locator('.wants-row[data-name="Rotom"] .myrow-edit').click();
    // Unsaved synthetic long draft; real persisted-note opening is covered above.
    await page.locator('#combined-mod').fill('Exact form — langer öffentlicher Zusatz / 長い条件');await page.locator('#combined-note-details summary').click();await page.locator('#combined-note').fill('Public note with exact details\nÖffentliche Notiz mit vollständigen Bedingungen.');
    await page.locator('#combined-shiny').check();await page.locator('#combined-lucky').check();
    const metric=await page.evaluate(()=>{const m=document.querySelector('#combined-editor-modal .modal'),b=m.querySelector('.want-editor-body'),r=m.getBoundingClientRect(),f=m.querySelector('footer').getBoundingClientRect();const overflow=[...m.querySelectorAll('label,button,legend,summary')].filter(e=>e.offsetParent).filter(e=>{const rect=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const text=range.getBoundingClientRect();return text.right>rect.right+1||text.left<rect.left-1;}).map(e=>e.id||e.textContent);return{width:innerWidth,locale:i18nCore.getLocale(),dialog:{x:r.x,width:r.width,height:r.height},footerBottom:f.bottom,bodyClient:b.clientHeight,bodyScroll:b.scrollHeight,pageOverflow:document.documentElement.scrollWidth>innerWidth,overflow};});
    measurements.push(metric);expect(metric.pageOverflow).toBe(false);expect(metric.overflow).toEqual([]);expect(metric.footerBottom).toBeLessThanOrEqual(900);await page.screenshot({path:path.join(out,`edit-${locale}-${width}.png`)});await page.keyboard.press('Escape');
  }
  for(const [name,width,height,theme,enlarged]of [['short',390,400,'dark',false],['light',390,900,'light',false],['system',1440,900,'auto',false],['enlarged',320,900,'dark',true]]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:'light'});await page.evaluate(({theme,enlarged})=>{applyTheme(theme);if(enlarged){const sizes=[...document.querySelectorAll('#combined-editor-modal :is(h3,label>span,legend,summary,input,select,textarea,button,strong)')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);document.documentElement.style.fontSize='200%';for(const [el,size]of sizes)el.style.fontSize=`${size*2}px`; }},{theme,enlarged});await addDialog(page,'Rotom');
    await expect(page.locator('#combined-save')).toBeInViewport();await expect(page.locator('#combined-close')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    const controls=await page.evaluate(()=>{const title=document.querySelector('#combined-editor-title'),header=title.parentElement.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(title);const text=range.getBoundingClientRect(),select=document.querySelector('#combined-gender'),s=getComputedStyle(select);return{titleTop:text.top,headerTop:header.top,titleBottom:text.bottom,headerBottom:header.bottom,selectInner:select.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom),selectLine:parseFloat(s.lineHeight),outerScroll:document.querySelector('.combined-editor').scrollTop};});
    expect(controls.titleTop).toBeGreaterThanOrEqual(controls.headerTop);expect(controls.titleBottom).toBeLessThanOrEqual(controls.headerBottom);expect(controls.selectInner+1).toBeGreaterThanOrEqual(controls.selectLine);expect(controls.outerScroll).toBe(0);measurements.push({name,...controls});
    await page.screenshot({path:path.join(out,`${name}.png`)});await page.keyboard.press('Escape');
  }
  fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(measurements,null,2));
});
