'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {configuration,validateConfiguration,configBlock,replaceConfiguration}=require('../scripts/environments/configuration.cjs');
const {buildProfile,compareProfiles,CONTROL_SHA}=require('../scripts/environments/build-profile.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
for(const profile of ['production','staging']){
  test(`${profile} rejects missing, cross-project and cross-profile runtime identities`,()=>{
    const original=configuration(profile),other=configuration(profile==='production'?'staging':'production');
    assert.equal(validateConfiguration(original,profile),original);
    for(const field of Object.keys(original.firebase)){
      const missing=clone(original);delete missing.firebase[field];assert.throws(()=>validateConfiguration(missing,profile));
      const mixed=clone(original);mixed.firebase[field]=other.firebase[field];assert.throws(()=>validateConfiguration(mixed,profile),field);
    }
    for(const field of ['profile','appCheckSiteKey']){const mixed=clone(original);mixed[field]=other[field];assert.throws(()=>validateConfiguration(mixed,profile),field);}
    const extra=clone(original);extra.serviceAccount={privateKey:'forbidden'};assert.throws(()=>validateConfiguration(extra,profile));
  });
  test(`${profile} boot config and ordinary transports use only that profile`,async()=>{
    const document=replaceConfiguration(html,configuration(profile)),block=configBlock(document);
    const window={};
    vm.runInNewContext(document.slice(block.start,document.indexOf('function parsePogoPublicShareRequest()')),{window,Object});
    assert.equal(window.__POGO_ENVIRONMENT.profile,profile);assert.ok(Object.isFrozen(window.__POGO_FIREBASE_CONFIG));
    const context={window,URL,AbortController,setTimeout,clearTimeout};
    for(const file of ['favoriteResolverClient','favoriteWriteTransport'])vm.runInNewContext(fs.readFileSync(path.join(root,`js/services/${file}.js`),'utf8'),context);
    const calls=[],auth={currentUser:{uid:'owner',getIdToken:async()=> 'synthetic-token'}},deps={auth,ownerUid:'owner',enabled:true,sessionCurrent:()=>true,
      appCheckReady:async()=>({ok:true,instance:{}}),loadAppCheckSdk:async()=>({getToken:async()=>({token:'synthetic-appcheck'}),getLimitedUseToken:async()=>({token:'synthetic-appcheck'})})};
    const resolver=window.PogoServices.favoriteResolverClient.createFavoriteResolverClient({...deps,fetch:async(url)=>{calls.push(url);return{ok:true,text:async()=>JSON.stringify({version:1,results:[{handle:'SyntheticRecipient',status:'unavailable'}]})};}});
    await resolver.resolve(['SyntheticRecipient']);
    const transport=window.PogoServices.favoriteWriteTransport.createFavoriteWriteTransport({...deps,fetch:async(url)=>{calls.push(url);return{ok:true,status:204};}});
    await transport.update(null,{'accountSync/owner/favorites/target':{},'favoriteSlots/owner/s0':'target'});
    assert.equal(calls[0],`https://us-central1-${configuration(profile).firebase.projectId}.cloudfunctions.net/resolveLegacyFavoriteIdentities`);
    assert.equal(new URL(calls[1]).origin,configuration(profile).firebase.databaseURL);
    const opposite=configuration(profile==='production'?'staging':'production');
    assert.ok(calls.every(url=>!url.includes(opposite.firebase.projectId)));
  });
}
test('incomplete configuration cannot fall back during browser bootstrap',()=>{
  const invalid=configuration('staging');delete invalid.firebase.databaseURL;
  const document=replaceConfiguration(html,invalid),block=configBlock(document),window={};
  assert.throws(()=>vm.runInNewContext(document.slice(block.start,document.indexOf('function parsePogoPublicShareRequest()')),{window,Object}),/configuration is incomplete/);
  assert.equal(window.__POGO_FIREBASE_CONFIG,undefined);
});
test('reviewed source retains production values and both App Check consumers use the profile',()=>{
  assert.deepEqual(configBlock(html).value,configuration('production'));
  assert.match(fs.readFileSync(path.join(root,'js/app/application.js'),'utf8'),/FIREBASE_APP_CHECK_SITE_KEY=window\.__POGO_ENVIRONMENT\.appCheckSiteKey/);
  assert.match(fs.readFileSync(path.join(root,'js/app/publicShareApp.js'),'utf8'),/APP_CHECK_SITE_KEY=global\.__POGO_ENVIRONMENT\.appCheckSiteKey/);
});
test('explicit profiles preserve all application bytes outside configuration and provenance',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pogo-profiles-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const common={source:root,controlRoot:root,runtimeSourceSha:'a'.repeat(40),sourceTree:'b'.repeat(40),runtimeReleaseId:'2026-09-27.124',runtimeReleaseTag:'release-2026-09-27.124',
    dispatcherSha:'fe32497866cb09f5fbef2df23d4918c00241c64d',controlSelectorTag:'release-pages-control-fe32497866cb09f5fbef2df23d4918c00241c64d',controlWorkflowSha:CONTROL_SHA,githubRunId:'0'};
  const p=path.join(temp,'production'),s=path.join(temp,'staging');
  const a=buildProfile({...common,output:p,profile:'production'}),b=buildProfile({...common,output:s,profile:'staging'});
  assert.notEqual(a.artifact_digest,b.artifact_digest);assert.equal(a.environment_profile,'production');assert.equal(b.environment_profile,'staging');
  const result=compareProfiles(p,s,root);assert.equal(result.applicationBytesEquivalent,true);assert.deepEqual(result.differenceFiles,['deployment-manifest.json','index.html']);
  fs.appendFileSync(path.join(s,'js/app/application.js'),'\n/* unexpected change */');assert.throws(()=>compareProfiles(p,s,root),/Application\/runtime bytes differ/);
});
test('configuration block replacement rejects missing or duplicated boundaries',()=>{
  assert.throws(()=>replaceConfiguration('<html></html>',configuration('staging')));
  assert.throws(()=>replaceConfiguration(html+html,configuration('staging')));
  assert.throws(()=>configuration('auto'));
});
