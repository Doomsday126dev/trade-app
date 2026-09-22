(function(global){
  'use strict';
  const root=global.PogoData=global.PogoData||{};
  // Read-only review evidence. This module deliberately has no reconciliation,
  // candidate-resolution or entity-write dependency.
  function createFavoriteRecoveryPreview({ownerUid,journal,resolver,sessionCurrent,crypto=global.crypto}={}){
    if(!ownerUid||!journal?.listRecoveryCandidates||!resolver?.resolve||typeof sessionCurrent!=='function')throw new TypeError('Recovery preview dependencies are required');
    const current=()=>{if(!sessionCurrent())throw Object.assign(new Error('Account changed'),{code:'favorite/session-changed'});};
    async function evidence(){
      current();const [candidates,entities,operations,conflicts]=await Promise.all([
        journal.listRecoveryCandidates({unresolvedOnly:false}),journal.listEntities(),
        journal.listOperations({statuses:['pending','sending','blocked','conflict','acknowledged']}),journal.listConflicts()
      ]);current();
      return {candidates:candidates.filter(row=>row.entityType==='favorite'),entities:entities.filter(row=>['favorite','tag'].includes(row.entityType)),operations:operations.filter(row=>row.operation?.entityType==='favorite'),conflicts:conflicts.filter(row=>row.entityType==='favorite')};
    }
    return Object.freeze({async preview(candidateIds){
      current();if(!Array.isArray(candidateIds)||!candidateIds.length||candidateIds.length>100||new Set(candidateIds).size!==candidateIds.length)throw new TypeError('Choose one to 100 exact candidate IDs');
      const before=await evidence(),selected=candidateIds.map(id=>before.candidates.find(row=>row.candidateId===id&&row.ownerUid===ownerUid));
      if(selected.some(row=>!row))throw new Error('Exact candidate evidence is missing');
      const handles=[...new Set(selected.filter(row=>!row.resolved).map(row=>row.values?.displayName))];
      const identities=new Map();
      for(let i=0;i<handles.length;i+=50){for(const row of await resolver.resolve(handles.slice(i,i+50)))identities.set(row.handle,row);current();}
      const after=await evidence();
      if(JSON.stringify(before)!==JSON.stringify(after))throw Object.assign(new Error('Recovery evidence changed; create a fresh preview'),{code:'favorite/recovery-evidence-changed'});
      const rows=selected.map(candidate=>{
        const identity=identities.get(candidate.values?.displayName),uid=identity?.targetUid;
        const canonical=uid?before.entities.find(row=>row.entityType==='favorite'&&row.entityId===uid):null;
        const pending=before.operations.filter(row=>row.operation.entityId===uid&&row.status!=='acknowledged');
        const conflicts=before.conflicts.filter(row=>row.entityId===uid);
        const tagIds=Array.isArray(candidate.values?.tagIds)?candidate.values.tagIds:Object.keys(candidate.values?.tagIds||{});
        const tags=tagIds.map(id=>({id,canonical:before.entities.find(row=>row.entityType==='tag'&&row.entityId===id)||null}));
        const status=candidate.resolved?'review-already-completed':identity?.status!=='resolved'?'identity-unavailable':canonical?.deleted?'deliberate-deletion-review':pending.length||conflicts.length?'pending-or-conflicting-work':canonical?'preserve-current-organization':tags.some(tag=>!tag.canonical||tag.canonical.deleted)?'tag-evidence-review':'eligible-for-account-specific-approval';
        return {candidateId:candidate.candidateId,status,candidate,identity:identity||null,canonical:canonical||null,tags,pending,conflicts,
          proposedValues:status==='eligible-for-account-specific-approval'?{targetUid:uid,displayName:identity.canonicalHandle,tagIds:Object.fromEntries(tagIds.map(id=>[id,true]))}:null};
      });
      const payload={version:1,ownerUid,readOnly:true,rows,evidence:before};
      const bytes=new TextEncoder().encode(JSON.stringify(payload));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');current();
      return Object.freeze({...payload,evidenceSha256:digest,requiresAccountSpecificApproval:true});
    }});
  }
  root.favoriteRecoveryPreview=Object.freeze({createFavoriteRecoveryPreview});
})(window);
