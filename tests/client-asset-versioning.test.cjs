const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const worker=readFileSync(path.join(root,'sw.js'),'utf8');
const locale=readFileSync(path.join(root,'js/i18n/locales/en.js'),'utf8');
const release=html.match(/window\.__POGO_RELEASE_ID='([^']+)'/)?.[1];
const firstPartyScripts=[...html.matchAll(/<script\s+src="([^"]+)"/g)]
  .map(match=>match[1])
  .filter(src=>!/^https?:\/\//.test(src));

function loadDomain(files){
  const window={};
  const context=vm.createContext({window,URL});
  files.forEach(file=>vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
  return window.PogoDomain;
}

test('every first-party JavaScript URL uses the current release identifier',()=>{
  assert.ok(release);
  assert.ok(firstPartyScripts.length>30);
  firstPartyScripts.forEach(src=>assert.equal(new URL(src,'https://example.test/').searchParams.get('v'),release,src));
  assert.ok(html.includes("serviceWorker.register(`./sw.js?v=${window.__POGO_RELEASE_ID}`)"));
  assert.match(worker,new RegExp(`const RELEASE='${release.replaceAll('.','\\.')}';`));
  const precached=[...worker.matchAll(/^\s+'([^']+\.js)',?$/gm)].map(match=>match[1]);
  const requested=firstPartyScripts.map(src=>new URL(src,'https://example.test/').pathname.slice(1));
  assert.deepEqual(precached,requested);
});

test('release changes produce different critical module and cache keys',()=>{
  const current=`js/domain/trainerDiscovery.js?v=${release}`;
  const next=`js/domain/trainerDiscovery.js?v=${release}.next`;
  assert.notEqual(current,next);
  assert.match(worker,/const VERSION=`pogo-trades-\$\{RELEASE\}`/);
  assert.match(worker,/SHELL_CACHE=`shell-\$\{VERSION\}`/);
});

test('new HTML never requests an unversioned trainer-discovery module',()=>{
  assert.doesNotMatch(html,/<script src="js\/domain\/trainerDiscovery\.js"><\/script>/);
  assert.match(html,new RegExp(`<script src="js/domain/trainerDiscovery\\.js\\?v=${release.replaceAll('.','\\.')}"><\\/script>`));
});

test('service worker keeps exact release keys and retires old app-shell caches',()=>{
  assert.doesNotMatch(worker,/ignoreSearch\s*:\s*true/);
  assert.match(worker,/url\.searchParams\.get\('v'\)===RELEASE\?releaseAsset\(req\):networkFirst\(req\)/);
  assert.match(worker,/self\.skipWaiting\(\)/);
  assert.match(worker,/self\.clients\.claim\(\)/);
  assert.match(worker,/caches\.delete\(n\)/);
});

test('a cached old discovery API produces a controlled reload-required state',()=>{
  const releaseDomain=loadDomain(['js/domain/clientRelease.js']).clientRelease;
  const oldDiscovery={fold(){},trainerSuggestions(){return[];}};
  const state=releaseDomain.trainerSearchControlState(oldDiscovery);
  assert.deepEqual(JSON.parse(JSON.stringify(state)),{
    compatible:false,searchDisabled:true,reloadRequired:true,statusKey:'app.updateRequired',
    code:'client/reload-required',missing:['bestTrainerSuggestion']
  });
  assert.match(html,/if\(!requireCompatibleTrainerSearch\(\)\)\{event\.preventDefault\(\);return;\}/);
  assert.match(html,/if\(input\)input\.disabled=true/);
  assert.match(html,/if\(button\)button\.disabled=true/);
  assert.match(html,/find-trainer-reload/);
  assert.match(html,/onclick="reloadCompatibleClient\(\)"/);
  assert.match(html,/name\.startsWith\('shell-pogo-trades-'\)/);
  assert.match(html,/registration\?\.update\?\.\(\)/);
  assert.match(locale,/'app\.updateRequired':'A new version is available\. Refresh to continue\.'/);
});

test('coherent reload restores exact, partial, and interactive trainer search',()=>{
  const domain=loadDomain(['js/domain/priorityValues.js','js/domain/clientRelease.js','js/domain/trainerDiscovery.js']);
  const state=domain.clientRelease.trainerSearchControlState(domain.trainerDiscovery);
  assert.equal(state.compatible,true);
  assert.equal(domain.trainerDiscovery.bestTrainerSuggestion(['ScoopskiPotat0'],'scoo').name,'ScoopskiPotat0');
  assert.equal(domain.trainerDiscovery.bestTrainerSuggestion(['ScoopskiPotat0'],'SCOOPSKIPOTAT0').name,'ScoopskiPotat0');
  assert.match(html,/onkeydown="trainerSearchKeydown\(event\)"/);
  assert.match(html,/onclick="selectTrainerSuggestion\(\$\{index\}\)"/);
  assert.match(html,/event\.key==='ArrowDown'\|\|event\.key==='ArrowUp'/);
  assert.match(html,/event\.key==='Enter'/);
});

test('asset versioning does not change public-share or Firebase behavior',()=>{
  assert.match(html,/managedPublicShareRepository\.read/);
  assert.match(html,/publicShares\/\$\{username\}/);
  assert.doesNotMatch(worker,/firebaseio.*cache\.put|firebasedatabase.*cache\.put/);
  assert.match(worker,/if\(isFirebase\(url\)\)return/);
});
