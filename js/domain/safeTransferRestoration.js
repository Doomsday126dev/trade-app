(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const CONTRACT_VERSION=1;
  const SOURCE_STATES=Object.freeze(['complete','missing','inaccessible','stale','partial','malformed','obsolete','error','timeout']);
  const WANT_CATEGORIES=Object.freeze(['wishlist','dynamax','gmax','costumes','special']);
  const APPLICATION_CHARACTER_BUDGET=1500;

  function normalizedText(value){return String(value??'').normalize('NFKC').trim();}
  function normalizedKey(value){return normalizedText(value).toLocaleLowerCase('en-US');}
  function version(value){const out=normalizedText(value);return out||null;}
  function speciesId(value){
    const number=typeof value==='number'?value:/^\d+$/.test(normalizedText(value))?Number(value):NaN;
    return Number.isSafeInteger(number)&&number>0&&number<=9999?number:null;
  }
  function uniqueSpecies(values){return Object.freeze([...new Set((values||[]).map(speciesId).filter(Boolean))].sort((a,b)=>a-b));}
  function stableObject(value){
    if(Array.isArray(value))return value.map(stableObject);
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableObject(value[key])]));
  }
  function fingerprint(value){return JSON.stringify(stableObject(value));}
  function failure(code,details={}){return Object.freeze({ok:false,status:'blocked',executable:false,commands:Object.freeze([]),error:Object.freeze({code,...details})});}

  function createCatalog(entries=[]){
    const exact=new Map(),ambiguous=new Set(),byCatalogId=new Map();
    function remember(raw,id){
      const key=normalizedKey(raw);if(!key)return;
      const prior=exact.get(key);
      if(prior&&prior!==id){ambiguous.add(key);exact.delete(key);return;}
      if(!ambiguous.has(key))exact.set(key,id);
    }
    for(const raw of entries||[]){
      const id=speciesId(raw?.speciesId??raw?.no);if(!id)continue;
      const aliases=[raw?.name,raw?.displayName,raw?.dn,raw?.catalogId,...(raw?.legacyAliases||[]),...(raw?.searchAliases||[])];
      for(const alias of aliases)remember(alias,id);
      const catalogId=normalizedText(raw?.catalogId);if(catalogId){
        const prior=byCatalogId.get(catalogId);
        if(prior&&prior!==id)ambiguous.add(normalizedKey(catalogId));
        else byCatalogId.set(catalogId,id);
      }
    }
    return Object.freeze({
      resolve(declaration={}){
        const catalogId=normalizedText(declaration.catalogId);
        const name=normalizedText(declaration.name);
        const catalogSpecies=catalogId&&!ambiguous.has(normalizedKey(catalogId))?byCatalogId.get(catalogId)||exact.get(normalizedKey(catalogId)):null;
        const namedSpecies=name&&!ambiguous.has(normalizedKey(name))?exact.get(normalizedKey(name)):null;
        if(catalogSpecies&&namedSpecies&&catalogSpecies!==namedSpecies)return Object.freeze({ok:false,reason:'identity_conflict'});
        const resolved=catalogSpecies||namedSpecies;
        if(resolved)return Object.freeze({ok:true,speciesId:resolved,resolution:'exact_catalog'});
        const established=speciesId(declaration.speciesId??declaration.no);
        if(established&&['canonical-catalog','source-species-id'].includes(declaration.speciesEvidence)){
          return Object.freeze({ok:true,speciesId:established,resolution:'established_species'});
        }
        return Object.freeze({ok:false,reason:ambiguous.has(normalizedKey(name))?'ambiguous_identity':'unresolved_identity'});
      }
    });
  }

  function createReviewedUniverse({version:rawVersion,reviewedEntries=[],candidateEntries=[],policy='existing-tradeable-wishlist-catalog-exclusions'}={}){
    const universeVersion=version(rawVersion);
    const reviewed=uniqueSpecies(reviewedEntries.map(entry=>entry?.speciesId??entry?.no??entry));
    const candidates=uniqueSpecies(candidateEntries.map(entry=>entry?.speciesId??entry?.no??entry));
    const reviewedSet=new Set(reviewed);
    if(!universeVersion||!reviewed.length||candidates.some(id=>!reviewedSet.has(id)))return null;
    const candidateSet=new Set(candidates);
    return Object.freeze({version:universeVersion,species:reviewed,excludedSpecies:Object.freeze(reviewed.filter(id=>!candidateSet.has(id))),policy:normalizedText(policy)});
  }

  function unavailableSource(trainerId,state,details={}){
    return Object.freeze({
      trainerId:version(trainerId)||'',state,complete:false,freshness:'unverified',
      pagination:Object.freeze({complete:false,nextCursor:null}),declarations:Object.freeze([]),...details
    });
  }

  function repositoryFailureState(error){
    const code=normalizedKey(error?.code);
    if(/(?:permission|denied|unauth|forbidden)/.test(code))return'inaccessible';
    if(/(?:timeout|deadline)/.test(code))return'timeout';
    if(/(?:stale|cache|obsolete)/.test(code))return'stale';
    return'error';
  }

  // This adapter accepts only the result of an exact, just-completed repository
  // read. Completeness and currentness are derived here from that transport
  // contract and the validated whole public projection; callers cannot assert
  // them with optimistic state/freshness arguments.
  function sourceFromRepositoryResult({trainerId,label,result,read}={},dependencies={}){
    const id=version(trainerId),username=normalizedText(label);
    if(!id||!username)return unavailableSource(id,'error');
    if(typeof dependencies.validateProjection!=='function'||typeof dependencies.intentEntries!=='function')throw new TypeError('Public projection adapters are required');
    if(read?.kind!=='exact-public-share'||read?.scope!=='whole-projection'||read?.completed!==true||!version(read?.operationId)){
      return unavailableSource(id,'stale',{readEvidence:Object.freeze({kind:normalizedText(read?.kind),scope:normalizedText(read?.scope),completed:read?.completed===true,operationId:version(read?.operationId)})});
    }
    if(!result?.ok)return unavailableSource(id,repositoryFailureState(result?.error));
    const projection=result.value??result.snapshot??null;
    const checked=dependencies.validateProjection(projection,{username});
    if(!checked?.ok){
      const mapped=checked?.status==='not_published'?'missing':checked?.status==='projection_incomplete'?'partial':
        checked?.status==='projection_unsupported'&&checked?.rejectionCounts?.unsupported_version?'obsolete':checked?.status==='projection_unsupported'?'malformed':'error';
      return unavailableSource(id,mapped);
    }
    const declarations=dependencies.intentEntries(checked.snapshot,'lf');
    const sourceVersion=`public-share:${fingerprint({version:checked.snapshot.version,updatedAt:checked.snapshot.updatedAt,declarations,lists:checked.snapshot.lists})}`;
    return Object.freeze({
      trainerId:id,state:'complete',complete:true,freshness:'current',snapshotVersion:`public-share-v${checked.snapshot.version}`,sourceVersion,
      pagination:Object.freeze({complete:true,nextCursor:null}),declarations:Object.freeze(declarations),
      readEvidence:Object.freeze({kind:'exact-public-share',scope:'whole-projection',completed:true,operationId:version(read.operationId)})
    });
  }

  function normalizeScope(scope){
    const id=version(scope?.id),scopeVersion=version(scope?.version),kind=normalizedText(scope?.kind);
    if(!id||!scopeVersion||!['trainers','group'].includes(kind))return null;
    if(!Array.isArray(scope.selected)||!scope.selected.length)return null;
    const selected=[],seen=new Set();
    for(const raw of scope.selected){
      const trainerId=version(raw?.id),label=normalizedText(raw?.label);
      if(!trainerId||!label||seen.has(trainerId))return null;
      seen.add(trainerId);selected.push(Object.freeze({id:trainerId,label}));
    }
    return Object.freeze({id,version:scopeVersion,kind,selected:Object.freeze(selected),displayedSelectionVersion:version(scope.displayedSelectionVersion)||scopeVersion});
  }

  function normalizeUniverse(universe){
    const universeVersion=version(universe?.version),reviewed=uniqueSpecies(universe?.species),excluded=uniqueSpecies(universe?.excludedSpecies);
    if(!universeVersion||!reviewed.length)return null;
    const reviewedSet=new Set(reviewed),unknownExcluded=excluded.filter(id=>!reviewedSet.has(id));
    if(unknownExcluded.length)return null;
    const excludedSet=new Set(excluded);
    return Object.freeze({version:universeVersion,reviewed,excluded,candidates:Object.freeze(reviewed.filter(id=>!excludedSet.has(id))),policy:normalizedText(universe?.policy)||'reviewed-transfer-candidates'});
  }

  function sourceFailure(source,trainerId){
    if(!source)return failure('missing_source',{trainerId});
    const state=normalizedText(source.state);
    if(!SOURCE_STATES.includes(state))return failure('invalid_source_state',{trainerId,state});
    if(state!=='complete')return failure(`${state}_source`,{trainerId});
    if(source.complete!==true)return failure('partial_source',{trainerId});
    if(source.freshness!=='current')return failure('stale_source',{trainerId});
    if(source.pagination?.complete!==true||source.pagination?.nextCursor!==null)return failure('incomplete_pagination',{trainerId});
    if(!version(source.snapshotVersion)||!version(source.sourceVersion))return failure('unversioned_source',{trainerId});
    if(!Array.isArray(source.declarations))return failure('invalid_declarations',{trainerId});
    return null;
  }

  function evaluate(snapshot,{catalog}={}){
    if(snapshot?.contractVersion!==CONTRACT_VERSION)return failure('unsupported_contract');
    const accountId=version(snapshot?.account?.id),accountVersion=version(snapshot?.account?.version);
    if(!accountId||!accountVersion)return failure('account_binding_required');
    const scope=normalizeScope(snapshot.scope);if(!scope)return failure('explicit_scope_required');
    if(scope.displayedSelectionVersion!==scope.version)return failure('displayed_scope_mismatch');
    const universe=normalizeUniverse(snapshot.universe);if(!universe)return failure('reviewed_universe_required');
    if(!catalog||typeof catalog.resolve!=='function')return failure('catalog_required');
    if(!Array.isArray(snapshot.sources))return failure('sources_required');
    const selectedIds=scope.selected.map(item=>item.id),selectedSet=new Set(selectedIds);
    const sourceIds=snapshot.sources.map(item=>version(item?.trainerId)).filter(Boolean);
    if(sourceIds.length!==new Set(sourceIds).size||sourceIds.length!==selectedIds.length||sourceIds.some(id=>!selectedSet.has(id))){
      return failure('source_scope_mismatch');
    }
    const byTrainer=new Map(snapshot.sources.map(source=>[version(source?.trainerId),source]));
    const protectedSet=new Set(),resolved=[],sourceVersions={};
    for(const trainer of scope.selected){
      const source=byTrainer.get(trainer.id),blocked=sourceFailure(source,trainer.id);if(blocked)return blocked;
      sourceVersions[trainer.id]=version(source.sourceVersion);
      for(let index=0;index<source.declarations.length;index++){
        const declaration=source.declarations[index]||{};
        if(declaration.intent&&declaration.intent!=='lf')continue;
        const category=normalizedText(declaration.category||declaration.type||'wishlist').toLocaleLowerCase('en-US');
        if(!WANT_CATEGORIES.includes(category))return failure('unsupported_declaration_category',{trainerId:trainer.id,index,category});
        const identity=catalog.resolve(declaration);
        if(!identity.ok)return failure(identity.reason||'unresolved_identity',{trainerId:trainer.id,index,name:normalizedText(declaration.name)});
        protectedSet.add(identity.speciesId);
        resolved.push(Object.freeze({trainerId:trainer.id,index,speciesId:identity.speciesId,category,resolution:identity.resolution}));
      }
    }
    const protectedSpecies=uniqueSpecies([...protectedSet]);
    const candidates=Object.freeze(universe.candidates.filter(id=>!protectedSet.has(id)));
    const binding=Object.freeze({
      account:Object.freeze({id:accountId,version:accountVersion}),
      scope:Object.freeze({id:scope.id,version:scope.version,kind:scope.kind,selectedIds:Object.freeze([...selectedIds])}),
      universeVersion:universe.version,
      sourceVersions:Object.freeze(stableObject(sourceVersions))
    });
    return Object.freeze({
      ok:true,status:'qualified',executable:false,scope,universe,binding,bindingFingerprint:fingerprint(binding),
      protectedSpecies,candidateSpecies:candidates,resolvedDeclarations:Object.freeze(resolved),
      completeness:Object.freeze(scope.selected.map(trainer=>Object.freeze({trainerId:trainer.id,state:'complete',sourceVersion:sourceVersions[trainer.id]})))
    });
  }

  function commandPlan(qualified,{syntax,locale='en',characterBudget=APPLICATION_CHARACTER_BUDGET}={}){
    if(!qualified?.ok)return qualified||failure('qualified_snapshot_required');
    if(!syntax?.safeTransferQuery||!syntax?.serializeQuery)return failure('serializer_required');
    const gameLocale=syntax.localeKey?syntax.localeKey(locale):normalizedText(locale)||'en';
    const binding=Object.freeze({...qualified.binding,gameLocale});
    const bindingFingerprint=fingerprint(binding);
    const budget=Math.max(32,Math.min(APPLICATION_CHARACTER_BUDGET,Number(characterBudget)||APPLICATION_CHARACTER_BUDGET));
    if(!qualified.candidateSpecies.length){
      return Object.freeze({...qualified,binding,bindingFingerprint,status:'empty_candidates',gameLocale,characterBudget:budget,commands:Object.freeze([]),executable:false});
    }
    const serialize=ids=>syntax.serializeQuery(syntax.safeTransferQuery(ids),gameLocale);
    const groups=[];let pending=[];
    for(const id of qualified.candidateSpecies){
      if(pending.length&&serialize([...pending,id]).length>budget){groups.push(pending);pending=[];}
      pending.push(id);
      if(serialize(pending).length>budget)return failure('character_budget_too_small',{speciesId:id,characterBudget:budget});
    }
    if(pending.length)groups.push(pending);
    const commands=Object.freeze(groups.map((ids,index)=>Object.freeze({index,species:Object.freeze([...ids]),value:serialize(ids)})));
    return Object.freeze({...qualified,binding,bindingFingerprint,status:'ready',gameLocale,characterBudget:budget,commands,executable:true});
  }

  function bindingMatches(expected,current){
    if(!expected||!current)return false;
    const normalized={
      account:{id:version(current.account?.id),version:version(current.account?.version)},
      scope:{id:version(current.scope?.id),version:version(current.scope?.version),kind:normalizedText(current.scope?.kind),selectedIds:Object.freeze([...(current.scope?.selectedIds||[])].map(String))},
      universeVersion:version(current.universeVersion),sourceVersions:stableObject(current.sourceVersions||{}),gameLocale:normalizedText(current.gameLocale)
    };
    return fingerprint(expected)===fingerprint(normalized);
  }

  function createController({loadSnapshot,plan,currentBinding,copy,revalidateBeforeCopy=false}={}){
    if(typeof loadSnapshot!=='function'||typeof plan!=='function'||typeof currentBinding!=='function'||typeof copy!=='function')throw new TypeError('Safe-transfer controller dependencies are incomplete');
    let generation=0,state=Object.freeze({phase:'idle',request:null,plan:null,error:null,manualCommand:''}),listeners=new Set();
    const publish=next=>{state=Object.freeze(next);for(const listener of listeners)listener(state);return state;};
    function subscribe(listener){if(typeof listener!=='function')throw new TypeError('listener required');listeners.add(listener);listener(state);return()=>listeners.delete(listener);}
    function invalidate(reason='binding_changed'){
      generation++;return publish({phase:'invalidated',request:state.request,plan:null,error:Object.freeze({code:reason}),manualCommand:''});
    }
    async function start(request){
      const token=++generation,requestBinding=request?.binding;
      publish({phase:'loading',request:Object.freeze({...request}),plan:null,error:null,manualCommand:''});
      let snapshot;
      try{snapshot=await loadSnapshot(request,{generation:token});}
      catch(error){if(token!==generation)return state;return publish({phase:'blocked',request,error:Object.freeze({code:String(error?.code||'load_error')}),plan:null,manualCommand:''});}
      if(token!==generation)return state;
      const live=currentBinding();
      if(requestBinding&&!bindingMatches(requestBinding,live))return invalidate('request_binding_changed');
      const result=plan(snapshot,request);
      if(!result?.ok||!result.executable)return publish({phase:'blocked',request,plan:result,error:result?.error||Object.freeze({code:result?.status||'not_executable'}),manualCommand:''});
      if(!bindingMatches(result.binding,live))return invalidate('result_binding_changed');
      return publish({phase:'ready',request,plan:result,error:null,manualCommand:''});
    }
    async function copyPart(index=0){
      const active=state;
      if(!['ready','copy_failed','copied'].includes(active.phase)||!active.plan?.executable)return Object.freeze({ok:false,status:'not_ready'});
      if(!bindingMatches(active.plan.binding,currentBinding())){invalidate('copy_binding_changed');return Object.freeze({ok:false,status:'stale'});}
      const command=active.plan.commands[index];if(!command)return Object.freeze({ok:false,status:'missing_part'});
      const token=++generation;
      publish({...active,phase:'copying',manualCommand:command.value,error:null,copyOperation:token,copiedPart:index});
      const stillCurrent=()=>token===generation&&state.copyOperation===token&&state.plan===active.plan&&bindingMatches(active.plan.binding,currentBinding());
      const stale=()=>{if(token===generation)invalidate('copy_binding_changed');return Object.freeze({ok:false,status:'stale'});};
      try{
        if(revalidateBeforeCopy){
          const snapshot=await loadSnapshot(active.request,{generation:token,reason:'copy'});
          if(!stillCurrent())return stale();
          const refreshed=plan(snapshot,active.request);
          if(!refreshed?.ok||!refreshed.executable||refreshed.bindingFingerprint!==active.plan.bindingFingerprint||!bindingMatches(refreshed.binding,currentBinding())){
            if(token===generation)invalidate('copy_revalidation_changed');
            return Object.freeze({ok:false,status:'stale'});
          }
        }
        await copy(command.value);
        if(!stillCurrent())return stale();
        publish({...active,phase:'copied',manualCommand:command.value,error:null,copiedPart:index,copyOperation:token});
        return Object.freeze({ok:true,status:'copied',part:index,value:command.value,binding:active.plan.binding});
      }catch(error){
        if(!stillCurrent())return stale();
        publish({...active,phase:'copy_failed',manualCommand:command.value,error:Object.freeze({code:String(error?.code||'copy_failed')}),copiedPart:index,copyOperation:token});
        return Object.freeze({ok:false,status:'copy_failed',part:index,value:command.value});
      }
    }
    return Object.freeze({start,copyPart,invalidate,subscribe,snapshot:()=>state});
  }

  root.safeTransferRestoration=Object.freeze({
    CONTRACT_VERSION,SOURCE_STATES,WANT_CATEGORIES,APPLICATION_CHARACTER_BUDGET,
    normalizedKey,uniqueSpecies,fingerprint,createCatalog,createReviewedUniverse,sourceFromRepositoryResult,evaluate,commandPlan,bindingMatches,createController
  });
})(window);
