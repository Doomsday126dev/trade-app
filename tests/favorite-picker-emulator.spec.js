const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {seed,routeEmulators,login,settled,account,adminData,request}=require('./support/favoriteBrowserFixtures.cjs');
test.use({serviceWorkers:'block'});
test.skip(process.env.POGO_SAVING_EMULATORS!=='1','Requires isolated incident emulators and candidate handler.');
async function seedPicker(count=55){
 const f=await seed(),patch={},suffix=Date.now();f.targets=[];
 for(let i=0;i<count;i++){
  const name='AtlasTrainer'+String(i+1).padStart(2,'0');
  const record=await request('http://127.0.0.1:9599/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake','POST',{email:`atlas${suffix}-${i}@pogotrades.nyc`,password:f.pin,returnSecureToken:true});
  expect(record.status).toBe(200);const uid=record.value.localId;f.targets.push({name,uid});patch['loginDirectory/'+name]={authReady:true,authVersion:1};patch['users/'+name]={authUid:uid};patch['authIndex/'+uid]={username:name};
 }
 expect((await adminData('PATCH','',patch)).status).toBe(200);return f;
}
async function open(page,f){await routeEmulators(page,f,{candidate:true,picker:true});await login(page,f);await settled(page);await page.getByRole('tab',{name:'Trainers',exact:true}).click();await page.locator('#trainer-mode-favorites').click();await page.locator('[data-add-trainers]').click();await expect.poll(()=>page.evaluate(()=>favoritePickerSession?.evidenceReady)).toBe(true);}
test('Select all resolves and persists 55 trainers across pages; existing and preserved entries remain distinct',async({page})=>{
 const f=await seedPicker();await open(page,f);
 await expect(page.locator('[data-picker-all]')).toHaveText('Select all results (55)');
 await page.locator('#favorite-picker-search').fill('AtlasTrainer0');await expect(page.locator('[data-picker-all]')).toHaveText('Select all results (9)');await page.locator('[data-picker-all]').click();
 await page.locator('#favorite-picker-search').fill('');await expect(page.locator('[data-picker-capacity]')).toContainText('9 selected');await page.locator('[data-picker-all]').click();
 await page.locator('[data-picker-next]').click();await expect(page.locator('[data-picker-rows] input:checked')).toHaveCount(20);
 await expect(page.locator('[data-picker-add]')).toHaveText('Add 55 favorites');await page.locator('[data-picker-add]').click();await settled(page);
 await expect.poll(async()=>Object.values((await account(f)).favorites||{}).filter(row=>!row.deleted).length,{timeout:30000}).toBe(55);
 await expect.poll(()=>page.evaluate(()=>favoritePickerSession.model.snapshot().selected.length)).toBe(0);
 await page.locator('#favorite-picker-search').fill(f.other);await expect(page.locator('[data-picker-rows]')).toContainText('Preserved · review');await expect(page.locator('[data-picker-rows] input')).toBeDisabled();
 await page.locator('#favorite-picker-search').fill('AtlasTrainer01');await expect(page.locator('[data-picker-rows]')).toContainText('Already added');await expect(page.locator('[data-picker-add]')).toBeDisabled();
});
for(const [label,width,height] of [['desktop',1440,900],['390',390,844],['320',320,700]])test(`synthetic ${label} picker has visible bottom action and usable selection`,async({page})=>{
 const f=await seedPicker(35);await page.setViewportSize({width,height});await open(page,f);
 await page.locator('[data-picker-all]').click();await page.locator('#favorite-picker-search').fill('AtlasTrainer');
 await expect(page.locator('[data-picker-add]')).toHaveText('Add 35 favorites');
 const geometry=await page.locator('#favorite-picker').evaluate(dialog=>{const bounds=dialog.getBoundingClientRect(),action=dialog.querySelector('[data-picker-add]').getBoundingClientRect();return{width:bounds.width,left:bounds.left,bottom:action.bottom,viewport:innerHeight,overflow:dialog.scrollWidth>dialog.clientWidth};});
 expect(geometry.width).toBeLessThanOrEqual(width);expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);expect(geometry.overflow).toBe(false);
 if(process.env.FAVORITE_SCREENSHOT_DIR){fs.mkdirSync(process.env.FAVORITE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FAVORITE_SCREENSHOT_DIR,`favorite-picker-${label}.png`)});}
 await page.locator('[data-picker-close]').click();await expect(page.locator('#favorite-picker')).toHaveCount(0);expect((await account(f)).favorites||{}).toEqual({});
});
test('partial identity failure retains only unsuccessful selections and retries without changing successful Favorite',async({page})=>{
 const f=await seedPicker(2),failed=f.targets[1];await adminData('DELETE','authIndex/'+failed.uid);
 await open(page,f);await page.locator('[data-picker-all]').click();await page.locator('[data-picker-add]').click();await settled(page);
 await expect.poll(()=>page.evaluate(()=>favoritePickerSession.model.snapshot().selected)).toEqual([failed.name]);
 const first=(await account(f)).favorites[f.targets[0].uid];expect((await account(f)).favorites[failed.uid]).toBeUndefined();await expect(page.locator('[data-picker-rows]')).toContainText('Not saved · retry');
 await adminData('PUT','authIndex/'+failed.uid,{username:failed.name});await page.locator('[data-picker-add]').click();await settled(page);
 expect((await account(f)).favorites[f.targets[0].uid]).toEqual(first);await expect.poll(()=>page.evaluate(()=>favoritePickerSession.model.snapshot().selected.length)).toBe(0);
});
