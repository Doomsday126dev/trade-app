// Owner-data adapter prelude: exact cacheAdapters.js source; checked by build-background-runtime.cjs.
(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function cloneContainer(value){
    return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};
  }
  function applyExactRecord(cache,path,value){
    const parts=String(path||'').split('/').filter(Boolean);
    if(!parts.length)return cache;
    const next=cloneContainer(cache);
    let source=cache&&typeof cache==='object'?cache:{};
    let target=next;
    parts.forEach((part,index)=>{
      if(index===parts.length-1){
        if(value==null)delete target[part];
        else target[part]=value;
        return;
      }
      source=source?.[part];
      target[part]=cloneContainer(source);
      target=target[part];
    });
    return next;
  }
  function replaceTopLevel(cache,path,value){
    const key=String(path||'').split('/').filter(Boolean)[0];
    if(!key)return cache;
    return{...cloneContainer(cache),[key]:value&&typeof value==='object'?value:{}};
  }

  root.cacheAdapters=Object.freeze({applyExactRecord,replaceTopLevel});
})(typeof window!=='undefined'?window:globalThis);

// END OWNER-DATA ADAPTER PRELUDE
// Inert APIs: rollout is controlled by application.js; no network on load.
(function(){
'use strict';
// Owner-authenticated local protocol. Transport uses the owner's existing token.
function createProtocol({db,token,isEligible,bounded=false}){
 if(typeof isEligible!=="function")throw Error("eligibility-required");
 if(!/^bgs_[a-z0-9]{32}$/.test(token))throw Error('invalid-token');
 const path='backgroundStores/'+token;
 function validate(entries){if(!Array.isArray(entries)||entries.length>1000)throw Error('invalid-records');const fields=['catalogId','backgroundId','priority','note','gender','variant','shiny','lucky','xxl','xxs','quantity'].sort().join(','),seen=new Set();for(const r of entries){if(!r||Object.keys(r).filter(k=>!['mirror','sortOrder','plainIdentity'].includes(k)).sort().join(',')!==fields||r.mirror!==undefined&&typeof r.mirror!=='boolean'||r.sortOrder!==undefined&&(!Number.isSafeInteger(r.sortOrder)||r.sortOrder<0)||r.plainIdentity!==undefined&&(!r.plainIdentity||!['my-list','special-board'].includes(r.plainIdentity.surface)||!['wishlist','dynamax','gmax','costumes','looking-for','for-trade'].includes(r.plainIdentity.lane)||r.plainIdentity.catalogId!==r.catalogId||Object.keys(r.plainIdentity).sort().join(',')!=='catalogId,lane,surface')||typeof r.catalogId!=='string'||r.catalogId.length>256||typeof r.backgroundId!=='string'||r.backgroundId.length>160||!['','H','M','L'].includes(r.priority)||typeof r.note!=='string'||r.note.length>500||!['','m','f'].includes(r.gender)||typeof r.variant!=='string'||r.variant.length>160||['shiny','lucky','xxl','xxs'].some(f=>typeof r[f]!=='boolean')||!Number.isSafeInteger(r.quantity)||r.quantity<1||r.quantity>999||!isEligible(r))throw Error('invalid-record');const key=JSON.stringify([r.catalogId,r.backgroundId,r.shiny,r.gender,r.variant,r.lucky,r.xxl,r.xxs]);if(seen.has(key))throw Error('duplicate');seen.add(key);}return entries;}

 return Object.freeze({
 operationIds:bounded,
 validate:entries=>validate(entries),
 async save(expectedRevision,entries,opId='',resuming=false){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('invalid-draft');validate(entries);
  const revision=expectedRevision+1,changes={head:revision,['snapshots/r'+revision]:{entriesJson:JSON.stringify(entries),...(bounded&&opId?{opId}:{})}};
  if(resuming)changes.mode='active';
  if(bounded){
   const slots=await db('GET',path+'/snapshotSlots');if(slots.status!==200)return{ok:false,code:'read-unavailable'};
   const map=slots.value||{};if(expectedRevision>0&&!Object.keys(map).length)return{ok:false,code:'retention-review-required'};if(Object.keys(map).some(k=>!['a','b','c'].includes(k)))return{ok:false,code:'retention-review-required'};
   let slot=['a','b','c'].find(k=>!map[k]);
   if(!slot){for(const key of ['a','b','c'].sort((a,b)=>Number(map[a].slice(1))-Number(map[b].slice(1)))){
    let release;try{release=await db('DELETE',path+'/published/'+map[key]);}catch(error){if(error.code==='PERMISSION_DENIED'||error.code==='permission-denied')continue;throw error;}
    if(release.status===200){slot=key;break;}
   }if(!slot)return{ok:false,code:'background-capacity'};changes['snapshots/'+map[slot]]=null;}
   changes['snapshotSlots/'+slot]='r'+revision;

  }
  const result=await db('PATCH',path,changes);if(result.status!==200)return{ok:false,code:'conflict-or-denied',draft:structuredClone(entries)};return{ok:true,revision:'r'+revision};
 },
 async resume(expectedRevision,entries){validate(entries);if(bounded){const r=await this.save(expectedRevision,entries,'',true);return{...r,status:r.ok?200:409};}const revision=expectedRevision+1;return db('PATCH',path,{mode:'active',head:revision,['snapshots/r'+revision]:{entriesJson:JSON.stringify(entries)}});},
 async receipt(revision){const r=await db('GET',path+'/snapshots/'+revision);return r.status===200?r.value:null;},
 async publish(revision){return db('PUT',path+'/published/'+revision,true);},
 async read(revision){const r=await db('GET',path+'/snapshots/'+revision);if(r.status!==200)throw Error('snapshot-unavailable');const entries=JSON.parse(r.value.entriesJson);return validate(entries);}
 });
}
// Repeat complete authoritative-source collection until both sources are stable.
// This is a consistent publication snapshot, not a promise it stays current forever.
async function stableSources(read,maxAttempts=3){for(let i=0;i<maxAttempts;i++){const a=await read('account'),b=await read('background'),a2=await read('account'),b2=await read('background');if([a,b,a2,b2].some(s=>!s||!['string','number'].includes(typeof s.version)||s.version===''))throw Error('source-unavailable');if(a.version===a2.version&&b.version===b2.version)return{account:a2.value,background:b2.value};}throw Error('sources-changing');}
if(typeof module!=='undefined'&&module.exports)module.exports={createProtocol,stableSources};else globalThis.BackgroundProtocol={createProtocol,stableSources};

})();

(function(){
'use strict';
// Local integration module; not loaded by the production app.
function createRepository({uid,token,protocol,readHead,storage,currentSession}){
 const session=currentSession(),key='background-journal-v1:'+uid+':'+token;
 const current=()=>{const s=currentSession();return s.uid===uid&&s.generation===session.generation;};
 const check=()=>{if(!current())throw Error('session-changed');};
 let state=JSON.parse(storage.getItem(key)||'{"head":0,"entries":[],"pending":null}');
 let mutationVersion=0,hydrationGeneration=0;
 const persist=()=>{mutationVersion++;storage.setItem(key,JSON.stringify(state));};
 const copy=v=>structuredClone(v);
 async function flush(){check();if(!state.pending)return {ok:true};const op=copy(state.pending);
  // Save intent is durable before dispatch. Failed/uncertain outcomes retain it.
  const remote=await readHead();check();
  if(remote===op.base+1){const rows=await protocol.read('r'+remote);const receipt=protocol.receipt?await protocol.receipt('r'+remote):null;check();if((!op.opId||receipt?.opId===op.opId)&&JSON.stringify(rows)===JSON.stringify(op.entries)){state={head:remote,entries:rows,pending:null};persist();return{ok:true,recovered:true};}}
  if(remote!==op.base)return{ok:false,code:'conflict',pending:true};
  let result;try{result=await protocol.save(op.base,op.entries,op.opId);}catch(error){return{ok:false,code:'transport-unknown',pending:true};}check();
  if(!result.ok)return{ok:false,code:result.code,pending:true};state={head:op.base+1,entries:op.entries,pending:null};persist();return{ok:true};
 }
 return Object.freeze({
  snapshot:()=>copy(state),
  async hydrate(){check();if(state.pending)return{ok:false,code:'pending-intent'};const version=mutationVersion,generation=++hydrationGeneration;const head=await readHead();check();const rows=head?await protocol.read('r'+head):[];check();if(state.pending)return{ok:false,code:'pending-intent'};if(version!==mutationVersion||generation!==hydrationGeneration||head<state.head)return{ok:false,code:'stale-hydration'};state={head,entries:rows,pending:null};persist();return{ok:true};},
  async replace(entries,{operationId}={}){check();if(operationId!==undefined&&!/^[a-zA-Z0-9_-]{1,80}$/.test(operationId))throw Error('invalid-operation-id');if(state.pending)throw Error('pending-intent');protocol.validate(entries);state.pending={base:state.head,entries:copy(entries),...(protocol.operationIds?{opId:operationId||globalThis.crypto.randomUUID()}:{})};persist();return flush();},flush,
  exportData({includePending=false}={}){check();return JSON.stringify({schemaVersion:1,backgroundRequests:includePending&&state.pending?state.pending.entries:state.entries});},
  async keepRemote(){check();const version=mutationVersion;const head=await readHead();check();const entries=head?await protocol.read('r'+head):[];check();if(version!==mutationVersion||head<state.head)return{ok:false,code:'state-changed'};state={head,entries,pending:null};persist();return{ok:true};},
  async importData(text){check();const value=JSON.parse(text);if(value.schemaVersion!==1||Object.keys(value).sort().join(',')!=='backgroundRequests,schemaVersion'||!Array.isArray(value.backgroundRequests))throw Error('invalid-import');return this.replace([...state.entries,...value.backgroundRequests]);},
  async shareReference(){check();if(state.pending)throw Error('pending-intent');const revision='r'+state.head;const result=await protocol.publish(revision);check();if(result.status!==200)throw Error('publication-failed');return{backgroundRef:token,backgroundRevision:revision};}
 });
}
if(typeof module!=='undefined'&&module.exports)module.exports={createRepository};else globalThis.BackgroundRepository={createRepository};

})();

(function(){'use strict';
// Validates locally compiled decisions without fetching, enabling, or promoting
// held source observations. The global completeness gate stays independent.
// Explicit IDs are used only for newly chosen background requests. Generic saved
// IDs are never normalized to these forms and user gender preferences stay separate.
const INTRINSIC_FORMS=Object.freeze([
 {catalogId:'pokemon:670:standard:background:red-flower',baseCatalogId:'pokemon:670:standard:legacy:Floette',name:'Floette (Red Flower)',constraints:{flower_color:'red'},artGender:''},
 {catalogId:'pokemon:671:standard:background:red-flower',baseCatalogId:'pokemon:671:standard:legacy:Florges',name:'Florges (Red Flower)',constraints:{flower_color:'red'},artGender:''},
 {catalogId:'pokemon:916:standard:background:female',baseCatalogId:'pokemon:916:standard:legacy:Oinkologne',name:'Oinkologne (Female Form)',constraints:{sex:'female'},artGender:'f'}
].map(r=>Object.freeze({...r,constraints:Object.freeze(r.constraints)})));
function intrinsicBinding(catalogId){return INTRINSIC_FORMS.find(r=>r.catalogId===catalogId)||null;}
function intrinsicBindingForName(name){return INTRINSIC_FORMS.find(r=>r.name===name)||null;}
function intrinsicCatalogId(baseCatalogId,constraints){
 if(constraints&&(typeof constraints!=='object'||Array.isArray(constraints)))throw Error('unsupported-intrinsic-form');
 if(!constraints||!Object.keys(constraints).length)return baseCatalogId;
 const key=v=>JSON.stringify(Object.entries(v).sort());
 const match=INTRINSIC_FORMS.find(r=>r.baseCatalogId===baseCatalogId&&key(r.constraints)===key(constraints));
 if(!match)throw Error('unsupported-intrinsic-form');return match.catalogId;
}
function readCatalogue(value,{resolveEntry}={}){
 if(value?.schemaVersion!==1||typeof value.coverageComplete!=='boolean'||(value.releaseScope!=null&&value.releaseScope!=='verified-subset')||!Array.isArray(value.records)||!value.records.length||typeof resolveEntry!=='function')throw Error('background-catalogue-invalid');
 const seen=new Set(),records=[];
 for(const r of value.records){
  const source=resolveEntry(r.catalogId),key=JSON.stringify([r.id,r.catalogId,r.shiny,r.gender||'']);
  if(!source||!/^[-a-z0-9:]{1,160}$/.test(r.id||'')||typeof r.label!=='string'||!r.label.trim()||r.label.length>180||typeof r.shiny!=='boolean'||!['wishlist','dynamax','gmax'].includes(r.category)||!/^assets\/backgrounds\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(r.url||'')||!/^[a-f0-9]{64}$/.test(r.sha256||'')||!r.url.includes('/'+r.sha256+'.')||seen.has(key))throw Error('background-catalogue-record-invalid');
  const lane=r.catalogId.includes(':dynamax:')?'dynamax':r.catalogId.includes(':gmax:')?'gmax':'wishlist';
  if(lane!==r.category||r.gender&&!['m','f'].includes(r.gender))throw Error('background-catalogue-identity-invalid');
  seen.add(key);records.push(Object.freeze({...r}));
 }
 return Object.freeze({coverageComplete:value.coverageComplete,releaseScope:value.releaseScope||null,loaded:true,records:Object.freeze(records)});
}
function createEditorAdapter({repository,uid,catalogForId,currentUid}){
 const check=owner=>{if(owner!==uid||currentUid()!==uid)throw Error('session-changed');};
 const key=r=>JSON.stringify([r.catalogId,r.backgroundId,r.shiny,r.gender,r.variant,r.lucky,r.xxl,r.xxs]);
 const toRecord=v=>({...(v.mirror!==undefined?{mirror:v.mirror}:{}),...(v.sortOrder!==undefined?{sortOrder:v.sortOrder}:{}),...(v.plainIdentity?{plainIdentity:v.plainIdentity}:{}),catalogId:v.catalogId,backgroundId:v.backgroundId,priority:v.p||'',variant:v.mod||'',gender:v.gender||'',note:v.note||'',shiny:!!v.shiny,lucky:!!v.lucky,xxl:!!v.xxl,xxs:!!v.xxs,quantity:v.qty||1});
 const accept=result=>{if(!result.ok)throw Object.assign(Error(result.code),{code:result.code});};
 return Object.freeze({testOnly:true,
  async hydrate(){check(uid);accept(await repository.hydrate());},
  list(owner){check(owner);const s=repository.snapshot();return s.entries.map(r=>{const catalog=catalogForId(r.catalogId);if(!catalog)throw Error('unknown-catalog');return{...r,name:catalog.name,category:catalog.category||'wishlist',key:key(r),revision:s.head,p:r.priority,mod:r.variant,qty:r.quantity};});},
  async save(owner,value,{expectedKey,expectedRevision}){check(owner);const s=repository.snapshot(),r=toRecord(value),k=key(r);if(expectedKey){if(expectedRevision!==s.head)throw Error('stale-entry');const i=s.entries.findIndex(x=>key(x)===expectedKey);if(i<0)throw Error('missing-entry');const rows=s.entries.slice();rows[i]=r;accept(await repository.replace(rows));}else {if(s.entries.some(x=>key(x)===k))throw Error('duplicate');accept(await repository.replace([...s.entries,r]));}check(owner);},
  async remove(owner,id,revision){check(owner);const s=repository.snapshot();if(s.head!==revision||!s.entries.some(r=>key(r)===id))throw Error('stale-entry');accept(await repository.replace(s.entries.filter(r=>key(r)!==id)));check(owner);},
  exportData:()=>repository.exportData(),importData:text=>repository.importData(text),shareReference:()=>repository.shareReference()
 });
}
async function readV3({snapshot,readPublic,validateEntries}){
 const token=snapshot?.backgroundRef,revision=snapshot?.backgroundRevision;
 if(!/^bgs_[a-z0-9]{32}$/.test(token||'')||!/^r[1-9][0-9]*$/.test(revision||''))throw Error('invalid-background-reference');
 const value=await readPublic('backgroundStores/'+token+'/snapshots/'+revision);
 if(!value||typeof value.entriesJson!=='string'||value.entriesJson.length>200000)throw Error('background-unavailable');
 const rows=JSON.parse(value.entriesJson);validateEntries(rows);return structuredClone(rows);
}
const api={createEditorAdapter,readV3,readCatalogue,intrinsicBinding,intrinsicBindingForName,intrinsicCatalogId};if(typeof module!=='undefined'&&module.exports)module.exports=api;else globalThis.BackgroundEditorAdapter=api;
})();

(function(global){
'use strict';
const recordKey=r=>JSON.stringify([r.catalogId,r.backgroundId,r.shiny,r.gender,r.variant,r.lucky,r.xxl,r.xxs]);
const clone=structuredClone,normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
// Owner-local transition journal. Both sources stay intact until the target is
// durable; retirement is guarded by the exact source revision or pool CAS.
function createTransitions({uid,storage,currentSession,background,canonical}){
 const session=currentSession(),key='background-transition-v1:'+uid;
 const check=()=>{const now=currentSession();if(now.uid!==uid||now.generation!==session.generation)throw Error('session-changed');};
 const equal=(a,b)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
 let busy=false;
 const read=()=>{const raw=storage.getItem(key);return raw?JSON.parse(raw):null;};
 const save=value=>{check();storage.setItem(key,JSON.stringify(value));};
 const clear=()=>{check();storage.removeItem(key);};

 async function remoteBackground(){check();if(background.snapshot().pending){const done=await background.flush();check();if(!done.ok)throw Error('background-pending');}await background.hydrate();check();return background.snapshot();}
 async function canonicalReady(){await canonical.drain();check();const s=await canonical.snapshot();check();if(s.pendingCount||s.blockedCount||s.conflictCount||s.state!=='saved')throw Error('canonical-pending');}
 async function resume(){check();if(busy)throw Error('transition-busy');busy=true;
 try{let op=read();if(!op)return{ok:true};if(op.uid!==uid)throw Error('owner-mismatch');
  if(op.direction==='background'){
   let b=await remoteBackground(),target=b.entries.find(r=>recordKey(r)===recordKey(op.target));
   if(!target){const source=canonical.get(op.source.entityId);if(!equal(source,op.source))throw Error('source-changed');if(op.phase!=='prepared')throw Error('target-changed');if(b.head!==op.backgroundHead)throw Error('background-changed');
    const result=await background.replace([...b.entries,op.target],{operationId:op.id+'b'});check();if(!result.ok)throw Error(result.code||'target-pending');b=background.snapshot();target=b.entries.find(r=>recordKey(r)===recordKey(op.target));
   }
   // Only this exact transition's receipt proves ownership of a recovered copy.
   if(op.phase==='prepared'){const receipt=await canonical.backgroundReceipt('r'+(op.backgroundHead+1));check();if(receipt?.opId!==op.id+'b'||!equal(target,op.target))throw Error('target-collision');op={...op,phase:'target-durable'};save(op);}
   if(!equal(target,op.target))throw Error('target-changed');
   let source=canonical.get(op.source.entityId);
   if(!source?.deleted){if(!equal(source,op.source))throw Error('source-changed');const result=await canonical.retire(op.source,op.id+'d',op.createdAt);check();if(!result.ok)throw Error(result.error?.code||'source-pending');op={...op,phase:'retiring'};save(op);}
   await canonicalReady();source=canonical.get(op.source.entityId);if(!source?.deleted||source.lifecycleMutation!==op.id+'d')throw Error('source-changed');
  }else if(op.direction==='plain'){
   let target=canonical.get(op.targetId);
   if(!target||target.deleted){if(op.phase!=='prepared')throw Error('target-changed');const b=await remoteBackground();if(!equal(b.entries.find(r=>recordKey(r)===recordKey(op.source)),op.source))throw Error('source-changed');const result=await canonical.create(op,op.id+'a',op.createdAt);check();if(!result.ok)throw Error(result.error?.code||'target-pending');op={...op,phase:'target-queued'};save(op);}
   await canonicalReady();target=canonical.get(op.targetId);if(!target||target.deleted||target.lifecycleMutation!==op.id+'a')throw Error('target-collision');
   op={...op,phase:'target-durable'};save(op);
   const b=await remoteBackground(),source=b.entries.find(r=>recordKey(r)===recordKey(op.source));if(source){if(!equal(source,op.source))throw Error('source-changed');const result=await background.replace(b.entries.filter(r=>recordKey(r)!==recordKey(op.source)),{operationId:op.id+'r'});check();if(!result.ok)throw Error(result.code||'source-pending');}
  }else throw Error('invalid-transition');
  clear();try{await canonical.finished?.();}catch{}return{ok:true};
 }catch(error){check();const op=read();if(op)save({...op,error:error.message});return{ok:false,code:error.message};}finally{busy=false;}}
 async function resolve(choice){check();if(busy)throw Error('transition-busy');busy=true;try{const op=read();if(!op)return{ok:true};await canonical.resolveGuard(op.id+(op.direction==='background'?'d':'a'));check();await canonicalReady();const b=await remoteBackground();
 if(choice==='both'){if(op.direction==='background'&&canonical.get(op.source.entityId)?.deleted)throw Error('source-retired');if(op.direction==='plain'&&!b.entries.some(r=>recordKey(r)===recordKey(op.source)))throw Error('source-retired');clear();try{await canonical.finished?.();}catch{}return{ok:true};}
 if(choice!=='original')throw Error('invalid-choice');
 if(op.direction==='background'){const source=canonical.get(op.source.entityId);if(!source||source.deleted)throw Error('source-retired');const target=b.entries.find(r=>recordKey(r)===recordKey(op.target));if(target){const receipt=await canonical.backgroundReceipt('r'+(op.backgroundHead+1));check();if(receipt?.opId!==op.id+'b'||!equal(target,op.target))throw Error('target-changed');const result=await background.replace(b.entries.filter(r=>recordKey(r)!==recordKey(op.target)),{operationId:op.id+'c'});check();if(!result.ok)throw Error('cleanup-pending');}}
 else{if(!b.entries.some(r=>recordKey(r)===recordKey(op.source)))throw Error('source-retired');const target=canonical.get(op.targetId);if(target&&!target.deleted&&target.lifecycleMutation===op.id+'a'){if(target.revision!==op.targetRevision+1)throw Error('target-changed');const result=await canonical.retire(target,op.id+'c',op.createdAt);check();if(!result.ok)throw Error('cleanup-pending');await canonicalReady();}}
 clear();try{await canonical.finished?.();}catch{}return{ok:true};}catch(error){check();return{ok:false,code:error.message};}finally{busy=false;}}
 return Object.freeze({snapshot:()=>{check();return clone(read());},resolve,async start(plan){check();if(read())throw Error('transition-pending');const b=await remoteBackground();let op={...clone(plan),schemaVersion:1,uid,id:'op_'+global.crypto.randomUUID().replace(/-/g,''),createdAt:Date.now(),phase:'prepared',backgroundHead:b.head};
 if(op.direction==='background'){if(!equal(canonical.get(op.source.entityId),op.source))throw Error('source-changed');if(b.entries.some(r=>recordKey(r)===recordKey(op.target)))throw Error('target-collision');}
 else{const target=canonical.get(op.targetId);if(target&&!target.deleted)throw Error('target-collision');if(!equal(b.entries.find(r=>recordKey(r)===recordKey(op.source)),op.source))throw Error('source-changed');op.targetGeneration=target?.generation||0;op.targetRevision=target?.revision||0;}
 save(op);return resume();},resume});
}
global.BackgroundTransitions=Object.freeze({createTransitions,recordKey});
})(typeof window!=='undefined'?window:globalThis);
