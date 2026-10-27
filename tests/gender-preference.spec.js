const {test,expect}=require('@playwright/test');
const fs=require('fs');const {normalFixture,settled}=require('./helpers/usability-fixture.cjs');
const source=fs.readFileSync(require.resolve('./normal-sync-product.spec.js'),'utf8');const install=eval('('+source.slice(source.indexOf('async function install('),source.indexOf('\nasync function settled'))+')');
test('unspecified gender remains optional even when costume artwork is female-only',async({page})=>{
 await normalFixture(page);
 for(const name of ['Eevee','Pikachu (Orange Hanbok)']){
  await page.locator('#wants-add-name').fill(name.slice(0,-1));await page.getByRole('option',{name,exact:true}).click();await page.keyboard.press('Escape');await page.locator('.wants-add-form button').filter({hasText:'Options'}).click();await require('./helpers/current-want-controls.cjs').priority(page,'H');await page.locator('#combined-save').focus();await page.keyboard.press('Enter');await settled(page);
 }
 const saved=await page.evaluate(()=>structuredClone(__normal.remote));await page.evaluate(()=>stopAccountSyncRuntime());await install(page,saved);await settled(page);
 const result=await page.evaluate(()=>productDeclarations().entries.filter(e=>['Eevee','Pikachu (Orange Hanbok)'].includes(e.name)).map(e=>({name:e.name,gender:e.gender||'',mod:e.mod||'',detail:productShareImageDetails(e,{priority:'H'}),urls:exportSpriteFallbackUrls(e)})));
 expect(result).toHaveLength(2);for(const e of result){expect(e.gender).toBe('');expect(e.mod).toBe('');expect(e.detail).not.toMatch(/[♀♂]/);const row=page.locator('.wants-row').filter({hasText:e.name});expect(await row.innerText()).not.toMatch(/[♀♂]/);}
 expect(result.find(e=>e.name.includes('Hanbok')).urls).toEqual(['assets/sprites/go/serebii-pikachu-orange-hanbok-female.png']);
 const publicRows=await page.evaluate(()=>__normal.remote.publicShares.NormalProduct.declarations.filter(e=>['Eevee','Pikachu (Orange Hanbok)'].includes(e.name)));expect(publicRows).toHaveLength(2);for(const e of publicRows)expect(e.gender||'').toBe('');
 await page.evaluate(()=>stopAccountSyncRuntime());
});
