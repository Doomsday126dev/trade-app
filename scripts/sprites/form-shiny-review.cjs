'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const COMMIT='5c6bb56c4026e5fe3cd146910c7e9dad9f07d716';
const patterns={'Archipelago':1,'Continental':2,'Sandstorm':3,'Elegant':4,'Garden':5,'Marine':6,'Modern':7,'Monsoon':8,'Icy Snow':9,'Ocean':10,'High Plains':11,'Polar':12,'Meadow':13,'River':14,'Savanna':15,'Jungle':16,'Sun':17,'Tundra':18};
function sourceId(entry){
 if(entry.no===201){const form=entry.names[0].match(/^Unown \(([A-Z!?])\)$/)?.[1];if(!form)return null;return '0201-00-'+String(form==='!'?27:form==='?'?28:form.charCodeAt(0)-64).padStart(2,'0');}
 if(entry.no===666&&patterns[entry.names[0]])return '0666-00-'+String(patterns[entry.names[0]]).padStart(2,'0');
 return entry.no===327&&entry.names[0]==='Spinda (Heart)'?'0327-00-09':null;
}
function validateFormShinyReview(entry,root){
 const r=entry.formShinyArtworkReview,fail=()=>{throw Error('Form Shiny review mismatch: '+entry.names[0]);};
 if(!r){if(Object.values(entry.assets||{}).some(a=>a.includes('pogorewind-form-')))fail();return;}
 const id=sourceId(entry),base='https://raw.githubusercontent.com/Gabrielense/pogorewind/'+COMMIT+'/sprites/';
 if(!id||r.name!==entry.names[0]||r.no!==entry.no||r.sourceId!==id||r.sourceCommit!==COMMIT||r.shinyAvailability!=='released'||entry.shinyAvailability!=='released'||!r.releaseEvidence?.length||r.releaseEvidence.some(u=>!u.startsWith('https://')))fail();
 if(r.genderModel!==(entry.no===201?'genderless':'shared-no-visual-dimorphism')||r.sourceUrl!==base+id+'%2BS.png'||r.normalReference?.url!==base+id+'.png'||r.asset!=='assets/sprites/go/pogorewind-form-'+id+'-shiny.png')fail();
 if(r.retainedNormal?.asset!==entry.assets.default||r.retainedNormal?.sha256!==entry.sha256.default||r.asset===entry.assets.default||entry.assets.shiny!==r.asset||entry.sha256.shiny!==r.sha256)fail();
 if(entry.no!==201&&(entry.assets.femaleShiny!==r.asset||entry.sha256.femaleShiny!==r.sha256))fail();
 if(entry.no===201&&entry.assets.femaleShiny)fail();
 if(root){const proof=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-form-shiny-assets.json'))).records.find(p=>p.name===r.name);if(JSON.stringify(proof)!==JSON.stringify(r))fail();const b=fs.readFileSync(path.join(root,r.asset));if(crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')!==r.gitBlobSha)fail();}
}
module.exports={validateFormShinyReview,sourceId,COMMIT};
