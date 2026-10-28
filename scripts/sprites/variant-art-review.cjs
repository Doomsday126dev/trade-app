'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const PROOF_SHA='a5fb87a7c13f5d655e4cbffe48d999720accf2afb9b4fff831ad3bdbd00a456a';
function proofRegister(root=path.resolve(__dirname,'../..')){const bytes=fs.readFileSync(path.join(root,'data/reviewed-variant-art-assets.json'));if(crypto.createHash('sha256').update(bytes).digest('hex')!==PROOF_SHA)throw Error('Exact variant review register changed');const proof=JSON.parse(bytes);if(proof.schemaVersion!==1||!Array.isArray(proof.records))throw Error('Invalid exact variant review');return proof.records;}
function retainedEntry(entry,review){
 const value=JSON.parse(JSON.stringify(entry));delete value.variantArtworkReview;
 for(const key of Object.keys(review.variants)){if(!Object.hasOwn(review.originalRecord.assets,key))delete value.assets[key];if(!Object.hasOwn(review.originalRecord.sha256,key))delete value.sha256[key];}
 if(Object.hasOwn(review.originalRecord,'shinyAvailability'))value.shinyAvailability=review.originalRecord.shinyAvailability;else delete value.shinyAvailability;
 for(const key of Object.keys(review.updatedReleaseReview||{}))value.releaseReview[key]=review.originalRecord.releaseReview[key];
 return value;
}
function validateVariantArtworkReview(entry,root,records=proofRegister(root)){
 const review=records.find(r=>r.name===entry.names[0]);
 const fail=reason=>{throw Error('Exact variant artwork review mismatch: '+entry.names[0]+': '+reason)};
 if(!review){if(entry.variantArtworkReview)fail('unregistered identity');return;}
 if(entry.variantArtworkReview!==review.name||entry.no!==review.no||!isDeepStrictEqual(retainedEntry(entry,review),review.originalRecord))fail('normal artwork, aliases or prior evidence changed');
 if(entry.shinyAvailability!==undefined)fail('mined exact art must not be relabelled as released or blocked from early wants');
 if(!['released','unverified','announced'].includes(review.normal)||!['released','unverified','announced'].includes(review.shiny)||!review.releaseEvidence.length)fail('release evidence missing');
 for(const [key,value]of Object.entries(review.updatedReleaseReview||{}))if(entry.releaseReview?.[key]!==value)fail('stale release metadata');
 for(const [key,p]of Object.entries(review.variants)){
  if(!['shiny','femaleShiny'].includes(key)||entry.assets[key]!==p.asset||entry.sha256[key]!==p.sha256||p.asset!=='assets/sprites/go/variant-'+p.sha256.slice(0,20)+'.png'||p.http!==200||p.decoded?.status!=='decoded'||!p.decoded.visiblePixels||p.decoded.pixelHash===review.normalComparison.decoded.pixelHash)fail('unqualified exact variant');
  const minerPrefix='https://raw.githubusercontent.com/The-Pokemod-Group/pogo_assets/80a2323099f9c00207a8c9ee20d9386831f6b0ca/Images/Pokemon/';
  if(p.url.startsWith(minerPrefix)){
   if(!p.sourcePath?.startsWith('Addressable Assets/pm'+entry.no+'.')||!p.sourcePath.endsWith('.s.icon.png')||p.url!==minerPrefix+p.sourcePath.split('/').map(encodeURIComponent).join('/')||!/^[0-9a-f]{40}$/.test(p.gitBlobSha))fail('wrong mined form/source');
  }else if(entry.names[0]!=='Minior (Green Core)'||p.url!=='https://assets.dittobase.com/go/pokemon-unpadded/774-minior-green-shiny.png')fail('unreviewed art source');
  if(root){const bytes=fs.readFileSync(path.join(root,p.asset));if(bytes.length!==p.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==p.sha256||p.gitBlobSha&&crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')!==p.gitBlobSha)fail('original image bytes changed');}
 }
}
module.exports={PROOF_SHA,proofRegister,retainedEntry,validateVariantArtworkReview};
