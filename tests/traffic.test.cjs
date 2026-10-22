const {test}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const api=require('../js/services/traffic.js');
const endpoint='https://trade-fixture.goatcounter.com/count',secret='SYNTHETIC_PRIVATE_TRAINER_TOKEN_9f3';
function fixture({href=`https://doomsday126dev.github.io/trade-app/?view=${secret}&search=CP123#${secret}`,configured=endpoint,policy="connect-src 'self' https://trade-fixture.goatcounter.com",visibility='visible',...nav}={}){
 const listeners=new Map(),calls=[],document={visibilityState:visibility,prerendering:false,title:secret,referrer:`https://example.test/${secret}`,
 querySelector:()=>({content:configured}),querySelectorAll:()=>policy?[{httpEquiv:'Content-Security-Policy',content:policy}]:[],
 addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 const window={location:new URL(href),doNotTrack:'0'};window.top=window.self=window;
 const navigator={onLine:true,webdriver:false,...nav};
 return {window,document,navigator,calls,emit:name=>listeners.get(name)?.(),fetch:(...args)=>{calls.push(args);return Promise.resolve();}};
}
test('strict public collector validation rejects missing, shared, malformed or credential-bearing endpoints',()=>{
 for(const value of ['',endpoint+'?token=x',endpoint+'#x',endpoint.replace('https:','http:'),'https://doomsday126dev.goatcounter.com/count','https://trade-fixture.goatcounter.com.evil.test/count','https://user:secret@trade-fixture.goatcounter.com/count','https://trade-fixture.goatcounter.com/other','https://trade-fixture.goatcounter.com:444/count'])assert.equal(api.collectorEndpoint(value),null,value);
 assert.equal(api.collectorEndpoint(endpoint).href,endpoint);
});
test('request contains only static category/title and empty referrer; zero private values',()=>{
 const f=fixture();api.install(f);assert.equal(f.calls.length,1);const [url,options]=f.calls[0],u=new URL(url);
 assert.deepEqual([...u.searchParams],[['p','/trade-share'],['t','PoGo Trades'],['r','']]);assert.ok(!url.includes(secret));assert.equal(u.hash,'');
 assert.deepEqual(options,{method:'GET',mode:'no-cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',keepalive:true});
 f.window.location=new URL(`https://doomsday126dev.github.io/trade-app/?view=OTHER#${secret}`);f.emit('visibilitychange');assert.equal(f.calls.length,1);
});
test('one document count survives repeated edits, tab/history/visibility changes and rejection without retry',async()=>{
 const f=fixture({href:`https://doomsday126dev.github.io/trade-app/?account=${secret}#${secret}`});f.fetch=(...args)=>{f.calls.push(args);return Promise.reject(Error(secret));};api.install(f);
 for(let i=0;i<5;i++){f.document.title=secret+i;f.emit('visibilitychange');}await Promise.resolve();assert.equal(f.calls.length,1);assert.equal(new URL(f.calls[0][0]).searchParams.get('p'),'/trade');
 const throwing=fixture();throwing.fetch=()=>{throw Error(secret);};assert.doesNotThrow(()=>api.install(throwing));
});
test('hidden/prerender documents defer until visible and count once',()=>{
 const f=fixture({visibility:'hidden'});api.install(f);assert.equal(f.calls.length,0);f.document.visibilityState='visible';f.document.prerendering=true;f.emit('visibilitychange');assert.equal(f.calls.length,0);f.document.prerendering=false;f.emit('prerenderingchange');assert.equal(f.calls.length,1);
});
test('local, preview, unknown paths, frames, offline, automation and supported opt-outs send nothing',()=>{
 const cases=[{href:'http://localhost/trade-app/'},{href:'https://preview.example/trade-app/'},{href:`https://doomsday126dev.github.io/trade-app/private/${secret}`},{onLine:false},{webdriver:true},{globalPrivacyControl:true},{doNotTrack:'1'},{doNotTrack:'yes'}];
 for(const value of cases){const f=fixture(value);api.install(f);assert.equal(f.calls.length,0,JSON.stringify(value));}
 const f=fixture();f.window.top={};api.install(f);assert.equal(f.calls.length,0);
 const legacy=fixture({doNotTrack:'0'});legacy.window.doNotTrack='1';api.install(legacy);assert.equal(legacy.calls.length,0);
 const ms=fixture({msDoNotTrack:'1'});api.install(ms);assert.equal(ms.calls.length,0);
});
test('configuration is fail-closed without an exact collector connect-src, including broad sources',()=>{
 for(const props of [{configured:''},{policy:''},{policy:"connect-src 'self'"},{policy:"connect-src * https://trade-fixture.goatcounter.com"},{policy:'connect-src https: https://trade-fixture.goatcounter.com'}]){const f=fixture(props);api.install(f);assert.equal(f.calls.length,0);}
});
test('enabled HTML pins the verified collector, removes legacy tracker and sets one early no-referrer policy',()=>{
 const html=readFileSync('index.html','utf8');assert.match(html,/<meta name="pogo-traffic-endpoint" content="https:\/\/doomsday126dev-trade\.goatcounter\.com\/count">/);assert.equal((html.match(/name="referrer"/g)||[]).length,1);assert.ok(html.indexOf('name="referrer"')<html.indexOf('<script'));assert.doesNotMatch(html,/cloudflareinsights|data-cf-beacon/);assert.match(html,/GoatCounter provides basic traffic counting/);
 const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)/)[1];assert.ok(policy.includes('https://doomsday126dev-trade.goatcounter.com'));assert.doesNotMatch(policy,/\*\.goatcounter|connect-src \*/);
 assert.equal(api.exactCollectorPolicy({querySelectorAll:()=>[{httpEquiv:'Content-Security-Policy',content:policy}]},'https://doomsday126dev-trade.goatcounter.com'),true);
});
