const {test,expect}=require('@playwright/test');

const profiles=[
  {name:'desktop',viewport:{width:1440,height:900},cpu:1,budget:{auth:1000,shell:1500,protected:2000}},
  {name:'mobile 390 at 4x CPU',viewport:{width:390,height:844},cpu:4,budget:{auth:1000,shell:3000,protected:3000}},
  {name:'mobile 320 at 6x CPU',viewport:{width:320,height:568},cpu:6,budget:{auth:1500,shell:5000,protected:5000}}
];

const SHELL_BUDGET={
  documentDecodedBytes:140*1024,
  firstPartyTransferredBytes:340*1024,
  firstPartyDecodedBytes:340*1024,
  firstPartyResourceCount:8
};

async function installFirebaseMocks(page,{appCheckFailure=false}={}){
  await page.route('https://static.cloudflareinsights.com/**',route=>route.abort('blockedbyclient'));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:"const app={name:'pogo',options:{appId:'mock-app'}};export function initializeApp(){return app}"
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:"const auth={currentUser:null};export function getAuth(){return auth}export function onAuthStateChanged(_auth,listener){queueMicrotask(()=>listener(null));return()=>{}}export async function signInWithEmailAndPassword(){return{user:null}}export async function createUserWithEmailAndPassword(){return{user:null}}export async function signOut(){}export async function updatePassword(){}export async function deleteUser(){}"
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:"export function getDatabase(){return{}}export function ref(_db,path){return{path}}export async function set(){}export async function update(){}export async function get(){return{exists:()=>false,val:()=>null}}export function onValue(_target,listener){queueMicrotask(()=>listener({exists:()=>false,val:()=>null}));return()=>{}}export async function runTransaction(){}export function serverTimestamp(){return 0}"
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:appCheckFailure
      ?"export class ReCaptchaEnterpriseProvider{}export function initializeAppCheck(){throw new Error('mock-app-check-failure')}"
      :"export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key}}export function initializeAppCheck(){return{kind:'mock-app-check'}}"
  }));
}

test.describe.configure({mode:'serial'});

for(const profile of profiles){
  test(`${profile.name} keeps shell light and protected startup ordered`,async({browser})=>{
    const context=await browser.newContext({viewport:profile.viewport,isMobile:profile.viewport.width<600,hasTouch:profile.viewport.width<600,serviceWorkers:'block'});
    const page=await context.newPage();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:profile.cpu});
    await installFirebaseMocks(page);
    await page.addInitScript(()=>{
      window.__startupLongTasks=[];
      try{new PerformanceObserver(list=>window.__startupLongTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask',buffered:true});}catch{}
    });
    await page.goto(`./?startup-performance=${profile.cpu}-${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__pogoShellReady===true);
    const shell=await page.evaluate(()=>{
      const resources=performance.getEntriesByType('resource'),navigation=performance.getEntriesByType('navigation')[0];
      const firstParty=resources.filter(entry=>new URL(entry.name).origin===location.origin);
      return{
        authKnown:window.__pogoStartup.authStateKnownAt,
        interactive:window.__pogoStartup.shellInteractiveAt,
        documentDecodedBytes:navigation?.decodedBodySize||0,
        firstPartyResourceCount:firstParty.length,
        firstPartyTransferredBytes:firstParty.reduce((total,entry)=>total+(entry.transferSize||entry.encodedBodySize||0),0),
        firstPartyDecodedBytes:firstParty.reduce((total,entry)=>total+(entry.decodedBodySize||0),0),
        eagerFirstPartyScripts:firstParty.filter(entry=>entry.initiatorType==='script').length,
        signedInApplicationLoaded:firstParty.some(entry=>/\/js\/app\/application\.js(?:\?|$)/.test(entry.name)),
        protectedRequested:window.__pogoStartup.protectedRequestedAt,
        appCheckStarted:window.__pogoStartup.appCheckStartedAt,
        appCheckResources:resources.filter(entry=>/firebase-app-check|recaptcha/.test(entry.name)).length
      };
    });
    expect(shell.authKnown).toBeLessThan(profile.budget.auth);
    expect(shell.interactive).toBeLessThan(profile.budget.shell);
    expect(shell.documentDecodedBytes).toBeLessThanOrEqual(SHELL_BUDGET.documentDecodedBytes);
    expect(shell.firstPartyResourceCount).toBeLessThanOrEqual(SHELL_BUDGET.firstPartyResourceCount);
    expect(shell.firstPartyTransferredBytes).toBeLessThanOrEqual(SHELL_BUDGET.firstPartyTransferredBytes);
    expect(shell.firstPartyDecodedBytes).toBeLessThanOrEqual(SHELL_BUDGET.firstPartyDecodedBytes);
    expect(shell.eagerFirstPartyScripts).toBe(0);
    expect(shell.signedInApplicationLoaded).toBe(false);
    expect(shell.protectedRequested).toBeNull();
    expect(shell.appCheckStarted).toBeNull();
    expect(shell.appCheckResources).toBe(0);

    await page.evaluate(()=>window.__pogoEnsureFullApp('performance-test'));
    await page.waitForFunction(()=>window.__pogoStartup.protectedReadyAt!==null);
    const protectedState=await page.evaluate(async()=>{
      const firstReady=window.__pogoStartup.protectedReadyAt;
      const request=window.__pogoStartup.protectedRequestedAt;
      await Promise.all([ensureFirebaseDataProtection(),ensureFirebaseDataProtection()]);
      const resources=performance.getEntriesByType('resource');
      return{
        elapsed:firstReady-request,
        appCheckStartedAfterRequest:window.__pogoStartup.appCheckStartedAt>=request,
        readyAfterAppCheck:firstReady>=window.__pogoStartup.appCheckReadyAt,
        appCheckImports:resources.filter(entry=>/firebase-app-check\.js/.test(entry.name)).length,
        featureScriptCount:resources.filter(entry=>entry.initiatorType==='script'&&new URL(entry.name).origin===location.origin).length,
        signedInApplicationLoaded:resources.some(entry=>/\/js\/app\/application\.js(?:\?|$)/.test(entry.name)),
        maxLongTask:Math.max(0,...window.__startupLongTasks)
      };
    });
    expect(protectedState.elapsed).toBeLessThan(profile.budget.protected);
    expect(protectedState.appCheckStartedAfterRequest).toBe(true);
    expect(protectedState.readyAfterAppCheck).toBe(true);
    expect(protectedState.appCheckImports).toBe(1);
    expect(protectedState.featureScriptCount).toBeLessThanOrEqual(75);
    expect(protectedState.signedInApplicationLoaded).toBe(true);
    expect(protectedState.maxLongTask).toBeLessThanOrEqual(200);
    console.log(`STARTUP_PERF ${JSON.stringify({profile:profile.name,shell,protected:protectedState})}`);
    await context.close();
  });
}

test('failed App Check never activates the protected database client',async({page})=>{
  await installFirebaseMocks(page,{appCheckFailure:true});
  await page.goto(`./?startup-app-check-failure=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.__pogoEnsureFullApp('protected-failure-test'));
  await page.waitForFunction(()=>window.__pogoStartup.firebaseStartupSettledAt!==null);
  expect(await page.evaluate(()=>({dbActive:db!==null,fbOn,ready:firebaseDataProtectionReady,appVisible:getComputedStyle(document.getElementById('app')).display!=='none'}))).toEqual({dbActive:false,fbOn:false,ready:false,appVisible:false});
});
