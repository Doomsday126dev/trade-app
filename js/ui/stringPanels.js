(function(global){
  const root = global.PogoUi = global.PogoUi || {};
  const searchStrings = global.PogoDomain && global.PogoDomain.searchStrings;
  if(!searchStrings)throw new Error('Search string helpers must load before string panel helpers');
  const priorities = global.PogoDomain && global.PogoDomain.priorities;
  if(!priorities)throw new Error('Priority helpers must load before string panel helpers');
  const badges = global.PogoUi && global.PogoUi.badges;
  if(!badges)throw new Error('Badge HTML helpers must load before string panel helpers');
  const stringHtml = global.PogoUi && global.PogoUi.stringHtml;
  if(!stringHtml)throw new Error('String HTML helpers must load before string panel helpers');
  const textSafety = global.PogoUtils && global.PogoUtils.textSafety;
  if(!textSafety)throw new Error('Text safety helpers must load before string panel helpers');
  const {combinedStringOptions}=searchStrings;
  const {priLabel}=priorities;
  const {priBadge}=badges;
  const {strLenHtml,strWarnHtml}=stringHtml;
  const {escHtml,escAttr}=textSafety;

function strLevelsHtml(strs,options={}){
  const combos=combinedStringOptions(strs,{locale:options.searchLocale||'en'});
  const localized=typeof options.t==='function';
  const t=localized?options.t:(key,params={})=>({
    'share.copy':'Copy','share.viewSearch':'View search','share.hideSearch':'Hide search','share.luckyDex':'Lucky Dex','share.combinedOptions':'Combined options',
    'share.combinedAvailable':'{count} available','share.allPriorities':'All priorities',
    'share.priorityCombination':'{first} + {second}','share.copySearchAria':'Copy {label} search string'
  }[key]||key).replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(params,key)?params[key]:match);
  const formatNumber=typeof options.formatNumber==='function'?options.formatNumber:value=>value;
  const priorityLabel=typeof options.priorityLabel==='function'?options.priorityLabel:priLabel;
  const panelOptions=localized?{t,formatNumber}:{};
  const copyScope=localized?' data-copy-scope="share"':'';
  const copyButton=(value,label)=>`<button class="cpbtn" type="button" data-copy="${escAttr(value)}"${copyScope} onclick="copyStr(this.dataset.copy,this)" aria-label="${escAttr(t('share.copySearchAria',{label}))}" style="margin-left:auto"><svg class="ui-icon ui-icon-sm" aria-hidden="true"><use href="#ui-icon-copy"></use></svg><span>${escHtml(t('share.copy'))}</span></button>`;
  const searchDisclosure=(value,label)=>`<details class="share-search-disclosure"><summary><span class="share-search-view-label">${escHtml(t('share.viewSearch'))}</span><span class="share-search-hide-label">${escHtml(t('share.hideSearch'))}</span><span class="collapse-icon" aria-hidden="true">▼</span><span class="sr-only">: ${escHtml(label)}</span></summary><div class="strbox">${escHtml(value)}</div></details>`;
  const priorityBadge=p=>localized?`${p==='H'?'🔴':p==='M'?'🟡':'🟢'} ${escHtml(priorityLabel(p))}`:priBadge(p);
  const comboLabel=option=>option.levels.length===3
    ?t('share.allPriorities')
    :t('share.priorityCombination',{first:priorityLabel(option.levels[0]),second:priorityLabel(option.levels[1])});
  return`<div class="str-levels">${['H','M','L'].filter(p=>strs[p]).map(p=>`
    <div class="str-level">
      <div class="str-level-hdr">
        <span class="badge ${p}"><span class="prio-mark">${p}</span>${priorityBadge(p)}</span>${strLenHtml(strs[p],panelOptions)}
        ${copyButton(strs[p],localized?priorityLabel(p):`${priorityLabel(p)} priority`)}
      </div>
      ${searchDisclosure(strs[p],localized?priorityLabel(p):`${priorityLabel(p)} priority`)}
      ${strWarnHtml(strs[p],panelOptions)}
    </div>`).join('')}${strs.LUCKY?`<div class="str-level lucky-str">
      <div class="str-level-hdr">
        <span class="combo-badge">⚡ ${escHtml(t('share.luckyDex'))}</span>${strLenHtml(strs.LUCKY,panelOptions)}
        ${copyButton(strs.LUCKY,t('share.luckyDex'))}
      </div>
      ${searchDisclosure(strs.LUCKY,t('share.luckyDex'))}
      ${strWarnHtml(strs.LUCKY,panelOptions)}
    </div>`:''}${strs.XXL?`<div class="str-level xxl-str">
      <div class="str-level-hdr">
        <span class="combo-badge">XXL</span>${strLenHtml(strs.XXL,panelOptions)}
        ${copyButton(strs.XXL,'XXL')}
      </div>
      ${searchDisclosure(strs.XXL,'XXL')}
      ${strWarnHtml(strs.XXL,panelOptions)}
    </div>`:''}${strs.XXS?`<div class="str-level xxs-str">
      <div class="str-level-hdr">
        <span class="combo-badge">XXS</span>${strLenHtml(strs.XXS,panelOptions)}
        ${copyButton(strs.XXS,'XXS')}
      </div>
      ${searchDisclosure(strs.XXS,'XXS')}
      ${strWarnHtml(strs.XXS,panelOptions)}
    </div>`:''}${combos.length?`<div class="combo-wrap">
      <button class="combo-toggle" type="button" onclick="toggleComboStrings(this)" aria-expanded="false">
        <span>${escHtml(t('share.combinedOptions'))} <span class="combo-meta">${escHtml(t('share.combinedAvailable',{count:formatNumber(combos.length)}))}</span></span>
        <span class="collapse-icon">▼</span>
      </button>
      <div class="combo-body">${combos.map(o=>`
        <div class="str-level">
          <div class="str-level-hdr">
            <span class="combo-badge">${escHtml(localized?comboLabel(o):o.label)}</span>${strLenHtml(o.value,panelOptions)}
            ${copyButton(o.value,localized?comboLabel(o):o.label)}
          </div>
          ${searchDisclosure(o.value,localized?comboLabel(o):o.label)}
          ${strWarnHtml(o.value,panelOptions)}
        </div>`).join('')}</div>
    </div>`:''}</div>`;
}

  root.stringPanels = Object.freeze({
    strLevelsHtml
  });
})(window);
