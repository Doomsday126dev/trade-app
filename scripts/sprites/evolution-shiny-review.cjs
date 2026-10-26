'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const COMMIT='5c6bb56c4026e5fe3cd146910c7e9dad9f07d716';
const forms={'Raichu Beanie':'0026-00-00-09','Raichu Cherry Blossoms':'0026-00-00-12','Raichu Flower Crown':'0026-00-00-07','Raichu Fragment Cap':'0026-00-00-06','Raichu Holiday 2023':'0026-00-00-14','Raichu New Year':'0026-00-00-11','Raichu Original Cap':'0026-00-00-03','Raichu Party Hat':'0026-00-00-02','Raichu Santa Hat':'0026-00-00-01','Raichu Summer Style':'0026-00-00-05','Raichu Witch Hat':'0026-00-00-04','Raichu World Cap':'0026-00-00-10','Eevee (Cherry Blossom)':'0133-00-00-04','Eevee (Explorer)':'0133-00-00-05','Eevee (Flower Crown)':'0133-00-00-01','Eevee (Holiday)':'0133-00-00-03','Eevee (Moon)':'0133-00-00-07','Eevee (Red Party)':'0133-00-00-02','Eevee (Sun)':'0133-00-00-06','Pichu (Ash)':'0172-00-00-01','Pichu (Cherry Blossom)':'0172-00-00-09','Pichu (Flower Crown)':'0172-00-00-07','Pichu (New Year)':'0172-00-00-08','Pichu (Party)':'0172-00-00-04','Pichu (Santa)':'0172-00-00-03','Pichu (Summer)':'0172-00-00-05','Pichu (Winter)':'0172-00-00-06','Pichu (Witch)':'0172-00-00-02'};
function validateEvolutionShinyReview(entry,root){
 const r=entry.evolutionShinyArtworkReview,fail=()=>{throw Error('Evolution Shiny review mismatch: '+entry.names[0]);};
 if(!r){if(Object.values(entry.assets||{}).some(a=>a.includes('pogorewind-evolution-')))fail();return;}
 const id=forms[entry.names[0]],base='https://raw.githubusercontent.com/Gabrielense/pogorewind/'+COMMIT+'/sprites/';
 if(!id||r.sourceId!==id||r.no!==entry.no||entry.no!==Number(id.slice(0,4))||r.name!==entry.names[0]||r.sourceCommit!==COMMIT||r.shinyAvailability!=='released'||entry.shinyAvailability!=='released'||!r.releaseEvidence?.length||r.releaseEvidence.some(u=>!u.startsWith('https://')))fail();
 if(r.genderModel!==(entry.no===172?'shared-no-visual-dimorphism':'distinct-tail-models'))fail();
 for(const key of ['default',...(entry.no===172?[]:['female'])])if(r.retainedNormal?.[key]?.asset!==entry.assets[key]||r.retainedNormal[key].sha256!==entry.sha256[key])fail();
 for(const key of ['shiny','femaleShiny']){
  const female=key==='femaleShiny'&&entry.no!==172,url=base+id+(female?'%2BF':'')+'%2BS.png',asset='assets/sprites/go/pogorewind-evolution-'+id+(female?'-female':'')+'-shiny.png';
  if(r.sourceUrls[key]!==url||r.assets[key]!==asset||entry.assets[key]!==asset||entry.sha256[key]!==r.sha256[key]||asset===entry.assets.default)fail();
  if(root){const b=fs.readFileSync(path.join(root,asset));if(crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')!==r.gitBlobShas[key])fail();}
 }
 if(root){const proof=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-evolution-shiny-assets.json'))).records.find(p=>p.name===r.name);if(JSON.stringify(proof)!==JSON.stringify(r))fail();}
}
module.exports={validateEvolutionShinyReview,COMMIT};
