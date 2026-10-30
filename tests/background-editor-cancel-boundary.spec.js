const {test,expect}=require('@playwright/test');
const {install,settled,entities,priority}=require('./helpers/want-editor-application.cjs');
test('cancel before authority resolves cannot commit a previously submitted draft',async({page})=>{
 await install(page);const before=await entities(page);
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('#wants-add-name').press('Escape');await page.locator('.wants-add-form .add-advanced-toggle').click();await priority(page,'H');
 await page.evaluate(()=>{const authority=accountSyncMutationAuthority,save=saveCombinedEditor,apply=applyAccountSyncTradeMutations;accountSyncMutationAuthority=async()=>{const value=await authority();window.__heldAuthority=true;await new Promise(resolve=>window.__releaseAuthority=resolve);return value};applyAccountSyncTradeMutations=async(...args)=>{window.__unexpectedMutation=true;return apply(...args)};saveCombinedEditor=async(...args)=>{try{return await save(...args)}finally{window.__editorSaveFinished=true}}});
 await page.locator('#combined-save').click();await expect.poll(()=>page.evaluate(()=>window.__heldAuthority===true)).toBe(true);await page.keyboard.press('Escape');await expect(page.locator('#combined-editor-modal')).toBeHidden();await page.evaluate(()=>window.__releaseAuthority());await expect.poll(()=>page.evaluate(()=>window.__editorSaveFinished===true)).toBe(true);await settled(page);
 expect(await page.evaluate(()=>!!window.__unexpectedMutation)).toBe(false);expect(await entities(page)).toEqual(before);
});
test('session generation change while authority is pending cannot commit the draft',async({page})=>{
 await install(page);const before=await entities(page);
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('#wants-add-name').press('Escape');await page.locator('.wants-add-form .add-advanced-toggle').click();await priority(page,'H');
 await page.evaluate(()=>{const authority=accountSyncMutationAuthority,save=saveCombinedEditor,apply=applyAccountSyncTradeMutations;accountSyncMutationAuthority=async()=>{const value=await authority();window.__heldAuthority=true;await new Promise(resolve=>window.__releaseAuthority=resolve);return value};applyAccountSyncTradeMutations=async(...args)=>{window.__unexpectedMutation=true;return apply(...args)};saveCombinedEditor=async(...args)=>{try{return await save(...args)}finally{window.__editorSaveFinished=true}}});
 await page.locator('#combined-save').click();await expect.poll(()=>page.evaluate(()=>window.__heldAuthority===true)).toBe(true);await page.evaluate(()=>{_sessionTransientGeneration++;window.__releaseAuthority()});await expect.poll(()=>page.evaluate(()=>window.__editorSaveFinished===true)).toBe(true);
 expect(await page.evaluate(()=>!!window.__unexpectedMutation)).toBe(false);expect(await entities(page)).toEqual(before);
});
test('runtime teardown before authority resolves cannot commit the draft',async({page})=>{
 await install(page);const before=await entities(page);
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('#wants-add-name').press('Escape');await page.locator('.wants-add-form .add-advanced-toggle').click();await priority(page,'H');
 await page.evaluate(()=>{const authority=accountSyncMutationAuthority,save=saveCombinedEditor,apply=applyAccountSyncTradeMutations;accountSyncMutationAuthority=async()=>{const value=await authority();window.__heldAuthority=true;await new Promise(resolve=>window.__releaseAuthority=resolve);return value};applyAccountSyncTradeMutations=async(...args)=>{window.__unexpectedMutation=true;return apply(...args)};saveCombinedEditor=async(...args)=>{try{return await save(...args)}finally{window.__editorSaveFinished=true}}});
 await page.locator('#combined-save').click();await expect.poll(()=>page.evaluate(()=>window.__heldAuthority===true)).toBe(true);await page.evaluate(async()=>{await stopAccountSyncRuntime();window.__releaseAuthority()});await expect.poll(()=>page.evaluate(()=>window.__editorSaveFinished===true)).toBe(true);
 expect(await page.evaluate(()=>!!window.__unexpectedMutation)).toBe(false);await page.evaluate(()=>ensureAccountSyncRuntime());await settled(page);expect(await entities(page)).toEqual(before);
});
