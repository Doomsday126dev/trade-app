const {test,expect}=require('@playwright/test');
const {seed,routeEmulators,login,settled,account,adminData,request}=require('./support/favoriteBrowserFixtures.cjs');
test.use({serviceWorkers:'block'});
test.skip(process.env.POGO_SAVING_EMULATORS!=='1','Requires isolated incident emulators and candidate handler.');
async function candidate(){
 const fixture=await seed();const name='New'+fixture.username;
 const response=await request('http://127.0.0.1:9599/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake','POST',{email:name.toLowerCase()+'@pogotrades.nyc',password:fixture.pin,returnSecureToken:true});
 fixture.newName=name;fixture.newUid=response.value.localId;
 expect((await adminData('PATCH','',{['loginDirectory/'+name]:{authReady:true,authVersion:1},['users/'+name]:{authUid:fixture.newUid},['authIndex/'+fixture.newUid]:{username:name},['publicShares/'+name]:{version:1,username:name,profile:{bio:'Synthetic public profile'},lists:{wishlist:{Eevee:'L'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:1}})).status).toBe(200);return fixture;
}
test('ordinary Trainers addition persists, repeated ensure preserves tags, shared removal is acknowledged, recovery remains read-only',async({page,browser})=>{
 const f=await candidate();await routeEmulators(page,f,{candidate:true});await login(page,f);await settled(page);
 await expect.poll(()=>page.evaluate(()=>!!managedFavoriteAdditions)).toBe(true);
 await page.evaluate(name=>{switchTab('trainers');return toggleTrainerFavorite(name);},f.newName);await settled(page);
 expect((await account(f)).favorites[f.newUid].deleted).toBe(false);
 await page.evaluate(uid=>managedAccountSyncRuntime.controller.patchEntity({entityType:'favorite',entityId:uid,patch:{'tagIds/tag_group':true}}),f.newUid);await settled(page);
 const original=(await account(f)).favorites[f.newUid];
 await page.evaluate(name=>toggleTrainerFavorite(name),f.newName);await settled(page);expect((await account(f)).favorites[f.newUid]).toEqual(original);
 const before=await account(f),ids=Object.keys(before.recoveryCandidates);
 const preview=await page.evaluate(ids=>previewPreservedFavorites(ids),ids);expect(preview.readOnly).toBe(true);expect(preview.rows[0].candidate.values.displayName).toBe(f.other);expect(await account(f)).toEqual(before);
 const second=await browser.newContext({serviceWorkers:'block'});try{const p=await second.newPage();await routeEmulators(p,f,{candidate:true,legacy:false});await login(p,f);await settled(p);expect(await p.evaluate(name=>ensureTrainerHistoryStore().isFavorite(name),f.newName)).toBe(true);}finally{await second.close();}
 page.on('dialog',dialog=>dialog.accept());await page.evaluate(name=>{_activeShareView={username:name,type:'wishlist'};return removeTrainerFavorite(name);},f.newName);await settled(page);expect((await account(f)).favorites[f.newUid].deleted).toBe(true);
 expect(await page.evaluate(uid=>allData.authIndex[uid],f.newUid)).toBeUndefined();
});
test('shared-list new addition queues honestly and survives reload with the same operation',async({page})=>{
 const f=await candidate();await routeEmulators(page,f,{candidate:true});await login(page,f);await settled(page);
 await page.evaluate(name=>{window.__incidentRejectWrites=true;_activeShareView={username:name,type:'wishlist'};return toggleTrainerFavorite(name);},f.newName);
 await expect.poll(()=>page.evaluate(async()=>{const value=await managedFavoriteAdditions.snapshot();return value.rows.at(-1)?.state;})).toBe('pending');
 expect((await account(f)).favorites?.[f.newUid]).toBeUndefined();
 const op=await page.evaluate(async()=>(await managedFavoriteAdditions.snapshot()).rows.at(-1).operationId);
 await page.reload();await expect.poll(()=>page.evaluate(()=>typeof managedFavoriteAdditions!=='undefined'&&!!managedFavoriteAdditions),{timeout:30000}).toBe(true);await settled(page);
 expect((await account(f)).favorites[f.newUid].lifecycleMutation).toBe(op);
 await expect.poll(()=>page.evaluate(async()=>(await managedFavoriteAdditions.snapshot()).rows.at(-1)?.state)).toBe('confirmed');
});
module.exports={candidate};
test('a full browser process restart retains pending Favorite intent and confirms the same operation',async()=>{
 const {chromium}=require('@playwright/test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const f=await candidate(),profile=fs.mkdtempSync(path.join(os.tmpdir(),'favorite-restart-'));
 let context=await chromium.launchPersistentContext(profile,{baseURL:'http://localhost:4188',headless:true,serviceWorkers:'block'});
 try{
  let page=context.pages()[0];await routeEmulators(page,f,{candidate:true});await login(page,f);await settled(page);
  await page.evaluate(name=>{window.__incidentRejectWrites=true;return toggleTrainerFavorite(name);},f.newName);
  const intent=await page.evaluate(async()=>(await managedFavoriteAdditions.snapshot()).rows.at(-1));expect(intent.state).toBe('pending');await context.close();
  context=await chromium.launchPersistentContext(profile,{baseURL:'http://localhost:4188',headless:true,serviceWorkers:'block'});page=context.pages()[0];await routeEmulators(page,f,{candidate:true,legacy:false});await page.goto('./');
  await expect.poll(()=>page.evaluate(()=>typeof managedFavoriteAdditions!=='undefined'&&!!managedFavoriteAdditions),{timeout:30000}).toBe(true);await settled(page);
  expect((await account(f)).favorites[f.newUid].lifecycleMutation).toBe(intent.operationId);expect(await page.evaluate(()=>auth.currentUser.uid)).toBe(f.uid);
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});
