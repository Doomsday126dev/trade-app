(function(global){
  const root = global.PogoUi = global.PogoUi || {};
  const searchStrings = global.PogoDomain && global.PogoDomain.searchStrings;
  if(!searchStrings)throw new Error('Search string helpers must load before string HTML helpers');
  const {strLenInfo,POGO_STR_LIMIT}=searchStrings;

  function strLenHtml(str,{t,formatNumber}={}){
    const{len,cls}=strLenInfo(str);
    const limit=POGO_STR_LIMIT;
    const display=value=>typeof formatNumber==='function'?formatNumber(value):value;
    const title=typeof t==='function'?t('share.searchLimitTitle',{limit:display(limit)}):`PoGo search limit is ~${limit} chars`;
    return `<span class="str-meta ${cls}" title="${title}">${display(len)}/${display(limit)}</span>`;
  }
  function strWarnHtml(str,{t,formatNumber}={}){
    const{len,cls}=strLenInfo(str);
    if(!cls)return'';
    if(typeof t==='function'){
      const display=value=>typeof formatNumber==='function'?formatNumber(value):value;
      const key=cls==='danger'?'share.searchLimitExceeded':'share.searchLimitApproaching';
      return `<div class="str-warn-banner${cls==='danger'?' danger':''}">⚠️ ${t(key,{limit:display(POGO_STR_LIMIT),count:display(len)})}</div>`;
    }
    if(cls==='danger')return `<div class="str-warn-banner danger">⚠️ This string exceeds PoGo's ~${POGO_STR_LIMIT} char limit (${len}). It will be truncated in-game. Consider splitting into multiple priority lists.</div>`;
    return `<div class="str-warn-banner">⚠️ Approaching PoGo's ~${POGO_STR_LIMIT} char limit (${len}). Consider splitting soon.</div>`;
  }

  const manualPanels=new WeakMap();
  let panelSequence=0;
  function requiresManualCheck(entry){
    if(entry.unresolved||['shiny','lucky','xxl','xxs'].some(flag=>entry[flag]))return true;
    if(['mod','variant','gender','maxType','note','backgroundId','backgroundLabel'].some(key=>String(entry[key]||'').trim()))return true;
    if([entry.category,entry.type].some(value=>value&&value!=='wishlist'))return true;
    const name=String(entry.name||'').trim();
    if(!name)return false; // A numeric-only species scope has no exact qualifier.
    const names=global.PogoI18n?.pokemonNames;
    // Keep meaningful punctuation (Unown !/?, costumes, etc.) when comparing
    // with the admitted species label; autocomplete normalization is too broad.
    const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[.'’]/g,'').replaceAll('_',' ').replace(/\s+/g,' ').trim();
    if(names&&normalize(name)===normalize(names.speciesName(entry,'en')))return false;
    // The canonical Nidoran aliases already identify separate species numbers.
    if(entry.no===29&&/^Nidoran[- ]?F$/i.test(name)||entry.no===32&&/^Nidoran[- ]?M$/i.test(name))return false;
    // The lightweight anonymous shell has the admitted public sprite catalog,
    // not the full localized species catalog. Use its existing base-name rules
    // and keep all decorated/regional/size aliases on the manual side.
    const sprites=global.PogoDomain?.spriteSlugs;
    if(!names&&sprites?.publicSpriteDex(name)===entry.no){
      const decorated=/[()（）!?]|\s[-–·]\s|^(Alolan|Galarian|Hisuian|Paldean)\s/i.test(name);
      if(!decorated&&normalize(name)===normalize(sprites.publicSpriteBaseName(name)))return false;
    }
    return true; // Forms, costumes and unrecognized named identities stay explicit.
  }
  function manualEntryHtml(entry,t){
    const {escHtml}=global.PogoUtils.textSafety;
    const flags={shiny:'share.flagShiny',lucky:'share.flagLucky',xxl:'share.flagXxl',xxs:'share.flagXxs'};
    const qualifiers=[entry.mod,entry.variant,entry.gender,entry.maxType,entry.category==='wishlist'?'':entry.category||entry.type];
    for(const [flag,key]of Object.entries(flags))if(entry[flag])qualifiers.push(t(key));
    return`<li><strong>${escHtml(entry.dn||entry.name||t('contextSearch.unknown'))}</strong>${qualifiers.filter(Boolean).length?` · ${escHtml([...new Set(qualifiers.filter(Boolean))].join(' · '))}`:''}${entry.note?` · ${escHtml(entry.note)}`:''}${entry.unresolved?` <span class="contextual-unresolved">${escHtml(t('contextSearch.unresolved'))}</span>`:''}</li>`;
  }
  function renderManualChecks(details){
    const state=manualPanels.get(details),host=details.querySelector('.contextual-manual-review');
    if(!state||!host)return;
    const {escHtml}=global.PogoUtils.textSafety;
    host.innerHTML=`<ul>${state.entries.slice(0,state.limit).map(entry=>manualEntryHtml(entry,state.t)).join('')}</ul>${state.entries.length>state.limit?`<button type="button" class="btn btn-secondary" data-contextual-more-checks>${escHtml(state.t('common.showMore'))} · ${state.limit} / ${state.entries.length}</button>`:''}`;
  }
  function contextualSearchHtml(plan,{t,title,compact=false,copyLabel:scopedCopyLabel}={}){
    const {escHtml,escAttr}=global.PogoUtils.textSafety;
    const label=t('contextSearch.species');
    const checks=compact?plan.manual.filter(requiresManualCheck):[];
    const manual=compact?'':plan.manual.map(entry=>manualEntryHtml(entry,t)).join('');
    const detailsId=`contextual-details-${++panelSequence}`;
    // Attach review data to the mounted panel, not a hidden duplicate list or a
    // global strong-reference cache. Only an opened disclosure hydrates rows.
    if(compact&&checks.length&&global.document)global.queueMicrotask(()=>{
      const details=global.document.getElementById(detailsId);if(!details)return;
      manualPanels.set(details,{entries:checks,t,limit:50});
      if(details.open)renderManualChecks(details);
    });
    const exception=checks.length||plan.parts.length>1;
    const summary=checks.length?t(checks.length===1?'workflow.manualCheck':'workflow.manualChecks',{count:checks.length}):t(compact&&plan.parts.length>1?'workflow.splitSearch':'restored.searchDetails');
    const buttons=plan.parts.map((value,index)=>{
      const copyLabel=plan.parts.length===1?(scopedCopyLabel||t('restored.copySearch')):t('contextSearch.copyPart',{part:index+1,total:plan.parts.length});
      return `<button type="button" class="btn ${compact?'btn-secondary':'btn-primary'}" data-contextual-copy="${escAttr(value)}" data-copy-index="${index}" aria-label="${escAttr(copyLabel)}"><svg class="ui-icon ui-icon-sm" aria-hidden="true"><use href="#ui-icon-copy"></use></svg>${escHtml(compact&&plan.parts.length===1?t('restored.copySearch'):copyLabel)}</button>`;
    }).join('');
    return`<section class="contextual-search${compact?' wants-compact-search':''}" aria-label="${escAttr(title)}"><div class="contextual-copy-actions">${buttons||`<span class="type-meta">${escHtml(t(plan.total?'workflow.searchUnavailable':'contextSearch.empty'))}</span>`}</div><details id="${detailsId}" class="contextual-details wants-search-details" data-manual-check-count="${checks.length}"${compact&&!exception?' hidden':''}><summary>${escHtml(summary)}</summary><div class="contextual-search-body">${compact?`<p>${escHtml(t('contextSearch.warning'))}</p>`:''}${checks.length?'<div class="contextual-manual-review"></div>':''}${plan.parts.length>1?`<p>${escHtml(t('contextSearch.split',{count:plan.parts.length}))}</p>`:''}${plan.parts.map(value=>`<div class="contextual-search-part"><textarea class="strbox" readonly rows="1" aria-label="${escAttr(label)}">${escHtml(value)}</textarea></div>`).join('')}${manual?`<details class="contextual-manual"><summary>${escHtml(t('contextSearch.manual',{count:plan.total}))}</summary><p>${escHtml(t('contextSearch.warning'))}</p><ul>${manual}</ul></details>`:''}</div></details>${plan.unresolved?`<p class="contextual-unresolved" role="status">${escHtml(t('contextSearch.unresolvedCount',{count:plan.unresolved}))}</p>`:''}<span class="contextual-copy-status" role="status" aria-live="polite"></span></section>`;
  }
  if(global.document)global.document.addEventListener('click',async event=>{
    const more=event.target.closest?.('[data-contextual-more-checks]');
    if(more){const details=more.closest('.contextual-details'),state=manualPanels.get(details);if(state){state.limit+=50;renderManualChecks(details);(details.querySelector('[data-contextual-more-checks]')||details.querySelector('summary'))?.focus({preventScroll:true});}return;}
    const button=event.target.closest?.('[data-contextual-copy]');if(!button)return;
    const value=button.dataset.contextualCopy,panel=button.closest('.contextual-search');
    if(!value||value.length>POGO_STR_LIMIT||!panel)return;
    const status=panel.querySelector('.contextual-copy-status'),t=global.PogoI18n.core.t;
    try{await global.navigator.clipboard.writeText(value);if(status.isConnected)status.textContent=t('share.copySuccess');}
    catch{if(status.isConnected){const details=panel.querySelector('.contextual-details');details.hidden=false;details.open=true;status.textContent=t('strings.copyFailed');const field=panel.querySelectorAll('textarea')[Number(button.dataset.copyIndex)];field?.focus();field?.select();}}
  });
  if(global.document)global.document.addEventListener('toggle',event=>{
    const details=event.target;if(!details.matches?.('.contextual-details'))return;
    if(details.open)renderManualChecks(details);else details.querySelector('.contextual-manual-review')?.replaceChildren();
  },true);

  root.stringHtml = Object.freeze({
    strLenHtml,
    strWarnHtml,
    contextualSearchHtml
  });
})(window);
