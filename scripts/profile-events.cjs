// Read-only local rendering profile. Requires an explicitly supplied local event
// feed fixture; it never downloads data or connects to a production backend.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {chromium}=require('playwright');
const {fixture}=require('../tests/helpers/usability-fixture.cjs');
const sourceRoot=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const input=process.argv[3];
if(!input){console.error('Usage: node scripts/profile-events.cjs LOCAL_SOURCE_ROOT LOCAL_EVENTS_JSON');process.exit(2);}
const events=JSON.parse(fs.readFileSync(input,'utf8'));
if(!Array.isArray(events))throw new Error('Event fixture must be an array');
const seed={window:{}};vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'data.js'),'utf8'),seed);
seed.window.POGO_TRADE_DB.users=[];
for(const value of Object.values(seed.window.POGO_TRADE_DB))if(Array.isArray(value))for(const row of value)if(row&&typeof row==='object')delete row.users;
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(403);return res.end();}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),relative=pathname==='/'?'/index.html':pathname;
  const file=path.resolve(sourceRoot,'.'+relative);
  if(!file.startsWith(sourceRoot+path.sep)){res.writeHead(403);return res.end();}
  try{
    const data=relative==='/data.js'?'window.POGO_TRADE_DB='+JSON.stringify(seed.window.POGO_TRADE_DB)+';':fs.readFileSync(file);
    res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html');res.end(data);
  }catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    const baseURL=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch();const context=await browser.newContext({baseURL,viewport:{width:1440,height:900},serviceWorkers:'block'});
    if(context.routeWebSocket)await context.routeWebSocket('**',socket=>socket.close());
    const page=await context.newPage();await fixture(page);
    await page.evaluate(events=>{_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';},events);
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const result=await page.evaluate(()=>{
      const runs=[];for(let index=0;index<8;index++){const before=performance.now();renderEventsOnly();runs.push(performance.now()-before);}
      const node=document.getElementById('events-out');return{runs,events:_eventData.events.length,nodes:node.querySelectorAll('*').length,htmlBytes:new Blob([node.innerHTML]).size};
    });
    const sorted=[...result.runs].sort((a,b)=>a-b);result.medianMs=(sorted[3]+sorted[4])/2;
    console.log(JSON.stringify({method:'8 synchronous Events renders; Chromium; 4x CPU; isolated synthetic owner; backend writes and external traffic blocked',browser:browser.version(),...result},null,2));
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
