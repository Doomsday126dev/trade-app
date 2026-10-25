(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const model=root.accountSyncModel;
  if(!model)throw new Error('Account sync model must load before the merge engine');
  const ACTIVE_RECORD_KEYS=Object.freeze([
    'schemaVersion','ownerUid','entityType','entityId','identity','generation','revision','deleted',
    'createdAt','updatedAt','values','fieldRevisions','fieldMutations','fieldMutationHashes',
    'lifecycleMutation','lifecycleMutationHash'
  ]);
  const DELETED_RECORD_KEYS=Object.freeze([...ACTIVE_RECORD_KEYS,'deletedAt']);

  function same(a,b){return model.canonicalJson(a)===model.canonicalJson(b);}
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function getPath(value,path){
    return String(path).split('/').reduce((node,key)=>node&&Object.prototype.hasOwnProperty.call(node,key)?node[key]:undefined,value);
  }
  function setPath(value,path,next){
    const parts=String(path).split('/');let node=value;
    for(let index=0;index<parts.length-1;index++)node=node[parts[index]]||(node[parts[index]]={});
    node[parts[parts.length-1]]=next;
  }
  function leafEntries(value,prefix=''){
    if(!model.plainObject(value))return null;
    const result=[];
    for(const [key,child] of Object.entries(value)){
      const path=prefix?`${prefix}/${key}`:key;
      if(model.plainObject(child)){
        const nested=leafEntries(child,path);
        if(!nested?.length)return null;
        result.push(...nested);
      }else result.push([path,child]);
    }
    return result;
  }
  function valueFields(entityType,values){
    if(!model.plainObject(values))return null;
    if(entityType==='tradeEntry')return Object.entries(values);
    if(entityType==='tag')return Object.keys(values).length===1&&Object.hasOwn(values,'label')?[['label',values.label]]:null;
    if(entityType!=='favorite'||!Object.hasOwn(values,'displayName'))return null;
    const keys=Object.keys(values);
    if(keys.some(key=>!['displayName','tagIds'].includes(key))||('tagIds'in values&&!model.plainObject(values.tagIds)))return null;
    return[['displayName',values.displayName],...Object.entries(values.tagIds||{}).map(([tagId,value])=>[`tagIds/${tagId}`,value])];
  }
  function validateEntity(value,{ownerUid,entityType,entityId}={}){
    const expectedKeys=value?.deleted===true?DELETED_RECORD_KEYS:ACTIVE_RECORD_KEYS;
    if(!model.plainObject(value)||Object.keys(value).sort().join(',')!==[...expectedKeys].sort().join(','))return model.failure('account-sync/entity-invalid','Sync entity shape is invalid');
    if(value.schemaVersion!==model.SCHEMA_VERSION||value.ownerUid!==ownerUid||value.entityType!==entityType||value.entityId!==entityId){
      return model.failure('account-sync/entity-binding-mismatch','Sync entity owner or identity is invalid');
    }
    if(!model.identityValid(entityType,entityId,value.identity))return model.failure('account-sync/identity-invalid','Sync entity identity is invalid');
    if(model.integer(value.generation,1)===null||model.integer(value.revision,1)===null||typeof value.deleted!=='boolean')return model.failure('account-sync/entity-revision-invalid','Sync entity revision is invalid');
    for(const timestamp of ['createdAt','updatedAt'])if(model.integer(value[timestamp])===null)return model.failure('account-sync/timestamp-invalid','Sync entity timestamp is invalid');
    if(value.deleted&&model.integer(value.deletedAt)===null)return model.failure('account-sync/timestamp-invalid','Sync deletion timestamp is invalid');
    if(!model.plainObject(value.values)||!model.plainObject(value.fieldRevisions)||!model.plainObject(value.fieldMutations)||!model.plainObject(value.fieldMutationHashes))return model.failure('account-sync/entity-fields-invalid','Sync entity field metadata is invalid');
    const fields=valueFields(entityType,value.values);
    if(!fields||fields.some(([path,fieldValue])=>!model.fieldValueValid(entityType,path,fieldValue)))return model.failure('account-sync/entity-values-invalid','Sync entity values are invalid');
    const expectedPaths=new Set(fields.map(([path])=>model.fieldMetadataPath(entityType,path))),paths=new Set();
    const revisions=leafEntries(value.fieldRevisions),mutations=leafEntries(value.fieldMutations),hashes=leafEntries(value.fieldMutationHashes);
    if(!revisions||!mutations||!hashes)return model.failure('account-sync/entity-fields-invalid','Sync entity field metadata is invalid');
    for(const [path,revision] of revisions){
      if(!expectedPaths.has(path)||model.integer(revision,1)===null||paths.has(path))return model.failure('account-sync/entity-fields-invalid','Sync entity field revision is invalid');
      paths.add(path);
      if(!/^op_[A-Za-z0-9_-]{16,96}$/.test(getPath(value.fieldMutations,path)||'')||!/^[a-f0-9]{64}$/.test(getPath(value.fieldMutationHashes,path)||''))return model.failure('account-sync/entity-fields-invalid','Sync entity field mutation metadata is invalid');
    }
    const mutationPaths=mutations.map(([path])=>path).sort(),hashPaths=hashes.map(([path])=>path).sort(),revisionPaths=[...paths].sort();
    if(revisionPaths.join(',')!==[...expectedPaths].sort().join(',')||mutationPaths.join(',')!==revisionPaths.join(',')||hashPaths.join(',')!==revisionPaths.join(','))return model.failure('account-sync/entity-fields-invalid','Sync entity field metadata is incomplete');
    if(!/^op_[A-Za-z0-9_-]{16,96}$/.test(value.lifecycleMutation)||!/^[a-f0-9]{64}$/.test(value.lifecycleMutationHash))return model.failure('account-sync/lifecycle-invalid','Sync entity lifecycle mutation is invalid');
    return Object.freeze({ok:true,value});
  }
  function validateTransition(current,next){
    if(!current||!next)return model.failure('account-sync/transition-invalid','Sync entity transition is invalid');
    if(current.ownerUid!==next.ownerUid||current.entityType!==next.entityType||current.entityId!==next.entityId||!same(current.identity,next.identity)||current.createdAt!==next.createdAt){
      return model.failure('account-sync/transition-binding-invalid','Sync entity identity changed');
    }
    if(next.revision!==current.revision+1||next.updatedAt<current.updatedAt)return model.failure('account-sync/transition-revision-invalid','Sync entity revision is invalid');
    if(next.generation===current.generation){
      if(next.deleted!==current.deleted||next.lifecycleMutation!==current.lifecycleMutation||next.lifecycleMutationHash!==current.lifecycleMutationHash){
        return model.failure('account-sync/transition-lifecycle-invalid','Sync entity lifecycle changed without a new generation');
      }
      const currentFields=new Map(valueFields(current.entityType,current.values)||[]),nextFields=new Map(valueFields(next.entityType,next.values)||[]);
      const paths=new Set([...currentFields.keys(),...nextFields.keys()]);
      for(const path of paths){
        const metadataPath=model.fieldMetadataPath(next.entityType,path),beforeValue=currentFields.get(path),afterValue=nextFields.get(path),beforeRevision=getPath(current.fieldRevisions,metadataPath)||0,afterRevision=getPath(next.fieldRevisions,metadataPath)||0,beforeMutation=getPath(current.fieldMutations,metadataPath),afterMutation=getPath(next.fieldMutations,metadataPath),beforeHash=getPath(current.fieldMutationHashes,metadataPath),afterHash=getPath(next.fieldMutationHashes,metadataPath);
        if(same(beforeValue,afterValue)){
          if(afterRevision!==beforeRevision||afterMutation!==beforeMutation||afterHash!==beforeHash)return model.failure('account-sync/transition-field-invalid','Unchanged sync field metadata changed');
        }else if(afterRevision!==beforeRevision+1||afterMutation===beforeMutation||afterHash===beforeHash){
          return model.failure('account-sync/transition-field-invalid','Changed sync field metadata is invalid');
        }
      }
      return Object.freeze({ok:true,value:next});
    }
    if(next.generation!==current.generation+1||next.deleted===current.deleted||next.lifecycleMutation===current.lifecycleMutation||next.lifecycleMutationHash===current.lifecycleMutationHash){
      return model.failure('account-sync/transition-lifecycle-invalid','Sync lifecycle transition is invalid');
    }
    if(next.deleted===true){
      if(!same(next.values,current.values)||!same(next.fieldRevisions,current.fieldRevisions)||!same(next.fieldMutations,current.fieldMutations)||!same(next.fieldMutationHashes,current.fieldMutationHashes))return model.failure('account-sync/transition-delete-invalid','Deletion changed sync field data');
      return Object.freeze({ok:true,value:next});
    }
    const fields=valueFields(next.entityType,next.values)||[];
    for(const [path] of fields){
      const metadataPath=model.fieldMetadataPath(next.entityType,path);
      if(getPath(next.fieldRevisions,metadataPath)!==1||getPath(next.fieldMutations,metadataPath)!==next.lifecycleMutation||getPath(next.fieldMutationHashes,metadataPath)!==next.lifecycleMutationHash){
        return model.failure('account-sync/transition-readd-invalid','Re-added sync field metadata is invalid');
      }
    }
    return Object.freeze({ok:true,value:next});
  }
  function conflict(operation,code,fields=[],current=null){
    return Object.freeze({
      conflictId:`conflict_${operation.operationId}`,
      code,operationId:operation.operationId,ownerUid:operation.ownerUid,entityType:operation.entityType,
      entityId:operation.entityId,generation:operation.generation,fields:Object.freeze([...fields]),
      currentRevision:current?.revision||0,createdAt:operation.clientAt,resolved:false
    });
  }
  function createRecord(operation,acceptedAt){
    const values={},fieldRevisions={},fieldMutations={},fieldMutationHashes={};
    for(const [path,value] of Object.entries(operation.patch)){
      setPath(values,path,clone(value));
      const metadataPath=model.fieldMetadataPath(operation.entityType,path);
      setPath(fieldRevisions,metadataPath,1);setPath(fieldMutations,metadataPath,operation.operationId);setPath(fieldMutationHashes,metadataPath,operation.inputHash);
    }
    return{
      schemaVersion:model.SCHEMA_VERSION,ownerUid:operation.ownerUid,entityType:operation.entityType,entityId:operation.entityId,
      identity:clone(operation.identity),generation:operation.generation,revision:1,deleted:false,
      createdAt:acceptedAt,updatedAt:acceptedAt,values,fieldRevisions,fieldMutations,fieldMutationHashes,
      lifecycleMutation:operation.operationId,lifecycleMutationHash:operation.inputHash
    };
  }
  function mergeOperation(current,operation,{acceptedAt=operation?.clientAt}={}){
    if(!operation||operation.schemaVersion!==model.SCHEMA_VERSION||!/^[a-f0-9]{64}$/.test(operation.inputHash||''))return model.failure('account-sync/operation-invalid','Sync operation is invalid');
    if(model.integer(acceptedAt)===null)return model.failure('account-sync/timestamp-invalid','Accepted timestamp is invalid');
    if(current!=null){const valid=validateEntity(current,operation);if(!valid.ok)return valid;}
    if(operation.kind==='add'){
      if(current?.lifecycleMutation===operation.operationId&&current.lifecycleMutationHash===operation.inputHash)return Object.freeze({ok:true,status:'idempotent',value:current,conflicts:Object.freeze([])});
      const initial=current==null&&operation.baseGeneration===0&&operation.generation===1;
      const readd=current?.deleted===true&&operation.baseGeneration===current.generation&&operation.generation===current.generation+1&&same(current.identity,operation.identity);
      if(!initial&&!readd)return Object.freeze({ok:false,error:model.failure('account-sync/lifecycle-conflict','Entity lifecycle changed before this add').error,conflicts:Object.freeze([conflict(operation,'lifecycle-conflict',[],current)])});
      const next=createRecord(operation,acceptedAt);
      if(readd){next.createdAt=current.createdAt;next.revision=current.revision+1;}
      return Object.freeze({ok:true,status:readd?'readded':'applied',value:Object.freeze(next),conflicts:Object.freeze([])});
    }
    if(!current)return Object.freeze({ok:false,error:model.failure('account-sync/entity-missing','Sync entity does not exist').error,conflicts:Object.freeze([conflict(operation,'entity-missing')])});
    if(operation.kind==='delete'){
      if(current.lifecycleMutation===operation.operationId&&current.lifecycleMutationHash===operation.inputHash)return Object.freeze({ok:true,status:'idempotent',value:current,conflicts:Object.freeze([])});
      if(current.deleted||operation.baseGeneration!==current.generation||operation.generation!==current.generation+1){
        return Object.freeze({ok:false,error:model.failure('account-sync/lifecycle-conflict','Entity lifecycle changed before this delete').error,conflicts:Object.freeze([conflict(operation,'lifecycle-conflict',[],current)])});
      }
      const next={...clone(current),generation:operation.generation,revision:current.revision+1,deleted:true,updatedAt:acceptedAt,deletedAt:acceptedAt,lifecycleMutation:operation.operationId,lifecycleMutationHash:operation.inputHash};
      return Object.freeze({ok:true,status:'deleted',value:Object.freeze(next),conflicts:Object.freeze([])});
    }
    if(operation.kind!=='patch')return model.failure('account-sync/operation-invalid','Sync operation kind is invalid');
    if(current.deleted||operation.generation!==current.generation||operation.baseGeneration!==current.generation){
      return Object.freeze({ok:false,error:model.failure('account-sync/stale-generation','Stale operations cannot modify this entity generation').error,conflicts:Object.freeze([conflict(operation,'stale-generation',Object.keys(operation.patch),current)])});
    }
    const next=clone(current),conflictingFields=[],applied=[];
    for(const [path,value] of Object.entries(operation.patch)){
      const metadataPath=model.fieldMetadataPath(operation.entityType,path),currentRevision=getPath(current.fieldRevisions,metadataPath)||0,baseRevision=operation.baseFieldRevisions[path];
      if(getPath(current.fieldMutations,metadataPath)===operation.operationId&&getPath(current.fieldMutationHashes,metadataPath)===operation.inputHash)continue;
      if(same(getPath(current.values,path),value))continue;
      if(currentRevision!==baseRevision){conflictingFields.push(path);continue;}
      setPath(next.values,path,clone(value));
      setPath(next.fieldRevisions,metadataPath,currentRevision+1);
      setPath(next.fieldMutations,metadataPath,operation.operationId);
      setPath(next.fieldMutationHashes,metadataPath,operation.inputHash);
      applied.push(path);
    }
    if(!applied.length){
      if(!conflictingFields.length)return Object.freeze({ok:true,status:'idempotent',value:current,conflicts:Object.freeze([])});
      return Object.freeze({ok:false,error:model.failure('account-sync/same-field-conflict','These fields changed on another device').error,conflicts:Object.freeze([conflict(operation,'same-field-conflict',conflictingFields,current)])});
    }
    next.revision=current.revision+1;next.updatedAt=acceptedAt;
    const conflicts=conflictingFields.length?[conflict(operation,'same-field-conflict',conflictingFields,current)]:[];
    return Object.freeze({ok:true,status:conflicts.length?'applied-with-conflict':'applied',value:Object.freeze(next),appliedFields:Object.freeze(applied),conflicts:Object.freeze(conflicts)});
  }
  function operationBase(entity,paths=[]){
    const baseFieldRevisions={};
    for(const path of paths)baseFieldRevisions[path]=getPath(entity?.fieldRevisions,model.fieldMetadataPath(entity?.entityType,path))||0;
    return Object.freeze({baseGeneration:entity?.generation||0,generation:entity?.generation||0,baseFieldRevisions});
  }

  root.accountSyncMerge=Object.freeze({ACTIVE_RECORD_KEYS,DELETED_RECORD_KEYS,getPath,setPath,leafEntries,validateEntity,validateTransition,mergeOperation,operationBase});
})(window);
