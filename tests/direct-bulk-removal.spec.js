const {test,expect}=require('@playwright/test');
const {install,settled,addDialog}=require('./helpers/want-editor-application.cjs');
const {enableLocalBackgrounds}=require('./helpers/background-local.cjs');
const row=(page,name)=>page.locator(`.wants-row[data-name="${name}"]`);
async function setup(page){await install(page,null,{backgroundRollout:false});}
async function backgrounds(page){
 await enableLocalBackgrounds(page);
 await page.evaluate(async()=>{const catalog=accountSyncCatalogIdentity('wishlist','Groudon');await backgroundV2PrototypeAdapter.addMany(auth.currentUser.uid,['lc-go-fest-2026-chicago','lc-go-fest-2026-tokyo'].map(backgroundId=>({catalogId:catalog.catalogId,backgroundId,shiny:false})));renderMyList();});
}
test('quiet X is accessible, cancel is inert, confirmed single removal preserves other entries',async({page})=>{
 await setup(page);if(test.info().project.name==='webkit-mobile')await page.setViewportSize({width:320,height:740});const button=row(page,'Pikachu').locator('.wants-remove-direct');
 await expect(button).toHaveAttribute('aria-label',/Remove.*Pikachu/);const box=await button.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);
 const options=await row(page,'Pikachu').locator('.myrow-edit').boundingBox();expect(Math.abs(options.y-box.y)).toBeLessThan(3);
 page.once('dialog',dialog=>dialog.dismiss());await button.click();await expect(row(page,'Pikachu')).toHaveCount(1);
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('list entries (1)');expect(dialog.message()).toContain('Pikachu');await dialog.accept();});await button.focus();await button.press('Enter');
 await expect(row(page,'Pikachu')).toHaveCount(0);await expect(row(page,'Rotom')).toHaveCount(1);await expect(row(page,'Psyduck')).toHaveCount(1);await expect(page.locator('#wants-removal-status')).toContainText('Removal saved on this device');
 await expect(row(page,'Rotom').locator('.wants-remove-direct')).toBeFocused();await settled(page);await page.screenshot({path:'outputs/removal-single-'+test.info().project.name+'.png',fullPage:true,animations:'disabled'});
});
test('select all matching respects filter, and bulk removal preserves unmatched entries',async({page})=>{
 await setup(page);await page.evaluate(()=>{document.getElementById('combined-filter').value='P';startWantsSelection();renderMyList();});
 await page.getByRole('button',{name:'Select all matching',exact:true}).click();
 await expect(row(page,'Pikachu').locator('input')).toBeChecked();await expect(row(page,'Psyduck').locator('input')).toBeChecked();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove selected',exact:true}).click();
 await page.evaluate(()=>renderMyList(''));await expect(row(page,'Pikachu')).toHaveCount(0);await expect(row(page,'Psyduck')).toHaveCount(0);await expect(row(page,'Rotom')).toHaveCount(1);
});
test('background X removes exact variant, bulk handles mixed modern stores safely',async({page})=>{
 await setup(page);await backgrounds(page);await expect(row(page,'Groudon')).toHaveCount(2);
 page.once('dialog',dialog=>dialog.accept());await row(page,'Groudon').first().locator('.wants-remove-direct').click();await expect(row(page,'Groudon')).toHaveCount(1);
 await page.evaluate(()=>startWantsSelection());await row(page,'Groudon').locator('input').check();await row(page,'Pikachu').locator('input').check();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove selected',exact:true}).click();
 await expect(row(page,'Groudon')).toHaveCount(0);await expect(row(page,'Pikachu')).toHaveCount(0);await expect(row(page,'Rotom')).toHaveCount(1);
});
test('background transport failure stops before canonical deletion and reports pending work',async({page})=>{
 await setup(page);await backgrounds(page);await page.evaluate(()=>{startWantsSelection();__localBackgroundTransport.failWrites=true;});
 await row(page,'Groudon').first().locator('input').check();await row(page,'Pikachu').locator('input').check();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove selected',exact:true}).click();
 await expect(page.locator('#wants-removal-status')).toContainText('could not finish');await expect(row(page,'Pikachu')).toHaveCount(1);
 expect(await page.evaluate(()=>backgroundOwnerRuntime.repository.snapshot().pending.entries.length)).toBe(1);
});
test('canonical offline removal is reported as local pending, not remotely complete',async({page})=>{
 await setup(page);await page.evaluate(()=>{__editorFixture.offline=true;});page.once('dialog',dialog=>dialog.accept());await row(page,'Pikachu').locator('.wants-remove-direct').click();
 await expect(page.locator('#wants-removal-status')).toContainText('saved on this device');
 expect(await page.evaluate(async()=>{await managedAccountSyncRuntime.controller.drain();return (await managedAccountSyncRuntime.controller.snapshot()).pendingCount;})).toBeGreaterThan(0);
});
test('list change during authority check aborts deletion rather than deleting changed entries',async({page})=>{
 await setup(page);await page.evaluate(()=>{const original=accountSyncMutationAuthority;accountSyncMutationAuthority=async(...args)=>{accountSyncMutationAuthority=original;const authority=await original(...args);const entry=combinedSourceEntity(combinedGroups().find(g=>g[0].name==='Pikachu')[0]);window.__staleOutcome=await authority.controller.patchEntity({entityType:'tradeEntry',entityId:entry.entityId,patch:{note:'Changed on another device'}});await authority.controller.drain();return authority;};});
 page.once('dialog',dialog=>dialog.accept());await row(page,'Pikachu').locator('.wants-remove-direct').click();await expect(page.locator('#wants-removal-status')).toContainText(/Your list changed|could not finish/);await expect(row(page,'Pikachu')).toHaveCount(1);expect(await page.evaluate(()=>window.__staleOutcome)).toMatchObject({ok:true,value:{values:{note:'Changed on another device'}}});
});
