'use strict';

const fs=require('node:fs');
const path=require('node:path');

function bytes(value){return Buffer.byteLength(value,'utf8');}
function read(root,file){return fs.readFileSync(path.join(root,file),'utf8');}
function inlineScriptBodies(html){
  return[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gu)].map(match=>match[1]);
}
function profileFrontendAssets(root=process.cwd()){
  const html=read(root,'index.html'),css=read(root,'css/app.css'),application=read(root,'js/app/application.js');
  const inlineScripts=inlineScriptBodies(html),inlineJsBytes=inlineScripts.reduce((total,source)=>total+bytes(source),0);
  return Object.freeze({
    documentBytes:bytes(html),
    documentMarkupBytes:bytes(html)-inlineJsBytes,
    inlineJsBytes,
    inlineScriptCount:inlineScripts.length,
    externalCssBytes:bytes(css),
    signedInApplicationBytes:bytes(application),
    extractedFrontendBytes:bytes(css)+bytes(application),
    physicalFrontendBytes:bytes(html)+bytes(css)+bytes(application)
  });
}

if(require.main===module)process.stdout.write(`${JSON.stringify(profileFrontendAssets(),null,2)}\n`);

module.exports={profileFrontendAssets};
