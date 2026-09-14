'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
function fixture(){
 const window={crypto:webcrypto};vm.runInNewContext(fs.readFileSync('js/data/favoriteRecoveryPreview.js','utf8'),{window,TextEncoder,Uint8Array});
 const candidates=['New','Removed','Existing','Resolved','BadTag'].map((name,i)=>({candidateId:'candidate'+i,ownerUid:'owner',entityType:'favorite',values:{displayName:name,tagIds:{tag_old:true}},resolved:name==='Resolved'}));
 candidates[4].values.tagIds={tag_missing:true};
 const entities=[{entityType:'tag',entityId:'tag_old',values:{label:'Nearby'},deleted:false},{entityType:'favorite',entityId:'uid-Removed',deleted:true,generation:2},{entityType:'favorite',entityId:'uid-Existing',values:{tagIds:{tag_current:true}},deleted:false}];
 const journal={listRecoveryCandidates:async()=>candidates,listEntities:async()=>entities,listOperations:async()=>[],listConflicts:async()=>[]};
 const resolver={resolve:async handles=>handles.map(handle=>({handle,status:'resolved',targetUid:'uid-'+handle,canonicalHandle:handle}))};
 let current=true;return {candidates,entities,journal,resolver,close(){current=false;},make(){return window.PogoData.favoriteRecoveryPreview.createFavoriteRecoveryPreview({ownerUid:'owner',journal,resolver,sessionCurrent:()=>current});}};
}
test('preview preserves deletions, completed reviews and current organization; proposes exact original tag links only with complete evidence',async()=>{
 const f=fixture(),before=JSON.stringify({candidates:f.candidates,entities:f.entities});
 const result=await f.make().preview(f.candidates.map(x=>x.candidateId));
 assert.deepEqual(Array.from(result.rows,x=>x.status),['eligible-for-account-specific-approval','deliberate-deletion-review','preserve-current-organization','review-already-completed','tag-evidence-review']);
 assert.equal(result.rows[0].proposedValues.tagIds.tag_old,true);assert.equal(result.rows[1].proposedValues,null);assert.equal(result.rows[2].canonical.values.tagIds.tag_current,true);
 assert.match(result.evidenceSha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify({candidates:f.candidates,entities:f.entities}),before);
});
test('changed evidence and account switches invalidate a preview without writes',async()=>{
 const f=fixture();f.resolver.resolve=async handles=>{f.entities.push({entityType:'favorite',entityId:'uid-New',deleted:true});return handles.map(handle=>({handle,status:'resolved',targetUid:'uid-'+handle,canonicalHandle:handle}));};
 await assert.rejects(f.make().preview(['candidate0']),{code:'favorite/recovery-evidence-changed'});
 const g=fixture();g.resolver.resolve=async()=>{g.close();return [];};await assert.rejects(g.make().preview(['candidate0']),{code:'favorite/session-changed'});
});
