'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const proofPath=path.resolve(__dirname,'../../data/reviewed-consolidated-shiny-assets.json');
const PROOF_SHA='c9f9ef1daee810692a04781fd9fee9fc8fa28017f34654e99c2812261fd92ba9';
const proof=JSON.parse(fs.readFileSync(proofPath));
function validateConsolidatedShinyReview(entry,root){
 const r=entry.consolidatedShinyArtworkReview,fail=()=>{throw Error('Consolidated Shiny review mismatch: '+entry.names[0]);};
 const expected=proof.records.find(p=>p.name===entry.names[0]);
 if(!r){if(expected&&!entry.costume20ShinyArtworkReview)fail();if(Object.values(entry.assets||{}).some(a=>a.includes('pogorewind-consolidated-')))fail();return;}
 if(crypto.createHash('sha256').update(fs.readFileSync(root?path.join(root,'data/reviewed-consolidated-shiny-assets.json'):proofPath)).digest('hex')!==PROOF_SHA)fail();
 if(!expected||JSON.stringify(expected)!==JSON.stringify(r)||r.no!==entry.no||entry.shinyAvailability!=='released')fail();
 if(r.sourceGenders.length===1&&JSON.stringify(entry.availableGenders)!==JSON.stringify(r.genderModel==='genderless'?[]:r.sourceGenders))fail();
 for(const [key,a]of Object.entries(r.retainedNormal))if(entry.assets[key]!==a.asset||entry.sha256[key]!==a.sha256)fail();
 if(JSON.stringify(Object.keys(entry.assets).filter(k=>/shiny/i.test(k)).sort())!==JSON.stringify(Object.keys(r.assets).sort()))fail();
 for(const [key,asset]of Object.entries(r.assets)){
  if(entry.assets[key]!==asset||entry.sha256[key]!==r.sha256[key])fail();
  if(root){const b=fs.readFileSync(path.join(root,asset));if(crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')!==r.gitBlobShas[key])fail();}
 }
}
module.exports={validateConsolidatedShinyReview,PROOF_SHA};
