const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const {normalFixture}=require('./helpers/usability-fixture.cjs');
test.use({serviceWorkers:'block'});

test('visible Hoothoot suggestion and Options use the same canonical label without changing selection identity',async({page})=>{
 await normalFixture(page);
 const input=page.locator('#wants-add-name'),list=page.locator('#wants-add-name-suggestions');
 let identity;
 for(const query of ['Hoothoot New Year','Hoothoot New Years','Hoothoot Hat']){
  await input.fill(query);
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toHaveText('Hoothoot (New Year Hat)');
  const row=await input.evaluate(el=>({name:el._pickerRows[0].name,catalogId:el._pickerRows[0].catalogId}));
  expect(row.name).toBe('Hoothoot (New Year)');if(identity)expect(row).toEqual(identity);identity=row;
 }
 if(process.env.PICKER_LABEL_CAPTURE_DIR){fs.mkdirSync(process.env.PICKER_LABEL_CAPTURE_DIR,{recursive:true});await page.screenshot({path:process.env.PICKER_LABEL_CAPTURE_DIR+'/hoothoot-'+page.context().browser().browserType().name()+'.png'});}
 await list.getByRole('option').click();await expect(input).toHaveValue(identity.name);
 await page.getByRole('button',{name:'Options ▾',exact:true}).click();
 await expect(page.locator('#combined-identity-name')).toHaveText('Hoothoot (New Year Hat)');
 expect(await page.evaluate(()=>combinedEditor?.entries?.length||0)).toBe(0);
 await page.evaluate(()=>stopAccountSyncRuntime());
});

test('visible suggestions use current localized full costume labels while keeping canonical values',async({page})=>{
 await normalFixture(page);const input=page.locator('#wants-add-name'),list=page.locator('#wants-add-name-suggestions');
 for(const [locale,label]of [['en','Pikachu (Libre)'],['ja','マスクド・ピカチュウ'],['en','Pikachu (Libre)']]){
  await page.evaluate(locale=>changeInterfaceLocale(locale),locale);await input.fill('Pikachu Libre');
  await expect(list.getByRole('option',{name:label,exact:true})).toBeVisible();
  const row=await input.evaluate(el=>el._pickerRows.find(e=>e.name==='Pikachu (Libre)'));expect(row.name).toBe('Pikachu (Libre)');
 }
 await page.evaluate(()=>stopAccountSyncRuntime());
});
