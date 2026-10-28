(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function fail(code){throw Object.assign(new Error(code),{code});}
  const policies={canonicalEntities:'Validated additive entries, Favorites and tags',profile:'Blank supported profile fields only; differences require review',legacyLists:'Catalogue conversion required; unresolved rows remain in the backup',favorites:'Reference history; canonical Favorite import required',tags:'Reference history; canonical tag import required',groups:'Reference only; membership is not restored',preferences:'Owned history plus theme/interface locale only',sharing:'Reference only; URLs, ownership and visibility are not restored',permissions:'Reference only; roles and grants are not restored',journal:'Evidence only; pending writes are never replayed',migration:'Evidence only; not an initialization command',recovery:'Evidence and unresolved items for manual review'};
  async function certify(bundleModel,input){
    const source=await bundleModel.verify(input),unsupported=[];
    const device=source.sections.preferences.records.find(row=>row.id==='device')?.value||{};
    for(const key of Object.keys(device))if(!['theme','locale'].includes(key))unsupported.push(`device preference: ${key}`);
    for(const row of source.sections.preferences.records)if(!['device','history'].includes(row.id))unsupported.push(`preference record: ${row.id}`);
    return Object.freeze({schemaVersion:1,digest:source.integrity.digest,ownerUid:source.source.ownerUid,trainerHandle:source.source.trainerHandle,
      coverage:'bundle-schema-and-sections-verified',fullRestore:false,unsupported:Object.freeze(unsupported),
      rows:Object.freeze(Object.keys(policies).map(section=>Object.freeze({section,count:source.sections[section].records.length,policy:policies[section]})))});
  }
  function create({enabled=false,bundleModel,collector,dryRun,ownerConsumer,getSession,restoreProfile,restoreHistory,restorePreferences}={}){
    if(!enabled)return Object.freeze({available:false});
    if(!bundleModel?.verify||!collector?.collect||!dryRun?.prepare||!dryRun?.revalidate||!ownerConsumer?.review||!ownerConsumer?.run||typeof getSession!=='function')throw new TypeError('Owned recovery review dependencies required');
    let epoch=0,active=false,reviewed=null,state={phase:'idle'};
    function session(){const s=getSession();if(!s?.uid||!s.lifecycleId||s.accountReady!==true)fail('recovery/session-not-ready');return{uid:s.uid,lifecycleId:s.lifecycleId};}
    function current(expected,generation){const s=session();if(s.uid!==expected.uid||s.lifecycleId!==expected.lifecycleId||generation!==epoch)fail('recovery/session-changed');}
    const snapshot=()=>Object.freeze({...state});
    async function exportBackup(save){if(active||typeof save!=='function')fail('recovery/operation-pending');const expected=session(),generation=epoch;active=true;state={phase:'exporting'};
      try{const bundle=await bundleModel.verify(await collector.collect());current(expected,generation);if(bundle.source.ownerUid!==expected.uid)fail('recovery/owner-mismatch');const coverage=await certify(bundleModel,bundle);current(expected,generation);save(bundle);state={phase:'exported',coverage};return snapshot();}
      catch(error){state={phase:'blocked',code:error.code||'recovery/export-failed'};throw error;}finally{active=false;}
    }
    async function prepare(input){if(active)fail('recovery/operation-pending');const expected=session(),generation=++epoch;active=true;reviewed=null;state={phase:'checking'};
      try{const source=await bundleModel.verify(input);current(expected,generation);if(source.source.ownerUid!==expected.uid)fail('recovery/identity-recovery-required');
        const target=await bundleModel.verify(await collector.collect());current(expected,generation);const plan=await dryRun.prepare({sourceBundle:source,currentBundle:target,targetUid:expected.uid});current(expected,generation);
        const coverage=await certify(bundleModel,source);current(expected,generation);reviewed={source,plan,expected,generation,ticket:null,scope:null,results:{}};const profile=source.sections.profile.records.find(row=>row.id==='canonical-profile')?.value?.values||source.sections.profile.records.find(row=>row.id==='legacy-profile')?.value||{},device=source.sections.preferences.records.find(row=>row.id==='device')?.value||{};
        state={phase:'review',operationCount:plan.operations.length,coverage,contentReview:{profile:Object.fromEntries(['friendCode','bio','discord','avatarPokemon'].filter(key=>profile[key]!==undefined).map(key=>[key,profile[key]])),display:Object.fromEntries(['theme','locale'].filter(key=>device[key]!==undefined).map(key=>[key,device[key]]))},rows:plan.rows.map(row=>Object.freeze({...row}))};return snapshot();
      }catch(error){state={phase:'blocked',code:error.code||'recovery/review-failed'};throw error;}finally{active=false;}
    }
    async function prepareFile(file){if(active)fail('recovery/operation-pending');const expected=session(),generation=++epoch;reviewed=null;if(!file||file.size>8*1024*1024||typeof file.text!=='function')fail('recovery/size-limit');const text=await file.text();current(expected,generation);return prepare(text);}
    async function apply({accepted=false,entries=false,profile=false,history=false,preferences=false}={}){
      if(active)fail('recovery/operation-pending');if(!reviewed||accepted!==true||![entries,profile,history,preferences].some(Boolean))fail('recovery/explicit-review-required');
      const record=reviewed,scope=JSON.stringify({entries,profile,history,preferences});current(record.expected,record.generation);if(record.scope&&record.scope!==scope)fail('recovery/review-scope-changed');
      if(profile&&typeof restoreProfile!=='function'||history&&typeof restoreHistory!=='function'||preferences&&typeof restorePreferences!=='function')fail('recovery/adapter-unavailable');
      active=true;state={...state,phase:'applying'};
      try{
        if(!record.scope){const target=await collector.collect();current(record.expected,record.generation);await dryRun.revalidate({plan:record.plan,sourceBundle:record.source,currentBundle:target,targetUid:record.expected.uid});current(record.expected,record.generation);record.scope=scope;}
        if(entries&&!record.results.entries){if(!record.ticket)record.ticket=await ownerConsumer.review({sourceBundle:record.source,operations:record.plan.operations,accepted:true});current(record.expected,record.generation);record.results.entries=await ownerConsumer.run(record.ticket);current(record.expected,record.generation);}
        for(const [key,requested,restore]of [['profile',profile,restoreProfile],['history',history,restoreHistory],['preferences',preferences,restorePreferences]])if(requested&&!record.results[key]){current(record.expected,record.generation);record.results[key]=await restore(record.source);current(record.expected,record.generation);}
        state={...state,phase:'finished',results:JSON.parse(JSON.stringify(record.results)),fullRestore:false};return snapshot();
      }catch(error){state={...state,phase:'blocked',code:error.code||'recovery/apply-failed',partialResults:JSON.parse(JSON.stringify(record.results))};throw error;}finally{active=false;}
    }
    function cancel(){epoch++;reviewed=null;ownerConsumer.cancel?.();state={phase:'canceled',mayHaveCommitted:active};return snapshot();}
    return Object.freeze({available:true,exportBackup,prepare,prepareFile,apply,cancel,snapshot});
  }
  function mount({container,controller,returnFocus}={}){
    if(!container||!controller?.available)throw new TypeError('Enabled recovery review required');
    const doc=container.ownerDocument,section=doc.createElement('section');section.className='card provider-onboarding';section.setAttribute('aria-label','Account backup and recovery review');
    const title=doc.createElement('h2');title.textContent='Back up and review recovery';title.tabIndex=-1;section.append(title);
    const info=doc.createElement('p');info.textContent='Linking Google or Discord keeps this account and its data. Recovery is optional. Keep PIN access. A backup file cannot prove control of another account or restore permissions.';section.append(info);
    const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');section.append(status);
    const exportButton=doc.createElement('button');exportButton.type='button';exportButton.className='btn';exportButton.textContent='Download account backup';section.append(exportButton);
    const label=doc.createElement('label');label.textContent='Review a backup file';const file=doc.createElement('input');file.type='file';file.accept='.json,application/json';label.append(file);section.append(label);
    const details=doc.createElement('div');section.append(details);const selections={};
    for(const [key,text]of Object.entries({entries:'Add reviewed entries, Favorites and tags',profile:'Fill blank supported profile fields',history:'Add owned trainer history',preferences:'Recover theme and interface language'})){const label=doc.createElement('label'),box=doc.createElement('input');box.type='checkbox';label.append(box,doc.createTextNode(' '+text));section.append(label,doc.createElement('br'));selections[key]=box;}
    const ackLabel=doc.createElement('label'),ack=doc.createElement('input');ack.type='checkbox';ackLabel.append(ack,doc.createTextNode(' I reviewed the proposed additions and recovery limits.'));section.append(ackLabel);
    const apply=doc.createElement('button');apply.type='button';apply.className='btn btn-primary';apply.textContent='Apply selected recovery';apply.disabled=true;section.append(apply);
    const cancel=doc.createElement('button');cancel.type='button';cancel.className='btn';cancel.textContent='Stop recovery';section.append(cancel);let removed=false,reading=0;
    function errorStatus(error){if(removed)return;if(['recovery/session-changed','recovery/identity-recovery-required'].includes(error?.code)){details.replaceChildren();ack.checked=false;apply.disabled=true;}status.textContent=`Recovery stopped: ${error?.code||'recovery/failed'}. Existing data is retained. Some verified additions may already be saved; review before continuing.`;}
    function renderReview(value){details.replaceChildren();const heading=doc.createElement('h3');heading.textContent=`${value.coverage.trainerHandle}: ${value.operationCount} proposed additions`;details.append(heading);const list=doc.createElement('ul');for(const row of value.coverage.rows){const item=doc.createElement('li');item.textContent=`${row.section}: ${row.count} records. ${row.policy}`;list.append(item);}for(const name of value.coverage.unsupported){const item=doc.createElement('li');item.textContent=`Manual review: ${name}`;list.append(item);}details.append(list);const content=doc.createElement('pre');content.style.whiteSpace='pre-wrap';content.style.overflowWrap='anywhere';content.textContent='Profile and display values to review: '+JSON.stringify(value.contentReview,null,2);details.append(content);const rows=doc.createElement('pre');rows.style.whiteSpace='pre-wrap';rows.style.overflowWrap='anywhere';rows.textContent=value.rows.map(row=>`${row.section} / ${row.id}: ${row.status}`).join('\n');details.append(rows);status.textContent='Review complete. Only selected, supported additions will be attempted; this is not a full account migration.';apply.disabled=false;}
    exportButton.onclick=async()=>{exportButton.disabled=true;try{await controller.exportBackup(bundle=>{if(removed)return;const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'})),link=doc.createElement('a');link.href=url;link.download='pogo-account-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});if(!removed)status.textContent='Backup download requested. Verify that you saved the private file before relying on it. No accounts were changed.';}catch(error){errorStatus(error);}finally{if(!removed)exportButton.disabled=false;}};
    file.onchange=async()=>{const token=++reading,selected=file.files?.[0];ack.checked=false;Object.values(selections).forEach(box=>box.checked=false);apply.disabled=true;if(!selected)return;try{if(selected.size>8*1024*1024)fail('recovery/size-limit');if(removed||token!==reading)return;const value=await controller.prepareFile(selected);if(!removed&&token===reading)renderReview(value);}catch(error){errorStatus(error);}};
    apply.onclick=async()=>{if(!ack.checked){status.textContent='Review the additions and limits, then check the confirmation box.';ack.focus();return;}apply.disabled=true;file.disabled=true;try{const result=await controller.apply({accepted:true,...Object.fromEntries(Object.entries(selections).map(([key,box])=>[key,box.checked]))});if(!removed)status.textContent=`Recovery attempt finished. ${Object.entries(result.results).map(([key,value])=>`${key}: ${value.status||((value.ok===false)?'needs review':'processed')}`).join('; ')}. Reference-only sections and conflicts still require review; PIN remains available.`;}catch(error){errorStatus(error);}finally{if(!removed){apply.disabled=details.childElementCount===0;file.disabled=false;}}};
    cancel.onclick=()=>{reading++;const result=controller.cancel();apply.disabled=true;status.textContent=result.mayHaveCommitted?'Stop requested. An already-started operation may finish; saved additions are retained. Review the file again to reconcile.':'Recovery stopped. No further writes will be started. You can review a file again.';};
    container.append(section);title.focus();return()=>{removed=true;reading++;controller.cancel();section.remove();returnFocus?.focus?.();};
  }
  root.accountRecoveryReview=Object.freeze({create,certify,mount});
})(window);
