(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const PREFIX='pogo-provider-reminder:v1:';
  const REMINDER_MS=30*24*60*60*1000;
  const BINDING=/^v1_[a-f0-9]{64}$/;
  const PROVIDERS=Object.freeze(['google','discord']);
  const COPY=Object.freeze({
    title:'Keep access to this trainer account',
    description:'Add Google or Discord to this same account. Your lists, Favorites, groups, tags, shared links, and permissions stay with it. Your PIN keeps working. Dismissing this reminder does not change your account.',
    google:'Review Google sign-in',discord:'Review Discord sign-in',
    later:'Remind me in 30 days',mute:'Do not remind me again',close:'Dismiss sign-in reminder',
    failed:'Could not open Account & Security. Try again from Settings.',
    reviewTitle:'Confirm your Discord account',
    reviewHelp:'Check the Discord account below before connecting it to this trainer account. If it is wrong, cancel and choose the right Discord account. No trainer data will be moved.',
    confirm:'Connect this Discord account',cancel:'Cancel',reviewFailed:'Connection could not be confirmed. Check Account & Security before retrying.'
  });
  function validSession(value){
    return value&&BINDING.test(value.ownerBinding)&&BINDING.test(value.lifecycleBinding)&&value.accountReady===true&&
      value.legacyPinUsable===true&&Array.isArray(value.linkedProviders)&&Array.isArray(value.availableProviders);
  }
  function createProviderMigrationOnboarding({enabled=false,eligibleOwnerBindings=[],storage=global.localStorage,
    getSession,openSecurity,clock=()=>Date.now()}={}){
    if(typeof getSession!=='function'||typeof openSecurity!=='function')throw new TypeError('Migration onboarding dependencies required');
    const allowlist=new Set(eligibleOwnerBindings.filter(value=>BINDING.test(value)));
    const shown=new Set();let active=null,busy=false;
    const key=owner=>`${PREFIX}${owner}`;
    function preferences(owner){
      try{
        const raw=storage.getItem(key(owner));if(!raw)return{schemaVersion:1,nextPromptAt:0,muted:false};
        const value=JSON.parse(raw);
        if(!value||Object.keys(value).sort().join(',')!=='muted,nextPromptAt,schemaVersion'||value.schemaVersion!==1||
          !Number.isSafeInteger(value.nextPromptAt)||value.nextPromptAt<0||typeof value.muted!=='boolean')return null;
        return value;
      }catch{return null;}
    }
    function write(owner,value){try{storage.setItem(key(owner),JSON.stringify(value));return true;}catch{return false;}}
    function sessionCurrent(captured){
      const value=getSession();
      return validSession(value)&&value.ownerBinding===captured.ownerBinding&&value.lifecycleBinding===captured.lifecycleBinding&&
        value.linkedProviders.every(provider=>!PROVIDERS.includes(provider));
    }
    function inspect(){
      const session=getSession();
      if(!enabled||!validSession(session)||!allowlist.has(session.ownerBinding))return{eligible:false,reason:'not-enrolled'};
      if(session.linkedProviders.some(provider=>PROVIDERS.includes(provider)))return{eligible:false,reason:'already-linked'};
      const providers=PROVIDERS.filter(provider=>session.availableProviders.includes(provider));
      if(!providers.length)return{eligible:false,reason:'replacement-unavailable'};
      const value=preferences(session.ownerBinding),now=clock();
      if(!Number.isSafeInteger(now)||now<0||!value||value.muted||now<value.nextPromptAt||shown.has(session.ownerBinding))return{eligible:false,reason:'dismissed-or-not-due'};
      return{eligible:true,providers};
    }
    function claim(){
      const result=inspect();if(!result.eligible)return result;
      const session=getSession();
      if(!write(session.ownerBinding,{schemaVersion:1,nextPromptAt:clock()+REMINDER_MS,muted:false}))return{eligible:false,reason:'storage-unavailable'};
      shown.add(session.ownerBinding);active={ownerBinding:session.ownerBinding,lifecycleBinding:session.lifecycleBinding,providers:result.providers};
      return{eligible:true,providers:[...result.providers]};
    }
    function dismiss({mute=false}={}){
      if(!active||!sessionCurrent(active)){active=null;return false;}
      const saved=write(active.ownerBinding,{schemaVersion:1,nextPromptAt:clock()+REMINDER_MS,muted:mute===true});
      active=null;return saved;
    }
    async function review(provider){
      if(busy||!active||!active.providers.includes(provider)||!sessionCurrent(active))return{ok:false,code:'session-changed'};
      const captured=active,current=getSession();
      if(!current.availableProviders.includes(provider))return{ok:false,code:'provider-unavailable'};
      busy=true;
      try{
        // This opens the existing security surface; linking still needs its own explicit action.
        await openSecurity({providerKey:provider,ownerBinding:captured.ownerBinding,lifecycleBinding:captured.lifecycleBinding,
          isCurrent:()=>sessionCurrent(captured)});
        if(!sessionCurrent(captured))return{ok:false,code:'session-changed'};
        active=null;return{ok:true};
      }catch{return{ok:false,code:'open-failed'};}finally{busy=false;}
    }
    function isCurrent(){return!!active&&sessionCurrent(active);}
    return Object.freeze({inspect,claim,dismiss,review,isCurrent});
  }
  function element(document,tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function mountMigrationNotice({container,controller,returnFocus,document=global.document,t=key=>COPY[key]}={}){
    const claimed=controller.claim();if(!claimed.eligible)return()=>{};
    const region=element(document,'section',undefined,'provider-migration-notice');
    region.setAttribute('aria-label',t('title')); // Non-modal: no focus theft, trap, or repeated live announcement.
    const title=element(document,'h2',t('title')),description=element(document,'p',t('description'));
    const actions=element(document,'div',undefined,'provider-migration-actions');
    const feedback=element(document,'p');feedback.setAttribute('role','status');
    const buttons=[];
    function remove(){const restore=region.contains(document.activeElement);region.remove();if(restore&&returnFocus?.isConnected){returnFocus.tabIndex=-1;returnFocus.focus();}}
    function button(label,run){
      const node=element(document,'button',label,'btn');node.type='button';buttons.push(node);
      node.addEventListener('click',run);actions.append(node);return node;
    }
    for(const provider of claimed.providers)button(t(provider),async()=>{
      if(!controller.isCurrent()){remove();return;}
      buttons.forEach(node=>{node.disabled=true;});
      const result=await controller.review(provider);
      if(result.ok||result.code==='session-changed'){remove();return;}
      feedback.textContent=t('failed');buttons.forEach(node=>{node.disabled=false;});
    });
    button(t('later'),()=>{controller.dismiss();remove();});
    button(t('mute'),()=>{controller.dismiss({mute:true});remove();});
    const close=button('×',()=>{controller.dismiss();remove();});close.setAttribute('aria-label',t('close'));
    region.append(title,description,actions,feedback);container.append(region);
    // Host must call cleanup on auth/session change, including while the notice is idle.
    return remove;
  }
  function mountDiscordLinkReview({container,discordLabel,confirm,cancel,returnFocus,document=global.document,t=key=>COPY[key]}={}){
    const region=element(document,'section',undefined,'provider-migration-notice');region.setAttribute('aria-label',t('reviewTitle'));
    const heading=element(document,'h2',t('reviewTitle')),help=element(document,'p',t('reviewHelp'));
    const identity=element(document,'strong',String(discordLabel||'')); // Never interpolate provider text as markup.
    const feedback=element(document,'p');feedback.setAttribute('role','status');
    const connect=element(document,'button',t('confirm'),'btn'),back=element(document,'button',t('cancel'),'btn');connect.type=back.type='button';
    function remove(){region.remove();if(returnFocus?.isConnected){returnFocus.tabIndex=-1;returnFocus.focus();}}
    connect.addEventListener('click',async()=>{
      connect.disabled=back.disabled=true;
      try{await confirm();remove();}catch{feedback.textContent=t('reviewFailed');connect.disabled=back.disabled=false;}
    });
    back.addEventListener('click',()=>{cancel();remove();});
    region.append(heading,help,identity,feedback,connect,back);container.append(region);heading.tabIndex=-1;heading.focus();
    return()=>region.remove();
  }
  root.providerMigrationOnboarding=Object.freeze({PREFIX,REMINDER_MS,COPY,createProviderMigrationOnboarding,mountMigrationNotice,mountDiscordLinkReview});
})(window);
