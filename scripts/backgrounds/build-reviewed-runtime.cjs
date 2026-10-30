'use strict';
// Compile explicit reviewed decisions only. This never promotes a source claim,
// repairs artwork, fetches a URL, or enables the rollout.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {intrinsicCatalogId}=require('../../js/domain/backgroundPersistence.js');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function compile(review){
 if(!Array.isArray(review?.qualified_requests)||!review.qualified_requests.length||!Array.isArray(review.source_pair_dispositions)||!review.source_pair_dispositions.length)throw Error('reviewed-inventory-required');
 const backgrounds=new Map(review.backgrounds.map(b=>[b.canonical_id,b]));
 const assets=new Map(),records=[],seen=new Set();
 for(const row of review.qualified_requests){
  const catalogId=intrinsicCatalogId(row.catalog_id,row.intrinsic_form_constraints);
  const bg=backgrounds.get(row.background_id),key=JSON.stringify([row.background_id,catalogId,row.shiny]);
  if(!bg||seen.has(key)||typeof row.shiny!=='boolean'||!row.catalog_id?.startsWith('pokemon:')||!row.eligibility_basis||!row.art_path||!/^[a-f0-9]{64}$/.test(row.art_sha256))throw Error('invalid-reviewed-request');
  seen.add(key);const bytes=fs.readFileSync(row.art_path);if(hash(bytes)!==row.art_sha256)throw Error('reviewed-art-hash-mismatch');
  if(row.art_source_blob&&crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')!==row.art_source_blob)throw Error('reviewed-art-blob-mismatch');
  const ext=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':bytes[0]===255&&bytes[1]===216?'jpg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'webp':null;if(!ext)throw Error('unsupported-reviewed-image: '+row.art_path);
  const url='assets/backgrounds/'+row.art_sha256+'.'+ext;
  assets.set(url,{url,sha256:row.art_sha256,bytes:bytes.length,sourceUrl:row.art_source||'',sourceBlob:row.art_source_blob||'',sourcePath:row.art_path,content:bytes});
  records.push({id:row.background_id,label:bg.reviewed_title||bg.title,category:row.catalog_id.includes(':dynamax:')?'dynamax':row.catalog_id.includes(':gmax:')?'gmax':'wishlist',catalogId,shiny:row.shiny,url,sha256:row.art_sha256,evidenceTier:row.evidence_tier||'previous-reviewed-specific-event'});
 }
 records.sort((a,b)=>a.catalogId.localeCompare(b.catalogId)||Number(a.shiny)-Number(b.shiny)||a.id.localeCompare(b.id));
 const holds=review.source_pair_dispositions.filter(r=>r.normal.status!=='qualified_local'||r.shiny.status!=='qualified_local').map(r=>({backgroundId:r.background_id,sourceVariant:r.source_variant_id,catalogId:r.catalog_id,normal:r.normal.status,shiny:r.shiny.status}));
 const status={schemaVersion:1,sourceCaptureAsOf:review.source_capture_as_of||review.as_of,reviewedAsOf:review.reviewed_as_of||review.as_of,coverageComplete:false,sourcePairCount:review.source_pair_dispositions.length,eventObservationCount:review.raw_event_observations.length,indexObservationCount:review.index_link_dispositions.length,holds,sourceOnly:review.source_only18_dispositions.map(r=>({id:r.id,disposition:r.disposition,remaining:r.remaining})),withdrawnShiny:review.new_evidence_withheld_requests.map(r=>r.qualified_request_key)};
 const catalog={schemaVersion:1,coverageComplete:false,...(review.approved_release_scope==='verified-subset'?{releaseScope:'verified-subset'}:{}),sourceCaptureAsOf:status.sourceCaptureAsOf,reviewedAsOf:status.reviewedAsOf,records};
 return{catalog,status,assets:[...assets.values()].sort((a,b)=>a.url.localeCompare(b.url))};
}
function emit(review,inputBytes,root,{check=false}={}){
 const result=compile(review),manifest={schemaVersion:1,reviewSha256:hash(inputBytes),coverageComplete:false,recordCount:result.catalog.records.length,assetCount:result.assets.length,assets:result.assets.map(({sourcePath,content,...r})=>r)};
 const outputs=[['data/background-runtime-catalog.json',JSON.stringify(result.catalog)+'\n'],['data/background-review-holds.json',JSON.stringify(result.status)+'\n'],['data/background-art-manifest.json',JSON.stringify(manifest,null,2)+'\n'],...result.assets.map(a=>[a.url,a.content])];
 for(const[relative,bytes]of outputs){const p=path.join(root,relative),b=Buffer.from(bytes);if(check){if(!fs.existsSync(p)||!fs.readFileSync(p).equals(b))throw Error('generated-output-differs: '+relative);}else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);}}
 return manifest;
}
if(require.main===module){try{const args=process.argv.slice(2),input=args.find(a=>a!=='--check');if(!input)throw Error('usage: build-reviewed-runtime.cjs REVIEWED_INVENTORY [--check]');const bytes=fs.readFileSync(input),m=emit(JSON.parse(bytes),bytes,path.resolve(__dirname,'../..'),{check:args.includes('--check')});console.log(JSON.stringify({coverageComplete:false,records:m.recordCount,assets:m.assetCount,reviewSha256:m.reviewSha256}));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={compile,emit};
