const {test,expect}=require('@playwright/test'),fs=require('node:fs');
const rows=require('../data/reviewed-consolidated-shiny-assets.json').records;
const source=fs.readFileSync(require.resolve('./anonymous-public-share.spec.js'),'utf8');
const installPublicFirebase=eval('('+source.slice(source.indexOf('async function installPublicFirebase('),source.indexOf('\nasync function assertPublicPrivacy'))+')');
const assertPublicPrivacy=eval('('+source.slice(source.indexOf('async function assertPublicPrivacy('),source.indexOf('\ntest.describe'))+')');
for(const shiny of [false,true])test('anonymous desktop boot renders all 173 '+(shiny?'Shiny':'normal')+' exact forms without private reads',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});
 const origin=new URL(page.context()._options.baseURL).origin;
 await page.context().route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
 const declarations=rows.map(r=>({intent:'lf',name:r.name,category:'wishlist',p:'H',mod:'',gender:r.sourceGenders.includes('f')?'f':r.sourceGenders[0],backgroundId:'',note:'',lucky:false,shiny,xxl:false,xxs:false}));
 const projection={version:2,username:'PublicTrainer',profile:{bio:'Synthetic artwork qualification',lastUpdated:Date.now()},lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],declarations,declarationCount:173,updatedAt:Date.now()};
 await installPublicFirebase(page,{projection,realSprites:true});await page.goto('./?view=PublicTrainer&list=wishlist');await assertPublicPrivacy(page);
 const images=page.locator('#share-list-out .share-pcard img');await expect(images).toHaveCount(80);
 for(const count of [160,173]){await page.locator('[data-public-share-action=more-section]').click();await expect(images).toHaveCount(count);}
 await expect(page.locator('[data-public-share-action=more-section]')).toHaveCount(0);await expect(page.locator('#share-list-out .public-share-pokemon-mark')).toHaveCount(0);
 const expected=rows.map((r,i)=>({name:r.name,url:shiny?r.assets[declarations[i].gender==='f'?'femaleShiny':'shiny']:r.retainedNormal[declarations[i].gender==='f'&&r.retainedNormal.female?'female':'default'].asset}));
 const actual=await images.evaluateAll(async images=>Promise.all(images.map(async im=>{im.loading='eager';await im.decode();return{name:im.closest('.share-pcard').querySelector('.share-pcard-name').textContent,url:im.getAttribute('src'),width:im.naturalWidth};})));
 expect(actual.map(r=>r.name+'|'+r.url).sort()).toEqual(expected.map(r=>r.name+'|'+r.url).sort());expect(actual.every(r=>r.width>32)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/consolidated-review/anonymous-'+(shiny?'shiny-':'normal-')+info.project.name+'.png',fullPage:true});
});
