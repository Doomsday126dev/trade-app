(function(global){
  'use strict';

  const FIREBASE_SDK='https://www.gstatic.com/firebasejs/10.12.2';
  const APP_CHECK_SITE_KEY='6Lc6-X8tAAAAAI-MY4WdeI8RV-njpbiFX5mFjDbz';
  const LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const LIST_KEYS=Object.freeze({wishlist:'list.wishlist',dynamax:'list.dynamax',gmax:'list.gigantamax',costumes:'list.others'});
  const PRIORITY_KEYS=Object.freeze({H:'priority.high',M:'priority.medium',L:'priority.low'});
  const diagnostics={mode:'anonymous-public-share',authSdkRequested:false,privateReads:0,readPaths:[],events:[]};
  const state={request:null,snapshot:null,type:'wishlist',status:'idle'};
  global.__pogoPublicShareDiagnostics=diagnostics;

  function core(){return global.PogoI18n?.core;}
  function t(key,params={}){return core()?.t(key,params)||key;}
  function esc(value){return global.PogoUtils.textSafety.escHtml(value);}
  function attr(value){return global.PogoUtils.textSafety.escAttr(value);}
  function translate(root=document){
    root.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n);});
    root.querySelectorAll('[data-i18n-placeholder]').forEach(node=>{node.placeholder=t(node.dataset.i18nPlaceholder);});
    root.querySelectorAll('[data-i18n-aria-label]').forEach(node=>{node.setAttribute('aria-label',t(node.dataset.i18nAriaLabel));});
    document.documentElement.lang=core().getLocale();
  }
  function initials(value){
    const parts=String(value||'').trim().split(/\s+/).filter(Boolean);
    return(parts.length>1?parts.slice(0,2).map(part=>part[0]):[parts[0]?.slice(0,2)]).join('').toUpperCase()||'?';
  }
  function hidePrivateShell(){
    for(const id of ['app','login-pg','config-pg']){
      const node=document.getElementById(id);if(node){node.style.display='none';node.setAttribute('aria-hidden','true');}
    }
    document.getElementById('preauth-pg')?.setAttribute('hidden','');
    document.getElementById('share-view')?.classList.add('active');
  }
  function publicError(message,detail=t('share.publicTryAgain')){
    const out=document.getElementById('share-list-out');
    if(out)out.innerHTML=`<div class="empty public-share-empty" role="status"><div class="empty-icon" aria-hidden="true">🔗</div><h3>${esc(message)}</h3><p>${esc(detail)}</p><button type="button" class="btn btn-secondary" data-public-share-action="retry">${esc(t('share.publicRetry'))}</button></div>`;
  }
  function loadingShell(username){
    hidePrivateShell();translate(document);
    const header=document.getElementById('share-hdr');
    if(header)header.innerHTML=`<div class="share-loading-avatar" aria-hidden="true">${esc(initials(username))}</div><div class="share-hdr-info"><div class="share-hdr-name">${esc(t('share.listTitle',{username}))}</div><div class="share-hdr-meta"><span class="meta-item">${esc(t('trainer.profileLoading'))}</span></div></div>`;
    const tabs=document.getElementById('share-list-tabs');if(tabs)tabs.replaceChildren();
    const out=document.getElementById('share-list-out');
    if(out)out.innerHTML=`<div class="empty public-share-empty" role="status"><div class="empty-icon public-share-spinner" aria-hidden="true">◌</div><h3>${esc(t('trainer.profileLoading'))}</h3><p>${esc(t('trainer.profileLoadingHelp'))}</p></div>`;
    const back=document.querySelector('#share-view .share-back-link');
    if(back){back.href=new URL('./',location.href).href;back.textContent=t('share.backToApp');}
  }
  function entryModel(value){
    const encoded=typeof value==='string'?global.PogoDomain.priorityValues.parsePri(value):{};
    const raw=value&&typeof value==='object'?value:{};
    const parsed=typeof raw.value==='string'?global.PogoDomain.priorityValues.parsePri(raw.value):encoded;
    const p=String(raw.p||parsed.p||'').toUpperCase();
    return{
      p:PRIORITY_KEYS[p]?p:'L',mod:String(raw.mod??parsed.mod??'').trim(),
      lucky:raw.lucky===true||parsed.lucky===true,shiny:raw.shiny===true||parsed.shiny===true,
      xxl:raw.xxl===true||parsed.xxl===true,xxs:raw.xxs===true||parsed.xxs===true,
      backgroundId:global.PogoDomain.priorityValues.normalizeBackgroundId(raw.backgroundId||parsed.backgroundId||'')
    };
  }
  function backgroundParts(id){
    const catalog=global.PogoDomain.backgroundCatalog,record=catalog.get(id);
    const label=catalog.shortLabel(id)||catalog.display(id)||id;
    const visual=global.PogoDomain.backgroundVisual.resolve(id,record);
    return{label,full:catalog.display(id)||label,visual};
  }
  function backgroundBadge(id){
    if(!id)return'';
    const{label,full,visual}=backgroundParts(id),className=global.PogoDomain.backgroundVisual.className(visual),style=global.PogoDomain.backgroundVisual.style(visual);
    return`<span class="share-pcard-flag background background-visual-label ${attr(className)}" style="${attr(style)}" title="${attr(full)}"><span class="background-visual-chip" aria-hidden="true"></span><span>${esc(label)}</span><span class="sr-only">${esc(t('background.label'))}</span></span>`;
  }
  function spriteHtml(name,gender){
    const urls=global.PogoDomain.spriteSlugs.publicSpriteUrls(name,gender);
    if(!urls.length)return'<div class="public-share-pokemon-mark" aria-hidden="true"></div>';
    const[src,...fallbacks]=urls;
    return`<div class="share-pcard-sprite-wrap"><img class="share-pcard-sprite public-share-pokemon-sprite" src="${attr(src)}" data-public-sprite-fallbacks="${attr(fallbacks.join('|'))}" width="26" height="26" alt="" loading="lazy" decoding="async"></div>`;
  }
  function entryCard(name,value){
    const model=entryModel(value),gender=global.PogoDomain.priorityValues.entryGender(model.mod);
    const cleanMod=model.mod.replace(/\b(female|male|f|m)\b/gi,'').replace(/\s+/g,' ').trim();
    const flags=[
      gender==='f'?`<span class="share-pcard-flag gender-f" title="${attr(t('share.flagFemale'))}">♀</span>`:'',
      gender==='m'?`<span class="share-pcard-flag gender-m" title="${attr(t('share.flagMale'))}">♂</span>`:'',
      model.lucky?`<span class="share-pcard-flag lucky" title="${attr(t('share.flagLucky'))}">⚡</span>`:'',
      model.shiny?`<span class="share-pcard-flag shiny" title="${attr(t('share.flagShiny'))}">✨</span>`:'',
      model.xxl?`<span class="share-pcard-flag xxl" title="${attr(t('share.flagXxl'))}">XXL</span>`:'',
      model.xxs?`<span class="share-pcard-flag xxs" title="${attr(t('share.flagXxs'))}">XXS</span>`:'',
      backgroundBadge(model.backgroundId)
    ].filter(Boolean).join('');
    const visual=model.backgroundId?backgroundParts(model.backgroundId).visual:null;
    return`<article class="share-pcard card-row ${visual?attr(global.PogoDomain.backgroundVisual.className(visual)):''}" ${visual?`style="${attr(global.PogoDomain.backgroundVisual.style(visual))}"`:''}>${spriteHtml(name,gender)}<div class="share-pcard-info"><span class="share-pcard-name">${esc(name)}</span>${cleanMod||flags?`<div class="share-pcard-meta">${cleanMod?`<span class="share-pcard-mod">${esc(cleanMod)}</span>`:''}${flags}</div>`:''}</div></article>`;
  }
  function updatedLabel(timestamp){
    const value=Number(timestamp);
    if(!Number.isFinite(value)||value<=0)return t('share.updatedNever');
    return t('share.updated',{time:core().relativeTimeFromTimestamp(value)});
  }
  function listLabel(type){return t(LIST_KEYS[type]||'list.others');}
  function renderHeader(snapshot){
    const profile=snapshot.profile||{},username=snapshot.username;
    const header=document.getElementById('share-hdr');
    if(!header)return;
    header.innerHTML=`<div class="av public-share-avatar" aria-hidden="true">${esc(initials(username))}</div><div class="share-hdr-info"><div class="share-hdr-name">${esc(t('share.listTitle',{username}))}</div><div class="share-hdr-meta">${profile.friendCode?`<span class="meta-item">🎮 <code>${esc(profile.friendCode)}</code></span>`:''}${profile.discord?`<span class="meta-item">${esc(profile.discord)}</span>`:''}<span class="meta-item">📅 ${esc(updatedLabel(profile.lastUpdated||snapshot.updatedAt))}</span></div>${profile.bio?`<div class="share-hdr-bio">${esc(profile.bio)}</div>`:''}</div>`;
  }
  function renderTabs(snapshot){
    const counts=Object.fromEntries(LIST_TYPES.map(type=>[type,Object.keys(snapshot.lists[type]||{}).length]));
    const visible=LIST_TYPES.filter(type=>counts[type]||type===state.type);
    const tabs=document.getElementById('share-list-tabs');
    if(tabs)tabs.innerHTML=visible.map(type=>`<button type="button" class="ltab ${type===state.type?'active':''}" data-public-share-action="list" data-list-type="${type}" aria-pressed="${type===state.type}">${esc(t('share.listTab',{label:listLabel(type),count:core().formatNumber(counts[type])}))}</button>`).join('');
  }
  function renderList(snapshot){
    const list=snapshot.lists[state.type]||{},groups={H:[],M:[],L:[]};
    for(const [name,value] of Object.entries(list))groups[entryModel(value).p].push([name,value]);
    const out=document.getElementById('share-list-out');if(!out)return;
    if(!Object.keys(list).length){
      out.innerHTML=`<div class="empty public-share-empty"><div class="empty-icon" aria-hidden="true">📋</div><h3>${esc(t('share.emptyTitle'))}</h3><p>${esc(t('share.emptyHelp'))}</p></div>${ctaHtml()}`;
      return;
    }
    const sections=['H','M','L'].map(priority=>{
      const entries=groups[priority].sort((a,b)=>a[0].localeCompare(b[0],core().getLocale(),{sensitivity:'base'}));
      if(!entries.length)return'';
      return`<section class="share-section card-content"><div class="share-section-hdr"><span class="badge ${priority}"><span class="prio-mark">${priority}</span>${esc(t(PRIORITY_KEYS[priority]))}</span><span class="share-section-count">${esc(core().formatPlural('share.entryCount',entries.length))}</span></div><div class="share-pgrid">${entries.map(([name,value])=>entryCard(name,value)).join('')}</div></section>`;
    }).join('');
    out.innerHTML=sections+ctaHtml();
  }
  function ctaHtml(){return`<aside class="public-share-cta"><span>${esc(t('share.publicCta'))}</span><a class="btn btn-secondary" href="./">${esc(t('share.publicCtaAction'))}</a></aside>`;}
  function render(){
    if(!state.snapshot)return;
    translate(document);
    renderHeader(state.snapshot);renderTabs(state.snapshot);renderList(state.snapshot);
  }
  async function readProjection(){
    const request=state.request;
    if(!request?.valid){
      hidePrivateShell();translate(document);
      publicError(t('share.publicInvalid'),t('share.publicInvalidHelp'));
      global.__pogoShellReady=true;global.__pogoBootComplete=true;
      clearTimeout(global.__pogoBootWatch);
      return;
    }
    loadingShell(request.username);
    diagnostics.events.push('firebase-modules-requested');
    const [appSdk,appCheckSdk,databaseSdk]=await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),import(`${FIREBASE_SDK}/firebase-app-check.js`),import(`${FIREBASE_SDK}/firebase-database.js`)
    ]);
    const app=appSdk.initializeApp(global.__POGO_FIREBASE_CONFIG,'pogo-public-share');
    diagnostics.events.push('app-check-initialize');
    const result=global.PogoServices.firebaseAppCheck.initializeAppCheckOnce({app,siteKey:APP_CHECK_SITE_KEY,...appCheckSdk});
    if(!result.ok)throw Object.assign(new Error('Public verification is unavailable'),{code:result.code});
    if(typeof appCheckSdk.getToken!=='function')throw Object.assign(new Error('Public verification is unavailable'),{code:'app-check/token-api-unavailable'});
    await appCheckSdk.getToken(result.instance,false);
    diagnostics.events.push('app-check-ready');
    global.__pogoStartup.appCheckReadyAt=performance.now();
    const path=`publicShares/${request.username}`;
    diagnostics.readPaths.push(path);diagnostics.events.push(`read:${path}`);
    const snapshot=await databaseSdk.get(databaseSdk.ref(databaseSdk.getDatabase(app),path));
    const projection=global.PogoDomain.publicSharePublication.publicShareProjectionStatus(snapshot.exists()?snapshot.val():null,{username:request.username});
    if(!projection.ok){
      const key={not_published:'trainer.notPublished',projection_incomplete:'trainer.shareNeedsRepublishing',projection_unsupported:'trainer.sharedMalformed'}[projection.status]||'trainer.sharedUnavailable';
      publicError(t(key),t('trainer.publicHint'));return;
    }
    state.snapshot=projection.snapshot;
    state.type=LIST_TYPES.includes(request.type)?request.type:'wishlist';
    state.status='ready';render();
    global.__pogoShellReady=true;global.__pogoBootComplete=true;
    global.__pogoStartup.protectedReadyAt=performance.now();
    clearTimeout(global.__pogoBootWatch);
  }
  async function retry(){
    try{state.status='loading';await readProjection();}
    catch(error){state.status='error';console.warn('Public share read failed',String(error?.code||'public-share/read-failed'));publicError(t('trainer.sharedReadFailed'));}
  }
  function openLanguage(){
    const modal=document.getElementById('settings-modal'),layout=document.getElementById('settings-layout');
    if(!modal||!layout)return;
    layout.classList.add('settings-public','public-share-language-only');
    layout.querySelectorAll('[data-settings-section]').forEach(section=>{section.hidden=section.dataset.settingsSection!=='language';});
    const select=document.getElementById('settings-language');if(select)select.value=core().getLocale();
    const title=document.getElementById('settings-title');if(title)title.textContent=t('settings.languageTitle');
    const description=document.getElementById('settings-description');if(description)description.textContent=t('settings.languageDescription');
    modal.classList.add('open');document.body.classList.add('modal-open');
    requestAnimationFrame(()=>select?.focus());
  }
  function closeModal(id){
    document.getElementById(id)?.classList.remove('open');document.body.classList.remove('modal-open');
    document.getElementById('share-language-trigger')?.focus();
  }
  async function changeLocale(locale){
    await global.__pogoEnsureLocale(locale);core().setLocale(locale);translate(document);
    if(state.snapshot)render();
    const select=document.getElementById('settings-language');if(select)select.value=core().getLocale();
  }
  function handleAction(event){
    const control=event.target.closest('[data-public-share-action]');if(!control)return;
    if(control.dataset.publicShareAction==='retry')retry();
    if(control.dataset.publicShareAction==='list'){state.type=LIST_TYPES.includes(control.dataset.listType)?control.dataset.listType:'wishlist';renderTabs(state.snapshot);renderList(state.snapshot);}
  }
  function handleSpriteError(event){
    const image=event.target;
    if(image?.tagName!=='IMG'||!image.classList.contains('public-share-pokemon-sprite'))return;
    const fallbacks=(image.dataset.publicSpriteFallbacks||'').split('|').filter(Boolean),next=fallbacks.shift();
    if(next){image.dataset.publicSpriteFallbacks=fallbacks.join('|');image.src=next;return;}
    const fallback=document.createElement('span');fallback.className='public-share-pokemon-mark';fallback.setAttribute('aria-hidden','true');
    image.closest('.share-pcard-sprite-wrap')?.replaceWith(fallback);
  }
  async function start(request){
    if(state.status!=='idle')return;
    state.request=request;state.type=request?.type||'wishlist';state.status='loading';
    document.addEventListener('click',handleAction);
    document.addEventListener('error',handleSpriteError,true);
    Object.assign(global,{openSettingsPanel:openLanguage,closeModal,changeInterfaceLocale:changeLocale,exitShareView:()=>{location.href=new URL('./',location.href).href;}});
    try{await readProjection();}
    catch(error){state.status='error';console.warn('Public share read failed',String(error?.code||'public-share/read-failed'));publicError(t('trainer.sharedReadFailed'));}
  }

  global.__pogoStartPublicShare=start;
})(window);
