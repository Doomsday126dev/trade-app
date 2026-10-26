'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const COMMIT='5c6bb56c4026e5fe3cd146910c7e9dad9f07d716';
const forms={"Butterfree (Bow)": ["0012-00-00-01", ["m", "f"]], "Raticate Party Hat": ["0020-00-00-01", ["m", "f"]], "Nidorino Party Hat": ["0033-00-00-01", ["m"]], "Vulpix (Halloween)": ["0037-00-00-01", ["m", "f"]], "Ninetales Spooky Festival": ["0038-00-00-01", ["m", "f"]], "Jigglypuff (Ribbon)": ["0039-00-00-01", ["m", "f"]], "Wigglytuff Ribbon": ["0040-00-00-01", ["m", "f"]], "Diglett Fashionable Hat": ["0050-00-00-01", ["m", "f"]], "Dugtrio Fashionable Hat": ["0051-00-00-01", ["m", "f"]], "Grimer (Party Hat)": ["0088-00-00-01", ["m", "f"]], "Muk Party Hat": ["0089-00-00-01", ["m", "f"]], "Cubone (Cempasuchil)": ["0104-00-00-01", ["m", "f"]], "Marowak Cempasuchil Crown": ["0105-00-00-01", ["m", "f"]], "Chansey (Flower Crown)": ["0113-00-00-01", ["f"]], "Togepi (Flower Crown)": ["0175-00-00-01", ["m", "f"]], "Togetic (Flower Crown)": ["0176-00-00-01", ["m", "f"]], "Blissey (Flower Crown)": ["0242-00-00-01", ["f"]], "Buneary Flower Crown": ["0427-00-00-01", ["m", "f"]], "Happiny (Flower Crown)": ["0440-00-00-01", ["f"]], "Togekiss (Flower Crown)": ["0468-00-00-01", ["m", "f"]]};
function validateCostume20ShinyReview(entry,root){
 const r=entry.costume20ShinyArtworkReview,fail=()=>{throw Error('Costume20 Shiny review mismatch: '+entry.names[0]);};
 if(!r){if(Object.values(entry.assets||{}).some(a=>a.includes('pogorewind-costume20-')))fail();return;}
 const form=forms[entry.names[0]],id=form?.[0],genders=form?.[1],distinct=[12,20].includes(entry.no),base='https://raw.githubusercontent.com/Gabrielense/pogorewind/'+COMMIT+'/sprites/';
 if(!id||r.sourceId!==id||r.no!==entry.no||entry.no!==Number(id.slice(0,4))||r.name!==entry.names[0]||r.sourceCommit!==COMMIT||r.shinyAvailability!=='released'||entry.shinyAvailability!=='released'||!r.releaseEvidence?.length||r.releaseEvidence.some(u=>!u.startsWith('https://')))fail();
 if(JSON.stringify(r.sourceGenders)!==JSON.stringify(genders)||r.genderModel!==(distinct?'distinct-wing-or-whisker-models':'shared-no-visual-dimorphism'))fail();
 if(genders.length===1&&JSON.stringify(entry.availableGenders)!==JSON.stringify(genders))fail();
 for(const key of ['default',...(distinct?['female']:[])])if(r.retainedNormal?.[key]?.asset!==entry.assets[key]||r.retainedNormal[key].sha256!==entry.sha256[key])fail();
 const keys=genders.includes('f')?['shiny','femaleShiny']:['shiny'];
 if(!genders.includes('f')&&(entry.assets.femaleShiny||r.assets.femaleShiny))fail();
 for(const key of keys){
  const female=key==='femaleShiny'&&distinct,url=base+id+(female?'%2BF':'')+'%2BS.png',asset='assets/sprites/go/pogorewind-costume20-'+id+(female?'-female':'')+'-shiny.png';
  if(r.sourceUrls[key]!==url||r.assets[key]!==asset||entry.assets[key]!==asset||entry.sha256[key]!==r.sha256[key]||asset===entry.assets.default)fail();
  if(root){const b=fs.readFileSync(path.join(root,asset));if(crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')!==r.gitBlobShas[key])fail();}
 }
 if(root){const proof=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-costume20-shiny-assets.json'))).records.find(p=>p.name===r.name);if(JSON.stringify(proof)!==JSON.stringify(r))fail();}
}
module.exports={validateCostume20ShinyReview,COMMIT};
