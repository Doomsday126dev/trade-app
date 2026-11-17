'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {profileFrontendAssets}=require('../scripts/profile-frontend-assets.cjs');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const frontendManifest=JSON.parse(fs.readFileSync(path.join(root,'scripts/pages/frontend-files.json'),'utf8'));
const RELEASE_ID=html.match(/window\.__POGO_RELEASE_ID='([^']+)'/)?.[1];

test('the physical document keeps signed-in application and stable CSS external',()=>{
  const metrics=profileFrontendAssets(root);
  assert.ok(metrics.documentBytes<=160*1024,`index.html is ${metrics.documentBytes} bytes`);
  assert.ok(metrics.inlineJsBytes<=32*1024,`inline bootstrap JavaScript is ${metrics.inlineJsBytes} bytes`);
  assert.equal(metrics.inlineScriptCount,2);
  assert.doesNotMatch(html,/<style\b|pogo-app-source/u);
  assert.match(html,new RegExp(`<link rel="stylesheet" href="css/app\\.css\\?v=${RELEASE_ID}">`));
  assert.equal((html.match(/js\/app\/application\.js\?v=/g)||[]).length,1);
});

test('the signed-in application is the final ordered feature asset',()=>{
  const featureTemplate=html.match(/<template id="pogo-feature-assets">([\s\S]*?)<\/template>/)?.[1]||'';
  const scripts=[...featureTemplate.matchAll(/<script src="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(scripts.at(-1),`js/app/application.js?v=${RELEASE_ID}`);
  assert.match(html,/script\.async=!ordered[\s\S]*document\.head\.appendChild\(script\)/);
  assert.equal(new Set(scripts).size,scripts.length,'feature assets must not repeat');
  assert.ok(scripts.includes(`js/services/firebaseClient.js?v=${RELEASE_ID}`),'Firebase prerequisite remains in the graph');
  const loader=html.slice(html.indexOf('  async function loadFeatureScripts(){'),html.indexOf('  async function confirmFullAppReady(){'));
  assert.match(loader,/hint\.rel='preload';hint\.as='script'/);
  assert.match(loader,/for\(const src of sources\)await loadScript\(src,\{ordered:true\}\)/);
  assert.doesNotMatch(loader,/Promise\.all/,'parallel fetch must not execute dependants after a failed prerequisite');
});

test('full app readiness fails closed and failed startup remains retryable',()=>{
  const readiness=html.slice(html.indexOf('  async function confirmFullAppReady(){'),html.indexOf('  async function loadPublicShareScripts()'));
  assert.match(readiness,/if\(!ready\|\|typeof ready\.then!=='function'\)throw/);
  assert.match(readiness,/await ready;[\s\S]*if\(window\.__pogoBootComplete!==true\)throw/);
  const startup=html.slice(html.indexOf("  function ensureFullApp(reason="),html.indexOf('  function revealPrivacyNotice(){'));
  assert.match(startup,/if\(featureLoadPromise\)return featureLoadPromise/);
  assert.match(startup,/\.then\(loadFeatureScripts\)\.then\([\s\S]*return confirmFullAppReady\(\)/);
  assert.match(startup,/\.catch\(error=>\{featureLoadPromise=null;shellFailure\(error\);throw error;\}\)/);
  assert.doesNotMatch(startup,/__pogoAppReadyPromise\|\|true/);
});

test('release inventory and service worker own both extracted assets',()=>{
  assert.deepEqual(frontendManifest.styleFiles,['css/app.css']);
  assert.ok(frontendManifest.scriptFiles.includes('js/app/application.js'));
  assert.match(worker,/['"]css\/app\.css['"]/);
  assert.match(worker,/['"]js\/app\/application\.js['"]/);
});
