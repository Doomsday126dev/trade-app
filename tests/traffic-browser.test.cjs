const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright');
const script=fs.readFileSync('js/services/traffic.js','utf8'),html=fs.readFileSync('index.html','utf8');
const endpoint='https://doomsday126dev-trade.goatcounter.com/count',secret='SYNTHETIC_PRIVATE_SHARE_TRAINER_SEARCH_IV_TOKEN_a49';
for(const [engine,type]of[['chromium',chromium],['safari-webkit',webkit]])test(`${engine}: real collector URLs and headers exclude private values and credentials`,async()=>{
 const browser=await type.launch({headless:true});try{
 for(const scenario of [
  {query:`?view=${secret}&list=wishlist&search=CP123#${secret}`,expected:'/trade-share'},
  {query:`?account=${secret}&input=${secret}#${secret}`,expected:'/trade'},
  {query:`?legal=privacy&private=${secret}`,expected:'/trade'},
  {query:`?view=${secret}`,endpoint:'',expected:null},
  {query:`?view=${secret}`,optOut:true,expected:null},
  {query:`?view=${secret}`,automation:true,expected:null},
  {query:`?view=${secret}`,host:'https://preview.example.test',expected:null}
 ]){
  const context=await browser.newContext({serviceWorkers:'block'}),requests=[];
  await context.addCookies([{name:'synthetic-private-cookie',value:secret,domain:new URL(endpoint).hostname,path:'/',secure:true}]);
  await context.addInitScript(({automation,optOut})=>{if(!automation)Object.defineProperty(navigator,'webdriver',{get:()=>false});if(optOut)Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true});},{automation:!!scenario.automation,optOut:!!scenario.optOut});
  const meta=html.match(/<meta name="referrer"[^>]+>/)[0];
  const pageHtml=`<!doctype html><html><head><meta charset="UTF-8">${meta}<meta name="pogo-traffic-endpoint" content="${scenario.endpoint??endpoint}"><meta http-equiv="Content-Security-Policy" content="${html.match(/http-equiv="Content-Security-Policy" content="([^"]+)/)[1]}"><title>${secret}</title><script defer src="/trade-app/js/services/traffic.js"></script></head><body><input id="private" value="${secret}"><img src="https://probe.example.test/pixel"><a id="external" href="https://probe.example.test/next">next</a></body></html>`;
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),headers=await request.allHeaders();requests.push({url:url.href,headers,navigation:request.isNavigationRequest()});
   if(url.pathname.endsWith('/traffic.js'))return route.fulfill({contentType:'application/javascript',body:script});
   if(url.hostname===new URL(endpoint).hostname)return route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64')});
   if(url.hostname==='probe.example.test')return route.fulfill({contentType:'text/html',body:'ok'});
   return route.fulfill({contentType:'text/html',body:pageHtml});
  });
  const page=await context.newPage();await page.goto(`${scenario.host||'https://doomsday126dev.github.io'}/trade-app/${scenario.query}`,{waitUntil:'networkidle'});
  if(scenario.expected==='/trade-share'){
   const services=['https://www.gstatic.com/firebase-csp-fixture','https://identitytoolkit.googleapis.com/csp-fixture','https://securetoken.googleapis.com/csp-fixture','https://firebaseinstallations.googleapis.com/csp-fixture','https://firebaseappcheck.googleapis.com/csp-fixture','https://recaptchaenterprise.googleapis.com/csp-fixture','https://s-usc1c-nss-fixture.firebaseio.com/csp-fixture','https://us-central1-trade-list-a4297.cloudfunctions.net/csp-fixture','https://raw.githubusercontent.com/csp-fixture'];
   const results=await page.evaluate(async urls=>Promise.all(urls.map(url=>fetch(url,{mode:'no-cors',credentials:'omit'}).then(()=>true,()=>false))),services);assert.ok(results.every(Boolean),'Existing app connection blocked by CSP');
   for(const url of services)assert.ok(requests.some(request=>request.url===url),url);
   const foreign=await page.evaluate(()=>fetch('https://unapproved.goatcounter.com/count',{mode:'no-cors'}).then(()=>true,()=>false));assert.equal(foreign,false);assert.equal(requests.some(request=>request.url.includes('unapproved.goatcounter.com')),false);
  }
  await page.locator('#private').fill(secret+'changed');await page.evaluate(secret=>{history.replaceState({},'',`?view=${secret}#${secret}`);document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('prerenderingchange'));},secret);
  const counts=requests.filter(r=>new URL(r.url).hostname===new URL(endpoint).hostname);assert.equal(counts.length,scenario.expected?1:0,JSON.stringify(scenario));
  if(counts.length){const counted=counts[0],url=new URL(counted.url);assert.deepEqual([...url.searchParams],[['p',scenario.expected],['t','PoGo Trades'],['r','']]);assert.equal(counted.headers.referer,undefined);assert.equal(counted.headers.cookie,undefined);assert.ok(!JSON.stringify(counted).includes(secret));}
  await page.locator('#external').click();await page.waitForURL('https://probe.example.test/next');
  for(const request of requests){assert.ok(!JSON.stringify(request.headers).includes(secret),'Private value leaked in request headers');if(new URL(request.url).hostname==='probe.example.test')assert.equal(request.headers.referer,undefined);}
  await context.close();
 }
 }finally{await browser.close();}
});
