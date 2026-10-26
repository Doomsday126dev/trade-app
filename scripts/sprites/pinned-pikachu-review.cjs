'use strict';
const fs=require('node:fs'),path=require('node:path');
const COMMIT='5c6bb56c4026e5fe3cd146910c7e9dad9f07d716';
function validatePinnedReview(entry,root){
  const review=entry.pinnedArtworkReview;
  if(!review){if(entry.sourceProvider==='pogorewind-reviewed')throw new Error('Pinned Pikachu artwork review missing: '+entry.names[0]);return;}
  const fail=()=>{throw new Error('Pinned Pikachu artwork review mismatch: '+entry.names[0]);};
  if(entry.no!==25||review.name!==entry.names[0]||review.sourceCommit!==COMMIT||!/^0025-00-00-\d{3}$/.test(review.sourceId)||review.shinyAvailability!=='released'||!review.releaseEvidence?.startsWith('https://')||!review.sourceGenders?.length||review.sourceGenders.some(g=>!['m','f'].includes(g)))fail();
  const singleFemale=review.sourceGenders.length===1&&review.sourceGenders[0]==='f';
  const keys=review.full?['default','female','shiny','femaleShiny']:['shiny',...(review.sourceGenders.includes('f')?['femaleShiny']:[])];
  if(JSON.stringify(Object.keys(review.assets).sort())!==JSON.stringify(keys.sort()))fail();
  for(const key of keys){
    const female=key.startsWith('female')&&!singleFemale,shiny=key.toLowerCase().includes('shiny');
    const file=review.sourceId+(female?'+F':'')+(shiny?'+S':'')+'.png';
    const url='https://raw.githubusercontent.com/Gabrielense/pogorewind/'+COMMIT+'/sprites/'+encodeURIComponent(file);
    if(review.sourceFiles[key]!==file||review.sourceUrls[key]!==url||review.assets[key]!==entry.assets[key]||review.sha256[key]!==entry.sha256[key]||!/^([a-f0-9]{40})$/.test(review.gitBlobShas[key]||''))fail();
    if(root){const bytes=fs.readFileSync(path.join(root,entry.assets[key]));const blob=require('node:crypto').createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');if(blob!==review.gitBlobShas[key])fail();}
  }
  if(root){const proof=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-pikachu-shiny-assets.json'))).records.find(r=>r.name===review.name);if(JSON.stringify(proof)!==JSON.stringify(review))fail();}
  if(entry.sourceProvider==='pogorewind-reviewed'){
    if(!review.full||entry.sourceCommit!==COMMIT||entry.sourcePage!==review.sourcePage||entry.sourceUrl!==review.sourceUrls.default||JSON.stringify(entry.sourceFiles)!==JSON.stringify(review.sourceFiles)||JSON.stringify(entry.gitBlobShas)!==JSON.stringify(review.gitBlobShas))fail();
  }
}
module.exports={validatePinnedReview,COMMIT};
