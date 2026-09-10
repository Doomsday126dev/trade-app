(function(global){
  'use strict';
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge;
  const CAPACITY=global.PogoDomain?.productLimits?.MAX_FAVORITES;
  if(!model||!merge||CAPACITY!==100)throw new Error('Favorite addition contracts are unavailable');
  function capacityPlan(owner,records,slots,addition){
    if(records!=null&&!model.plainObject(records)||slots!=null&&!model.plainObject(slots))return model.failure('account-sync/favorite-capacity-invalid','Favorite capacity evidence is invalid');
    const active=new Set();
    for(const [id,value] of Object.entries(records||{})){
      if(!merge.validateEntity(value,{ownerUid:owner,entityType:'favorite',entityId:id}).ok)return model.failure('account-sync/favorite-capacity-invalid','Favorite capacity evidence is invalid');
      if(!value.deleted)active.add(id);
    }
    active.add(addition.entityId);
    if(active.size>CAPACITY)return model.failure('account-sync/favorite-limit','The account has reached its Favorite limit');
    const kept={},assigned=new Set(),changes={};
    for(const [slot,id] of Object.entries(slots||{})){
      if(!/^s(0|[1-9][0-9]?)$/.test(slot)||!model.firebaseKey(id,128))return model.failure('account-sync/favorite-capacity-invalid','Favorite capacity evidence is invalid');
    }
    for(let n=0;n<CAPACITY;n++){
      const slot=`s${n}`,id=slots?.[slot];
      if(id&&active.has(id)&&!assigned.has(id)){kept[slot]=id;assigned.add(id);}
    }
    for(const id of [...active].sort())if(!assigned.has(id)){
      const slot=Array.from({length:CAPACITY},(_,n)=>`s${n}`).find(key=>!kept[key]);
      kept[slot]=id;assigned.add(id);
    }
    for(let n=0;n<CAPACITY;n++){
      const slot=`s${n}`;
      if((slots?.[slot]||null)!==(kept[slot]||null))changes[`favoriteSlots/${owner}/${slot}`]=kept[slot]||null;
    }
    return Object.freeze({ok:true,changes:Object.freeze(changes),count:active.size});
  }
  function createFavoriteAdditionRepository({repository,database,ref,get,update,serverTimestamp,ownerUid,enabled=false,sessionCurrent=()=>true,timeoutMs=12000}={}){
    const owner=model.firebaseKey(ownerUid,128);
    if(!owner||!repository||!database||[ref,get,update,serverTimestamp].some(fn=>typeof fn!=='function'))throw new TypeError('Favorite addition repository is incomplete');
    const current=()=>{if(!sessionCurrent())throw Object.assign(new Error('Account sync session changed'),{code:'account-sync/session-changed'});};
    const target=id=>`accountSync/${owner}/favorites/${id}`;
    async function bounded(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Favorite write could not be confirmed'),{code:'account-sync/network-failed'})),timeoutMs);})]);}finally{clearTimeout(timer);}}
    async function proof(operation){
      current();const snapshot=await bounded(get(ref(database,target(operation.entityId))));current();
      const value=snapshot.exists()?snapshot.val():null;
      if(value===null)return null;
      if(!merge.validateEntity(value,operation).ok)return model.failure('account-sync/committed-entity-invalid','Committed Favorite data is invalid');
      const result=merge.mergeOperation(value,operation,{acceptedAt:Date.now()});
      return result.ok&&result.status==='idempotent'?Object.freeze({ok:true,status:'idempotent',value,conflicts:Object.freeze([])}):null;
    }
    async function applyAddition(operation){
      if(operation.ownerUid!==owner)return model.failure('account-sync/owner-mismatch','Favorite owner differs');
      const verified=await model.verifyOperation(operation);if(!verified.ok)return verified;
      for(let attempt=0;attempt<3;attempt++){
        current();
        const [accountSnapshot,slotsSnapshot]=await bounded(Promise.all([get(ref(database,`accountSync/${owner}/favorites`)),get(ref(database,`favoriteSlots/${owner}`))]));current();
        const records=accountSnapshot.exists()?accountSnapshot.val():{},slots=slotsSnapshot.exists()?slotsSnapshot.val():{};
        const existing=records?.[operation.entityId]||null,result=merge.mergeOperation(existing,operation,{acceptedAt:Date.now()});
        if(!result.ok)return Object.freeze({...result,status:result.conflicts?.length?'conflict':'rejected',current:existing});
        if(result.status==='idempotent')return Object.freeze({ok:true,status:'idempotent',value:existing,conflicts:Object.freeze([])});
        const plan=capacityPlan(owner,records,slots,result.value);if(!plan.ok)return plan;
        const timestamp=serverTimestamp(),value={...result.value,updatedAt:timestamp,...(!existing?{createdAt:timestamp}:{})};
        let writeError;
        try{current();await bounded(update(ref(database),{...plan.changes,[target(operation.entityId)]:value}));}
        catch(error){writeError=error;}
        current();const accepted=await proof(operation);if(accepted)return accepted;
        const denied=/permission.?denied/i.test(String(writeError?.code||''));
        if(writeError&&!denied)throw writeError;
        // A slot or entity changed concurrently: re-read with the SAME operation
        // ID/base generation. No new add is synthesized across a tombstone.
        if(attempt===2)return model.failure('account-sync/favorite-write-rejected','Favorite could not be saved; refresh and review the account state');
      }
    }
    return Object.freeze({...repository,applyOperation:operation=>enabled&&operation.entityType==='favorite'&&operation.kind==='add'?applyAddition(operation):repository.applyOperation(operation)});
  }
  root.favoriteAdditionRepository=Object.freeze({CAPACITY,capacityPlan,createFavoriteAdditionRepository});
})(window);
