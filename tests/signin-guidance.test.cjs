const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('js/app/application.js','utf8'),worker=fs.readFileSync('sw.js','utf8');
const cut=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)+1));
test('all recovery paths have translated instructions and title',()=>{
  const used=new Set([...html.matchAll(/data-i18n="(loginHelp\.[^"]+)"/g)].map(x=>x[1]));
  assert.equal(used.size,9);
  for(const lang of ['en','es','de','ja']){
    const window={};vm.runInNewContext(fs.readFileSync('js/i18n/locales/'+lang+'.js','utf8'),{window});
    for(const key of used)assert.ok(window.PogoLocales[lang][key]?.length>3,key+' '+lang);
  }
});
test('opening the public guide does not run diagnostics or focus a reset action',async()=>{
  const calls=[],trigger={};const ctx={document:{getElementById:()=>trigger},openModal:(id,opts)=>calls.push([id,opts]),setLoginHealthCopyStatus:()=>{},runLoginHealthCheck:async()=>calls.push(['diagnostics'])};
  vm.runInNewContext(cut('async function openLoginHealthCheck','async function runLoginHealthCheck'),ctx);
  await ctx.openLoginHealthCheck('guide');assert.equal(calls.length,1);assert.equal(calls[0][0],'signin-guide-modal');assert.equal(calls[0][1].returnFocus,trigger);
  await ctx.openLoginHealthCheck('details');assert.equal(calls[1][0],'login-health-modal');assert.equal(calls[1][1].initialFocus,'#login-health-title');assert.equal(calls[2][0],'diagnostics');
});
test('worker report identifies the published release, not the installed worker version',async()=>{
  const ctx={navigator:{serviceWorker:{getRegistration:async()=>({})}},fetch:async()=>({ok:true,text:async()=>worker})};
  vm.runInNewContext(cut('async function serviceWorkerHealth','async function openLoginHealthCheck'),ctx);
  const found=await ctx.serviceWorkerHealth();assert.equal(found.status,'Registered');assert.match(found.detail,/Published worker release: \d{4}-\d{2}-\d{2}\.\d+/);
});
