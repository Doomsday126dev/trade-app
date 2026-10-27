'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
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
   const parsed=new URL(proof.url),spooky=row.sourceId?.startsWith('variant-followup:spooky-size:')&&[710,711].includes(row.no)&&/^(Pumpkaboo|Gourgeist) \(Spooky Festival, (Small|Average|Large|Super) Size\)$/.test(row.names[0])&&parsed.origin==='https://img.pokemondb.net'&&new RegExp('^/sprites/go/normal/1x/'+(row.no===710?'pumpkaboo':'gourgeist')+'-'+row.names[0].match(/, (Small|Average|Large|Super) Size/)[1].toLowerCase()+'-spooky-festival\\.png$').test(parsed.pathname),approved=spooky||parsed.origin==='https://www.serebii.net'&&/^\/pokemongo\/pokemon\/(?:shiny\/)?[0-9a-z-]+\.png$/.test(parsed.pathname)||parsed.origin==='https://assets.dittobase.com'&&/^\/go\/pokemon-unpadded\/[0-9a-z-]+\.png$/.test(parsed.pathname)||parsed.origin==='https://raw.githubusercontent.com'&&/^\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/home\/(?:shiny\/)?\d+\.png$/.test(parsed.pathname);
   if(!approved||parsed.search||parsed.hash||((key==='shiny')!==(/\/shiny\/|-shiny\.png$/.test(parsed.pathname))))throw Error('Wrong reviewed variant/source: '+row.names[0]);
   const bytes=fs.readFileSync(path.join(root,file));if(bytes.length!==proof.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==proof.sha256)throw Error('Reviewed catalogue digest mismatch: '+file);
  }
  if(row.artProof.shiny&&row.artProof.default.decoded.pixelHash===row.artProof.shiny.decoded.pixelHash)throw Error('Unqualified identical normal/Shiny art: '+row.names[0]);
 }
 return data.records;
}
module.exports={validateReviewedAssets};
