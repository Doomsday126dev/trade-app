(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const fields={theme:{key:'pogoTheme',valid:value=>['auto','light','dark'].includes(value)},locale:{key:'pogoUiLocale:v1',valid:value=>['en','ja','es','de'].includes(value)}};
  const revisionPrefix='pogoDisplayPreferenceRevision:v1:',archivePrefix='pogoRecoveredDisplay:v1:';
  function fail(code){throw Object.assign(new Error(code),{code});}
  // Normal choices use a separate revision even when the selected value is unchanged.
  // Recovery writes only owner-scoped overlays, never the ordinary global preference.
  function noteNormalWrite(storage,field){if(!fields[field])return;storage.setItem(revisionPrefix+field,global.crypto.randomUUID());}
  function create({enabled=false,storage,getSession,bundleModel}={}){
    if(!enabled)return Object.freeze({available:false});
    if(!storage?.getItem||!storage?.setItem||typeof storage.key!=='function'||typeof getSession!=='function'||!bundleModel?.verify)throw new TypeError('Owned preference dependencies required');
    const tickets=new WeakMap();
    function session(){const value=getSession();if(!value?.uid||!value.lifecycleId)fail('recovery/session-not-ready');return{uid:value.uid,lifecycleId:value.lifecycleId};}
    function current(expected){const value=session();if(value.uid!==expected.uid||value.lifecycleId!==expected.lifecycleId)fail('recovery/session-changed');}
    function base(field){return{raw:storage.getItem(fields[field].key),revision:storage.getItem(revisionPrefix+field)};}
    function same(a,b){return a.raw===b.raw&&a.revision===b.revision;}
    function prefix(uid){return archivePrefix+encodeURIComponent(uid)+':';}
    function read(field,fallback){if(!fields[field])return fallback;const captured=session(),before=base(field),values=new Set();
      for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(prefix(captured.uid)))continue;
        try{const row=JSON.parse(storage.getItem(key));const value=row?.values?.[field];if(row.schemaVersion===1&&row.ownerUid===captured.uid&&same(row.bases?.[field]||{},before)&&fields[field].valid(value))values.add(value);}catch{}
      }
      current(captured);return values.size===1?[...values][0]:fallback;
    }
    async function review({sourceBundle,accepted=false}={}){if(accepted!==true)fail('recovery/explicit-review-required');const captured=session(),source=await bundleModel.verify(sourceBundle);current(captured);
      if(source.source.ownerUid!==captured.uid)fail('recovery/identity-recovery-required');
      const device=source.sections.preferences.records.find(row=>row.id==='device')?.value||{},values={},bases={},unsupported=[];
      for(const [field,value]of Object.entries(device)){if(!fields[field]||!fields[field].valid(value)){unsupported.push(field);continue;}values[field]=value;bases[field]=base(field);}
      const ticket=Object.freeze({sourceDigest:source.integrity.digest,fields:Object.freeze(Object.keys(values)),unsupported:Object.freeze(unsupported)});
      tickets.set(ticket,{captured,values,bases,digest:source.integrity.digest});return ticket;
    }
    function confirm(ticket){const row=tickets.get(ticket);if(!row)fail('recovery/explicit-review-required');current(row.captured);
      for(const field of Object.keys(row.values))if(!same(base(field),row.bases[field]))fail('recovery/preference-conflict');
      const key=prefix(row.captured.uid)+row.digest,payload=JSON.stringify({schemaVersion:1,ownerUid:row.captured.uid,values:row.values,bases:row.bases}),prior=storage.getItem(key);
      if(prior!==null&&prior!==payload)fail('recovery/preference-conflict');if(prior===null)storage.setItem(key,payload);
      current(row.captured);if(storage.getItem(key)!==payload)fail('recovery/preference-readback-unverified');
      return Object.freeze({status:prior===null?'restored':'idempotent',unsupported:ticket.unsupported,fields:ticket.fields});
    }
    return Object.freeze({available:true,review,confirm,read});
  }
  root.accountRecoveryPreferences=Object.freeze({create,noteNormalWrite});
})(window);
