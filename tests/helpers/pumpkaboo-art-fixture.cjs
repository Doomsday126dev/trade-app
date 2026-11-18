'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const ids=Object.freeze({'Pumpkaboo Average Size':710,'Pumpkaboo Small Size':10027,'Pumpkaboo Large Size':10028,'Pumpkaboo Super Size':10029});
function preferredArt(row,shiny){const id=ids[row.name];return id?'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'+(shiny?'shiny/':'')+id+'.png':null;}
async function installPumpkabooArt(page){
 const evidence=require('../../data/catalogue-art-checks.json').records;
 const dir=path.join(os.tmpdir(),'apri-pumpkaboo-original-art');fs.mkdirSync(dir,{recursive:true});
 for(const name of Object.keys(ids))for(const shiny of [false,true]){
  const url=preferredArt({name},shiny),proof=evidence.find(r=>r.url===url);
  if(!proof?.sha256)throw Error('Missing reviewed exact-source proof: '+url);
  const file=path.join(dir,(shiny?'shiny-':'')+ids[name]+'.png');
  const hash=(target=file)=>crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if(!fs.existsSync(file)||hash()!==proof.sha256){const temporary=file+'.'+process.pid+'.tmp';try{execFileSync('curl',['--fail','--silent','--show-error','--max-time','20',url,'-o',temporary]);if(hash(temporary)!==proof.sha256)throw Error('Original sprite differs from reviewed SHA256: '+url);fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
  if(hash()!==proof.sha256)throw Error('Original sprite differs from reviewed SHA256: '+url);
  await page.route(url,route=>route.fulfill({path:file,contentType:'image/png'}));
 }
}
module.exports={ids,preferredArt,installPumpkabooArt};
