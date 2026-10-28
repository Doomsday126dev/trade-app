'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const STELLAR_EVIDENCE_SHA='9e8fd86caf90e20c4a6765902dbd5644c22119679b037e20a913b058886d9c38';
function validateSameAppearanceException(row,root){
 if(!row.sameAppearanceEvidence)return false;
 const reject=()=>{throw Error('Invalid same-appearance exception: '+row.names?.[0]);};
 const hash='b75a0f0b5290c0ac531dd7bca52e21d3056de9bdb3451e631e2c0513f4b77901';
 if(row.sameAppearanceEvidence!=='stellar-palette-10277-v1'||row.no!==1024||JSON.stringify(row.names)!=='["Terapagos (Stellar Form)"]'||row.sourceId!=='canonical-missing:1024:stellar terapagos'||row.normalRelease!=='unverified'||row.shinyRelease!=='unverified'||row.independentFormIdentity?.id!==10277||row.independentFormIdentity?.speciesId!==1024||row.independentFormIdentity?.identifier!=='terapagos-stellar'||JSON.stringify(row.genders)!=='[]')reject();
 for(const key of ['default','shiny'])if(row.sha256?.[key]!==hash||row.artProof?.[key]?.sha256!==hash||row.assets?.[key]!=='assets/sprites/go/catalogue-'+hash.slice(0,20)+'.png'||row.artProof[key].url!=='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'+(key==='shiny'?'shiny/':'')+'10277.png')reject();
 const evidence=fs.readFileSync(path.join(root,'data/stellar-same-appearance-evidence.json'));
 if(crypto.createHash('sha256').update(evidence).digest('hex')!==STELLAR_EVIDENCE_SHA)reject();
 return true;
}
function validateReviewedAssets(root){
 const data=JSON.parse(fs.readFileSync(path.join(root,'data/catalogue-reviewed-assets.json'),'utf8')),seen=new Set();if(data.schemaVersion!==1||!Array.isArray(data.records))throw Error('Invalid reviewed catalogue assets');
 for(const row of data.records){
  if(!Number.isInteger(row.no)||row.no<=0||!row.names?.length||seen.has(row.names[0])||row.status!=='exact'||!Array.isArray(row.genders)||row.genders.some(g=>!['f','m'].includes(g))||!row.evidence?.length)throw Error('Invalid reviewed catalogue identity');seen.add(row.names[0]);
  if(row.sourceId?.startsWith('variant-followup:spooky-size:')){
   const species=row.no===710?'Pumpkaboo':row.no===711?'Gourgeist':null,match=row.names[0].match(/^(Pumpkaboo|Gourgeist) \(Spooky Festival, (Small|Average|Large|Super) Size\)$/);
   if(!species||!match||match[1]!==species)throw Error('Wrong Spooky Festival identity');
   const size=match[2].toLowerCase(),suffix={small:'s',average:'',large:'l',super:'h'}[size];
   if(row.artProof.default.url!=='https://img.pokemondb.net/sprites/go/normal/1x/'+species.toLowerCase()+'-'+size+'-spooky-festival.png'||row.artProof.shiny.url!=='https://www.serebii.net/pokemongo/pokemon/shiny/'+row.no+'-spooky'+suffix+'.png')throw Error('Wrong Spooky Festival size/variant source');
  }
  for(const key of ['default','shiny']){
   const proof=row.artProof?.[key],file=row.assets?.[key];
   if(!file&&key==='shiny'&&row.blockedVariants?.shiny?.state==='owner-attention-required'&&row.blockedVariants.shiny.reason?.length>100&&row.blockedVariants.shiny.sources?.length>=3&&row.blockedVariants.shiny.nextAction)continue;
   if(!proof||proof.http!==200||proof.decoded?.status!=='decoded'||!proof.decoded.visiblePixels||!/^[0-9a-f]{64}$/.test(proof.sha256)||file!=='assets/sprites/go/catalogue-'+proof.sha256.slice(0,20)+'.png')throw Error('Missing exact reviewed '+key+' artwork: '+row.names[0]);
   const parsed=new URL(proof.url),earlyModels={'Ash-Greninja':[658,10117],'Ultra Necrozma':[800,10157],'Eiscue (Noice Face)':[875,10185]},earlyCodes={'Darmanitan (Zen Mode)':'fZEN','Darmanitan (Galarian Zen Mode)':'fGALARIAN_ZEN'},early=row.sourceId?.startsWith('variant-followup:early-want-five:')&&row.normalRelease==='unverified'&&row.shinyRelease==='unverified'&&JSON.stringify(row.genders)==='[]'&&(earlyModels[row.names[0]]?.[0]===row.no&&proof.url==='https://raw.githubusercontent.com/PokeAPI/sprites/d8c2fb78563e28ad7b3abe938cf6e79998d04e90/sprites/pokemon/other/home/'+(key==='shiny'?'shiny/':'')+earlyModels[row.names[0]][1]+'.png'||row.no===555&&earlyCodes[row.names[0]]&&proof.url==='https://raw.githubusercontent.com/The-Pokemod-Group/pogo_assets/80a2323099f9c00207a8c9ee20d9386831f6b0ca/Images/Pokemon/Addressable%20Assets/pm555.'+earlyCodes[row.names[0]]+(key==='shiny'?'.s':'')+'.icon.png'),minerCodes={2:'cSPRING_2020_NOEVOLVE',3:'cSPRING_2020_NOEVOLVE',5:'cSPRING_2020_NOEVOLVE',6:'cSPRING_2020_NOEVOLVE',8:'cSPRING_2020_NOEVOLVE',9:'cSPRING_2020_NOEVOLVE',1012:'fARTISAN',1013:'fMASTERPIECE'},minerNames={2:'Ivysaur (Pikachu Visor)',3:'Venusaur (Pikachu Visor)',5:'Charmeleon (Pikachu Visor)',6:'Charizard (Pikachu Visor)',8:'Wartortle (Pikachu Visor)',9:'Blastoise (Pikachu Visor)',1012:'Poltchageist (Artisan Form)',1013:'Sinistcha (Masterpiece Form)'},mined=row.sourceId?.startsWith('variant-followup:upstream165:')&&row.names[0]===minerNames[row.no]&&proof.url==='https://raw.githubusercontent.com/The-Pokemod-Group/pogo_assets/80a2323099f9c00207a8c9ee20d9386831f6b0ca/Images/Pokemon/Addressable%20Assets/pm'+row.no+'.'+minerCodes[row.no]+(key==='shiny'?'.s':'')+'.icon.png',spooky=row.sourceId?.startsWith('variant-followup:spooky-size:')&&[710,711].includes(row.no)&&/^(Pumpkaboo|Gourgeist) \(Spooky Festival, (Small|Average|Large|Super) Size\)$/.test(row.names[0])&&parsed.origin==='https://img.pokemondb.net'&&new RegExp('^/sprites/go/normal/1x/'+(row.no===710?'pumpkaboo':'gourgeist')+'-'+row.names[0].match(/, (Small|Average|Large|Super) Size/)[1].toLowerCase()+'-spooky-festival\\.png$').test(parsed.pathname),approved=early||mined||spooky||parsed.origin==='https://www.serebii.net'&&/^\/pokemongo\/pokemon\/(?:shiny\/)?[0-9a-z-]+\.png$/.test(parsed.pathname)||parsed.origin==='https://assets.dittobase.com'&&/^\/go\/pokemon-unpadded\/[0-9a-z-]+\.png$/.test(parsed.pathname)||parsed.origin==='https://raw.githubusercontent.com'&&/^\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/home\/(?:shiny\/)?\d+\.png$/.test(parsed.pathname);
   if(!approved||parsed.search||parsed.hash||((key==='shiny')!==(/\/shiny\/|-shiny\.png$|\.s\.icon\.png$/.test(parsed.pathname))))throw Error('Wrong reviewed variant/source: '+row.names[0]);
   const bytes=fs.readFileSync(path.join(root,file));if(bytes.length!==proof.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==proof.sha256)throw Error('Reviewed catalogue digest mismatch: '+file);
  }
  const sameAppearance=validateSameAppearanceException(row,root);
  if(row.artProof.shiny&&(row.artProof.default.sha256===row.artProof.shiny.sha256||row.artProof.default.decoded.pixelHash===row.artProof.shiny.decoded.pixelHash)&&!sameAppearance)throw Error('Unqualified identical normal/Shiny art: '+row.names[0]);
 }
 return data.records;
}
module.exports={validateReviewedAssets,validateSameAppearanceException};
