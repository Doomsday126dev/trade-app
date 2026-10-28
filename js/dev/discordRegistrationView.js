(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  // Candidate-only mount: the production loader does not import this module.
  function mount({container,runtime,onComplete=()=>{},returnFocus}={}){
    if(!container||!runtime?.available||!runtime.confirmRegistration)throw new TypeError('Enabled candidate runtime required');
    const doc=container.ownerDocument,section=doc.createElement('section');section.className='card provider-onboarding';
    section.setAttribute('aria-label','Finish trainer setup');
    const title=doc.createElement('h2');title.textContent='Finish trainer setup';section.append(title);
    const description=doc.createElement('p');description.textContent='Choose your trainer name. Discord profile details are not copied. Already have an account? Cancel, sign in with your PIN, and connect Discord there.';section.append(description);
    const label=doc.createElement('label');label.textContent='Trainer name';const input=doc.createElement('input');input.className='field-control';input.maxLength=64;input.autocomplete='off';label.append(input);section.append(label);
    const privacy=doc.createElement('p');privacy.textContent='Shared profiles and wanted lists can be viewed by others. Only add profile details you want to share.';section.append(privacy);
    const consentLabel=doc.createElement('label'),consent=doc.createElement('input');consent.type='checkbox';consentLabel.append(consent,doc.createTextNode(' I reviewed my trainer name and sharing information.'));section.append(consentLabel);
    const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');section.append(status);
    const create=doc.createElement('button'),cancel=doc.createElement('button');create.type=cancel.type='button';create.className='btn btn-primary';cancel.className='btn';create.textContent='Create account';cancel.textContent='Cancel';const actions=doc.createElement('div');actions.className='provider-onboarding-actions';actions.append(create,cancel);section.append(actions);
    let removed=false,completedResult=null;
    function cleanup(){removed=true;section.remove();returnFocus?.focus?.();}
    create.onclick=async()=>{
      if(!completedResult&&!consent.checked){status.textContent='Review the sharing information before creating your account.';consent.focus();return;}
      create.disabled=true;input.disabled=true;consent.disabled=true;status.textContent='Creating and verifying your account…';
      try{
        if(!completedResult)completedResult=await runtime.confirmRegistration({requestedHandle:input.value,reviewAccepted:true});
        if(!removed){status.textContent='Account verified.';cancel.textContent='Close';await onComplete(completedResult);cleanup();}
      }
      catch(error){if(!removed)status.textContent=completedResult?'You are signed in. Loading your account failed; retry loading it.':error.code==='discord/handle_conflict'?'That trainer name is taken. Choose another name.':'Account result needs checking. Retry the same name, or sign in again to recover any completed account.';}
      finally{if(!removed){create.disabled=false;input.disabled=!!completedResult;consent.disabled=!!completedResult;if(completedResult)create.textContent='Retry loading account';}}
    };
    cancel.onclick=async()=>{
      if(completedResult){cleanup();return;}
      if(runtime.getState().status==='committing'){status.textContent='Finishing sign-in. Please wait.';return;}
      cancel.disabled=true;
      try{
        const result=runtime.getState().status==='pending'?runtime.cancel():await runtime.cancelRegistration();
        if(result.canCancel===false){status.textContent='Finishing sign-in. Please wait.';return;}
        cleanup();
      }catch{if(!removed)status.textContent='Cancellation could not be verified. No account will be deleted; sign in again to check its result.';}
      finally{if(!removed)cancel.disabled=false;}
    };
    container.append(section);input.focus();return cleanup;
  }
  root.discordRegistrationView=Object.freeze({mount});
})(window);
