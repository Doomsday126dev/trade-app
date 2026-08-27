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
  assert.match(html,/script\.async=false[\s\S]*document\.head\.appendChild\(script\)/);
  assert.match(html,/await Promise\.all\(pending\)/);
  assert.match(html,/return window\.__pogoAppReadyPromise\|\|true/);
});

test('release inventory and service worker own both extracted assets',()=>{
  assert.deepEqual(frontendManifest.styleFiles,['css/app.css']);
  assert.ok(frontendManifest.scriptFiles.includes('js/app/application.js'));
  assert.match(worker,/['"]css\/app\.css['"]/);
  assert.match(worker,/['"]js\/app\/application\.js['"]/);
});
