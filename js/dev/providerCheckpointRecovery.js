(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function fail(code){throw Object.assign(new Error(code),{code});}
  function createVerifier({enabled=false,auth,projectId,apiKey,fetchImpl=global.fetch,clock=()=>Date.now()}={}){
    if(!enabled)return undefined;
    if(!auth||auth.app?.options?.projectId!==projectId||!/^[-a-z0-9]+$/.test(projectId||'')||!/^[A-Za-z0-9_-]{6,256}$/.test(apiKey||'')||typeof fetchImpl!=='function')throw new TypeError('Explicit Firebase checkpoint verification dependencies required');
    let endpoint='https://identitytoolkit.googleapis.com/v1/accounts:lookup';
    const emulator=auth.emulatorConfig;
    if(emulator){if(!projectId.startsWith('demo-')||emulator.host!=='127.0.0.1'||emulator.protocol!=='http'||!Number.isInteger(emulator.port))fail('provider-auth/verification-target-invalid');endpoint=`http://127.0.0.1:${emulator.port}/identitytoolkit.googleapis.com/v1/accounts:lookup`;}
    function unchanged(user,uid){if(auth.currentUser!==user||String(auth.currentUser?.uid||'')!==uid)fail('provider-auth/session-changed');}
    return async function verify({user,expectedUid}={}){
      const uid=String(expectedUid||'');await auth.authStateReady?.();unchanged(user,uid);
      // Sign-out is a local SDK state transition, not server-token revocation.
      // The gate separately requires an exact completed sign-out receipt under its lock.
      if(!uid){if(user!==null)fail('provider-auth/session-changed');return{verified:true,uid:''};}
      if(typeof user?.getIdTokenResult!=='function')fail('provider-auth/verification-unavailable');
      const token=await user.getIdTokenResult(true);unchanged(user,uid);
      const claims=token?.claims,at=Math.floor(clock()/1000);
      if(typeof token?.token!=='string'||token.token.length>16384||claims?.sub!==uid||claims.aud!==projectId||claims.iss!==`https://securetoken.google.com/${projectId}`||!Number.isSafeInteger(claims.exp)||claims.exp<=at||!Number.isSafeInteger(claims.auth_time)||claims.auth_time>at)fail('provider-auth/verification-failed');
      const controller=new global.AbortController(),timer=global.setTimeout(()=>controller.abort(),10000);
      try{
        const response=await fetchImpl(`${endpoint}?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token.token}),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});unchanged(user,uid);
        if(!response.ok)fail('provider-auth/verification-failed');const result=await response.json();unchanged(user,uid);const record=result?.users?.[0],validSince=record?.validSince===undefined?0:Number(record.validSince);
        if(result?.users?.length!==1||record.localId!==uid||record.disabled===true||!Number.isSafeInteger(validSince)||validSince>claims.auth_time)fail('provider-auth/verification-failed');
        return{verified:true,uid};
      }finally{global.clearTimeout(timer);}
    };
  }
  function mount({container,host,returnFocus}={}){
    if(!container||!host?.available||!host.prepareCheckpointRecovery||!host.confirmCheckpointRecovery)throw new TypeError('Installed recovery-capable host required');
    const doc=container.ownerDocument,section=doc.createElement('section');section.className='card provider-onboarding';section.setAttribute('aria-label','Review interrupted sign-in checkpoint');
    const heading=doc.createElement('h2');heading.textContent='Review interrupted sign-in';heading.tabIndex=-1;section.append(heading);const description=doc.createElement('p');description.textContent='This checks a recorded completed sign-in or sign-out against the current Firebase session. It changes only the local coordination checkpoint after your confirmation. It does not switch accounts, reset unknown outcomes or recover missing accounts.';section.append(description);
    const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');section.append(status);const prepare=doc.createElement('button');prepare.type='button';prepare.className='btn';prepare.textContent='Check current session';section.append(prepare);
    const label=doc.createElement('label'),ack=doc.createElement('input');ack.type='checkbox';label.append(ack,doc.createTextNode(' I reviewed this completed operation and current session.'));section.append(label);const confirm=doc.createElement('button');confirm.type='button';confirm.className='btn btn-primary';confirm.textContent='Reconcile local checkpoint';confirm.disabled=true;section.append(confirm);
    const close=doc.createElement('button');close.type='button';close.className='btn';close.textContent='Close review';section.append(close);let removed=false,ticket=null,generation=0;
    prepare.onclick=async()=>{const epoch=++generation;ticket=null;confirm.disabled=true;ack.checked=false;prepare.disabled=true;try{const result=await host.prepareCheckpointRecovery();if(removed||epoch!==generation)return;ticket=result;status.textContent=`Verified recorded ${result.kind} for ${result.uid||'signed-out session'}. Confirm only if this is the session you intended.`;confirm.disabled=false;}catch(error){if(!removed)status.textContent=`Checkpoint remains blocked: ${error.code||'provider-auth/verification-failed'}. No reset was performed.`;}finally{if(!removed)prepare.disabled=false;}};
    confirm.onclick=async()=>{if(!ack.checked||!ticket){status.textContent='Review the checked session and confirm before continuing.';ack.focus();return;}const epoch=generation;confirm.disabled=true;prepare.disabled=true;close.disabled=true;try{await host.confirmCheckpointRecovery(ticket,{accepted:true});if(!removed&&epoch===generation)status.textContent='Local checkpoint reconciled. Your Firebase account was not changed.';ticket=null;}catch(error){ticket=null;if(!removed)status.textContent=`Checkpoint remains blocked: ${error.code||'provider-auth/verification-failed'}. Check the session again.`;}finally{if(!removed){prepare.disabled=false;close.disabled=false;}}};
    const cleanup=()=>{if(removed)return;removed=true;generation++;ticket=null;section.remove();returnFocus?.focus?.();};close.onclick=cleanup;container.append(section);heading.focus();return cleanup;
  }
  root.providerCheckpointRecovery=Object.freeze({createVerifier,mount});
})(window);
