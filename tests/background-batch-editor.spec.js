const {test,expect}=require('@playwright/test');
const {install,addDialog,edit,priority}=require('./helpers/want-editor-application.cjs');
const {enableLocalBackgrounds}=require('./helpers/background-local.cjs');
test.use({serviceWorkers:'block'});
const modal='#combined-editor-modal';
const ids=['lc-go-fest-2026-chicago','lc-go-fest-2026-copenhagen','lc-go-fest-2026-tokyo'];
const choice=(page,id)=>page.locator(`#combined-background-options input[value="${id}"]`);
async function setup(page){await install(page,null,{backgroundRollout:false});await enableLocalBackgrounds(page);}
async function batch(page){await addDialog(page,'Groudon');await page.locator('#combined-shiny').check();await page.locator('#combined-preferences summary').click();await page.locator('#combined-background-batch-toggle').click();}
async function rows(page){return page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot().entries);}

test('adds three shiny backgrounds together, preserving shared preferences with one revision',async({page})=>{
 await setup(page);await batch(page);await priority(page,'H');
 await page.locator('#combined-lucky').check();await page.locator('#combined-mod').fill('Best friend');await page.locator('#combined-note').fill('Trade at event');
 for(const id of ids)await choice(page,id).check();
 await expect(page.locator('#combined-save')).toHaveText('Add 3 backgrounds');
 await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 const saved=await rows(page);expect(saved.map(r=>r.backgroundId)).toEqual(ids);
 for(const row of saved)expect(row).toMatchObject({shiny:true,lucky:true,priority:'H',variant:'Best friend',note:'Trade at event',quantity:1});
 expect(await page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot().head)).toBe(1);
 await expect(page.locator('.wants-row[data-name="Groudon"]')).toHaveCount(3);
});

test('marks exact variants already added without hiding other shiny or variant requests',async({page})=>{
 await setup(page);await batch(page);for(const id of ids)await choice(page,id).check();await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 await batch(page);for(const id of ids){await expect(choice(page,id)).toBeDisabled();await expect(choice(page,id).locator('..')).toContainText('Already on your list');}
 await expect(page.locator('#combined-save')).toBeDisabled();
 await page.locator('#combined-shiny').uncheck();for(const id of ids)await expect(choice(page,id)).toBeEnabled();
 await page.locator('#combined-shiny').check();await page.locator('#combined-mod').fill('Mirror');for(const id of ids)await expect(choice(page,id)).toBeEnabled();
 await choice(page,ids[0]).check();await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 expect(await rows(page)).toHaveLength(4);
});

test('batch controls remain reachable on a narrow screen, clear safely, and single edit stays single',async({page})=>{
 await page.setViewportSize({width:320,height:740});await setup(page);await batch(page);
 await page.locator('#combined-background-select-all').click();await expect(page.locator('#combined-save')).toBeEnabled();
 await page.locator('#combined-background-clear').click();await expect(page.locator('#combined-save')).toBeDisabled();
 await choice(page,ids[0]).focus();await page.keyboard.press('Space');await expect(choice(page,ids[0])).toBeChecked();
 const bounds=await page.locator('#combined-background-options').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);
 await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 await edit(page,'Groudon');await page.locator('#combined-preferences summary').click();await expect(page.locator('#combined-background-batch-toggle')).toBeHidden();await expect(page.locator('#combined-background')).toBeVisible();
});

for(const failure of ['offline','lost acknowledgement']){
 test(`whole batch survives ${failure}, reload and one retry without partial entries or duplicates`,async({page})=>{
  await setup(page);await batch(page);await priority(page,'M');for(const id of ids)await choice(page,id).check();
  await page.evaluate(failure=>{__localBackgroundTransport[failure==='offline'?'failWrites':'loseAcknowledgement']=true;},failure);
  await page.locator('#combined-save').click();await expect(page.locator('#combined-error')).not.toBeEmpty();
  const before=await page.evaluate(()=>({state:backgroundOwnerRuntime.repository.snapshot(),store:__localBackgroundStore,account:__editorFixture.remote}));
  expect(before.state.entries).toHaveLength(0);expect(before.state.pending.entries).toHaveLength(3);
  await expect(page.locator('#combined-background-options input:checked')).toHaveCount(3);
  // Recreate only the synthetic server transport. The browser's real durable
  // journal remains intact across the actual navigation/reload.
  await install(page,before.account,{backgroundRollout:false});await enableLocalBackgrounds(page,before.store);
  expect(await page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot().pending.entries.length)).toBe(3);
  await page.getByRole('button',{name:'Retry saved draft',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot().pending)).toBe(null);
  expect((await rows(page)).map(row=>row.backgroundId)).toEqual(ids);
  expect(await page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot().head)).toBe(1);
  expect(await page.evaluate(()=>__localBackgroundTransport.writes.filter(write=>write.method==='PATCH').length)).toBe(failure==='offline'?1:0);
  await batch(page);for(const id of ids)await expect(choice(page,id)).toBeDisabled();await expect(page.locator('#combined-save')).toBeDisabled();
 });
}

test('successful batch reloads as three exact saved requests and can add the remaining backgrounds',async({page})=>{
 await setup(page);await batch(page);for(const id of ids)await choice(page,id).check();await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 const saved=await page.evaluate(()=>({background:__localBackgroundStore,account:__editorFixture.remote}));
 await install(page,saved.account,{backgroundRollout:false});await enableLocalBackgrounds(page,saved.background);
 expect(await rows(page)).toHaveLength(3);await batch(page);for(const id of ids)await expect(choice(page,id)).toBeDisabled();
 await page.locator('#combined-background-select-all').click();const count=await page.locator('#combined-background-options input:checked').count();expect(count).toBeGreaterThan(0);
 await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();expect(await rows(page)).toHaveLength(3+count);
 expect(await page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot().head)).toBe(2);
});

test('batch controls cannot resubmit while saving or let late completion close a newer editor',async({page})=>{
 await setup(page);await batch(page);for(const id of ids)await choice(page,id).check();
 await page.evaluate(()=>{__localBackgroundTransport.holdWrites=true;});await page.locator('#combined-save').click();
 await expect.poll(()=>page.evaluate(()=>__localBackgroundTransport.waiters.length)).toBe(1);
 await expect(page.locator('#combined-save')).toBeDisabled();await expect(page.locator('#combined-background-batch-toggle')).toBeDisabled();
 for(const id of ids)await expect(choice(page,id)).toBeDisabled();
 await page.locator('#combined-close').click();await addDialog(page,'Charmander');
 await page.evaluate(()=>{__localBackgroundTransport.holdWrites=false;__localBackgroundTransport.waiters.splice(0).forEach(resolve=>resolve());});
 await expect.poll(async()=>await rows(page)).toHaveLength(3);await expect(page.locator(modal)).toBeVisible();await expect(page.locator('#combined-name')).toHaveValue('Charmander');await expect(page.locator('#combined-save')).toBeEnabled();
});

test('changing Pokémon clears batch selections instead of adding an unintended plain request',async({page})=>{
 await setup(page);await batch(page);await choice(page,ids[0]).check();
 await page.locator('#combined-change').click();await page.locator('#combined-name').fill('Psyduck');await page.locator('#combined-name').press('Escape');
 await expect(page.locator('#combined-background-options input:checked')).toHaveCount(0);await expect(page.locator('#combined-save')).toBeDisabled();
 await page.locator('#combined-background-batch-toggle').click();await expect(page.locator('#combined-save')).toHaveText('Add to list');
});

test('localized batch picker fits narrow touch and enlarged-text layouts',async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:320,height:740});await setup(page);
 const fs=require('node:fs'),path=require('node:path'),out=process.env.BACKGROUND_BATCH_OUTPUT_DIR||info.outputPath('review');fs.mkdirSync(out,{recursive:true});
 for(const locale of ['en','ja','es','de']){
  await page.evaluate(async locale=>{await changeInterfaceLocale(locale);applyTheme('dark');},locale);await expect(page.locator('#toast')).toBeHidden();await batch(page);for(const id of ids)await choice(page,id).check();
  await page.locator('#combined-background-options').scrollIntoViewIfNeeded();
  const metric=await page.evaluate(()=>{const m=document.querySelector('#combined-editor-modal .modal');const overflow=[...m.querySelectorAll('label,button')].filter(e=>e.offsetParent).filter(e=>{const rect=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const text=range.getBoundingClientRect();return text.right>rect.right+1||text.left<rect.left-1;}).map(e=>e.id||e.textContent);return{pageOverflow:document.documentElement.scrollWidth>innerWidth,overflow};});
  expect(metric.pageOverflow).toBe(false);expect(metric.overflow).toEqual([]);
  await expect(page.locator('#combined-save')).toBeInViewport();await page.screenshot({path:path.join(out,`batch-${locale}-320.png`)});await page.locator('#combined-close').click();
 }
 await page.evaluate(async()=>{await changeInterfaceLocale('en');applyTheme('light');});await expect(page.locator('#toast')).toBeHidden();await batch(page);for(const id of ids)await choice(page,id).check();
 await page.screenshot({path:path.join(out,'batch-en-light-320.png')});
 await page.evaluate(()=>{for(const el of document.querySelectorAll('#combined-editor-modal :is(button,label,small,p)'))el.style.fontSize=`${parseFloat(getComputedStyle(el).fontSize)*2}px`;});
 await page.locator('#combined-background-options').scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await expect(page.locator('#combined-save')).toBeInViewport();await page.screenshot({path:path.join(out,'batch-en-enlarged-320.png')});
});

test('non-shiny Groudon backgrounds add alongside shiny copies and existing non-shiny backgrounds',async({page})=>{
 await setup(page);await batch(page);await page.locator('#combined-background-select-all').click();const shinyCount=await page.locator('#combined-background-options input:checked').count();await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 // Non-shiny requests follow the existing explicit priority requirement.
 await batch(page);await page.locator('#combined-shiny').uncheck();await priority(page,'H');for(const id of ids)await choice(page,id).check();await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 expect((await rows(page)).filter(row=>row.shiny)).toHaveLength(shinyCount);expect((await rows(page)).filter(row=>!row.shiny)).toHaveLength(3);
 await batch(page);await page.locator('#combined-shiny').uncheck();await priority(page,'L');for(const id of ids)await expect(choice(page,id)).toBeDisabled();
 await page.locator('#combined-background-select-all').click();const remaining=await page.locator('#combined-background-options input:checked').count();expect(remaining).toBeGreaterThan(0);await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
 const all=await rows(page);expect(all.filter(row=>row.shiny)).toHaveLength(shinyCount);expect(all.filter(row=>!row.shiny)).toHaveLength(3+remaining);expect(all.filter(row=>!row.shiny&&ids.includes(row.backgroundId)).every(row=>row.priority==='H')).toBe(true);
});

test('non-shiny background with no priority reports the existing requirement and succeeds once priority is chosen',async({page})=>{
 await setup(page);await addDialog(page,'Groudon');await page.locator('#combined-preferences summary').click();await page.locator('#combined-background').selectOption(ids[0]);await page.locator('#combined-save').click();
 await expect(page.locator('#combined-error')).toHaveText('Choose a priority or a special requirement.');expect(await rows(page)).toHaveLength(0);await expect(page.locator('#combined-save')).toBeEnabled();
 await priority(page,'M');await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();expect(await rows(page)).toHaveLength(1);
});

test('batch controls and styles stay out of the startup shell and initialize only once',async({page})=>{
 await setup(page);await expect(page.locator('#combined-background-batch-toggle')).toHaveCount(0);await expect(page.locator('#combined-background-batch-style')).toHaveCount(0);
 await batch(page);await expect(page.locator('#combined-background-batch-style')).toHaveCount(1);await page.locator('#combined-close').click();await batch(page);
 await expect(page.locator('#combined-background-batch-toggle')).toHaveCount(1);await expect(page.locator('#combined-background-batch-style')).toHaveCount(1);await choice(page,ids[0]).check();await page.locator('#combined-save').click();await expect(page.locator(modal)).toBeHidden();
});
