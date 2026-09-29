const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {configuration,replaceConfiguration}=require('../scripts/environments/configuration.cjs');
test.use({serviceWorkers:'block'});
for(const profile of ['production','staging'])test(`${profile} local document initializes the explicit profile without an opposite-project route`,async({page})=>{
  const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),config=configuration(profile),opposite=configuration(profile==='staging'?'production':'staging');
  const unexpected=[];
  page.on('request',request=>{if(request.url().includes(opposite.firebase.projectId))unexpected.push(request.url());});
  await page.route('https://**',route=>route.abort());
  await page.route(/\/index\.html(?:\?|$)|\/\?(?:environment-isolation)/,route=>route.fulfill({contentType:'text/html',body:replaceConfiguration(source,config)}));
  await page.goto('./index.html?environment-isolation');
  await page.evaluate(()=>window.__pogoEnsureFullApp('environment-isolation'));
  const result=await page.evaluate(()=>({profile:window.__POGO_ENVIRONMENT.profile,config:window.__POGO_FIREBASE_CONFIG,siteKey:window.__POGO_ENVIRONMENT.appCheckSiteKey,
    resolver:window.PogoServices.favoriteResolverClient.ENDPOINT,write:window.PogoServices.favoriteWriteTransport.DATABASE}));
  expect(result.profile).toBe(profile);expect(result.config).toEqual(config.firebase);expect(result.siteKey).toBe(config.appCheckSiteKey);
  expect(result.resolver).toContain(config.firebase.projectId);expect(result.write).toBe(`${config.firebase.databaseURL}/.json`);expect(unexpected).toEqual([]);
  if(profile==='staging')expect(await page.evaluate(url=>{try{setupFirebase(url);return 'accepted';}catch(error){return error.message;}},opposite.firebase.databaseURL)).toBe('Staging Firebase database configuration mismatch');
});
