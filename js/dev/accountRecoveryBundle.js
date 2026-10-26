(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const FORMAT='pogo-private-account-recovery';
  const VERSION=1;
  const MAX_BYTES=8*1024*1024;
  // Every collector must explicitly attest completeness, including empty sections.
  const SECTIONS=Object.freeze(['canonicalEntities','profile','legacyLists','favorites','tags','groups','preferences','sharing','permissions','journal','migration','recovery']);
  // Authority-bearing references and sync journals are evidence, never replayable grants/writes.
  const CONTENT_SECTIONS=new Set(['canonicalEntities','profile','favorites','tags','preferences']);
  const RESERVED=new Set(['__proto__','prototype','constructor']);
  const CREDENTIAL=/^(?:pin|password|passwordHash|clientSecret|accessToken|refreshToken|customToken|idToken|privateKey|authorization|cookie)$/i;
  const HASH=/^[a-f0-9]{64}$/;
  function fail(code){throw Object.assign(new Error(code),{code});}
  function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
  function exact(value,fields){return object(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');}
  function text(value,max=512){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);}
  function normalize(value,depth=0){
    if(depth>48)fail('recovery/depth-limit');
    if(value===null||typeof value==='boolean'||typeof value==='string')return value;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(Array.isArray(value))return value.map(item=>normalize(item,depth+1));
    if(!object(value))fail('recovery/json-invalid');
    const result=Object.create(null);
    for(const key of Object.keys(value).sort()){
      if(RESERVED.has(key)||CREDENTIAL.test(key))fail('recovery/credential-or-key-forbidden');
      result[key]=normalize(value[key],depth+1);
    }
    return result;
  }
  const canonical=value=>JSON.stringify(normalize(value));
  async function defaultHash(value){
    const bytes=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function createAccountRecoveryBundle({sha256=defaultHash}={}){
    function normalizedSnapshot(snapshot){
      if(!exact(snapshot,['source','sections'])||!exact(snapshot.source,['ownerUid','trainerHandle','capturedAt','revision'])||
        !text(snapshot.source.ownerUid,128)||!text(snapshot.source.trainerHandle,64)||!text(snapshot.source.revision,256)||
        !Number.isSafeInteger(snapshot.source.capturedAt)||snapshot.source.capturedAt<0||!exact(snapshot.sections,SECTIONS))fail('recovery/snapshot-invalid');
      const sections=Object.create(null);
      for(const name of SECTIONS){
        const section=snapshot.sections[name];
        if(!exact(section,['complete','records'])||section.complete!==true||!Array.isArray(section.records)||section.records.length>20000)fail('recovery/coverage-incomplete');
        const ids=new Set(),records=[];
        for(const record of section.records){
          if(!exact(record,['id','value'])||!text(record.id)||RESERVED.has(record.id)||ids.has(record.id))fail('recovery/record-invalid');
          ids.add(record.id);records.push({id:record.id,value:normalize(record.value)});
        }
        records.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);sections[name]={complete:true,records};
      }
      return{source:{...snapshot.source},sections};
    }
    async function hash(value){const result=await sha256(canonical(value));if(!HASH.test(result))fail('recovery/hash-invalid');return result;}
    function bounded(value){if(new TextEncoder().encode(canonical(value)).length>MAX_BYTES)fail('recovery/size-limit');return value;}
    async function create(snapshot){
      const value=normalizedSnapshot(snapshot);
      const payload=bounded({format:FORMAT,schemaVersion:VERSION,...value});
      return{...payload,integrity:{algorithm:'SHA-256',digest:await hash(payload)}};
    }
    async function verify(input){
      if(typeof input==='string'){
        if(new TextEncoder().encode(input).length>MAX_BYTES)fail('recovery/size-limit');
        try{input=JSON.parse(input);}catch{fail('recovery/json-invalid');}
      }
      if(!exact(input,['format','schemaVersion','source','sections','integrity'])||input.format!==FORMAT||input.schemaVersion!==VERSION||
        !exact(input.integrity,['algorithm','digest'])||input.integrity.algorithm!=='SHA-256'||!HASH.test(input.integrity.digest))fail('recovery/version-or-envelope-invalid');
      const value=normalizedSnapshot({source:input.source,sections:input.sections});
      const payload=bounded({format:FORMAT,schemaVersion:VERSION,...value});
      if(await hash(payload)!==input.integrity.digest)fail('recovery/integrity-mismatch');
      // Hash proves file integrity only. It does not prove account control or permission to restore.
      return{...payload,integrity:{...input.integrity}};
    }
    async function planImport({bundle,currentSnapshot,targetOwnerUid}={}){
      const archive=await verify(bundle),target=normalizedSnapshot(currentSnapshot);
      if(!text(targetOwnerUid,128)||target.source.ownerUid!==targetOwnerUid)fail('recovery/target-owner-mismatch');
      const sameOwner=archive.source.ownerUid===targetOwnerUid,operations=[];
      for(const section of SECTIONS){
        const current=new Map(target.sections[section].records.map(record=>[record.id,record.value]));
        for(const record of archive.sections[section].records){
          const exists=current.has(record.id),equal=exists&&canonical(current.get(record.id))===canonical(record.value);
          const action=equal?'keep':!sameOwner||!CONTENT_SECTIONS.has(section)?'review-only':exists?'review-conflict':'propose-add';
          // Stable IDs plus exact target revision make repeated planning idempotent and stale plans unusable.
          const operationId=await hash({bundleDigest:archive.integrity.digest,targetOwnerUid,section,id:record.id});
          operations.push({operationId,section,id:record.id,action,expectedTargetDigest:await hash(exists?current.get(record.id):null)});
        }
      }
      return{schemaVersion:VERSION,bundleDigest:archive.integrity.digest,targetOwnerUid,expectedTargetRevision:target.source.revision,
        expectedTargetDigest:await hash(target),sameOwner,automaticApply:false,requiresAuthenticatedOwnerProof:true,
        requiresServerIdentityRecovery:!sameOwner,operations};
    }
    return Object.freeze({create,verify,planImport});
  }
  root.accountRecoveryBundle=Object.freeze({FORMAT,VERSION,MAX_BYTES,SECTIONS,createAccountRecoveryBundle});
})(window);
