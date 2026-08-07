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
    'share.copy':'Copy','share.luckyDex':'Lucky Dex','share.combinedOptions':'Combined options',
    'share.combinedAvailable':'{count} available','share.allPriorities':'All priorities',
    'share.priorityCombination':'{first} + {second}','share.copySearchAria':'Copy {label} search string'
  }[key]||key).replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(params,key)?params[key]:match);
  const formatNumber=typeof options.formatNumber==='function'?options.formatNumber:value=>value;
  const priorityLabel=typeof options.priorityLabel==='function'?options.priorityLabel:priLabel;
  const panelOptions=localized?{t,formatNumber}:{};
  const copyScope=localized?' data-copy-scope="share"':'';
  const copyButton=(value,label)=>`<button class="cpbtn" type="button" data-copy="${escAttr(value)}"${copyScope} onclick="copyStr(this.dataset.copy,this)" aria-label="${escAttr(t('share.copySearchAria',{label}))}" style="margin-left:auto">📋 ${escHtml(t('share.copy'))}</button>`;
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
      <div class="strbox">${escHtml(strs[p])}</div>
      ${strWarnHtml(strs[p],panelOptions)}
    </div>`).join('')}${strs.LUCKY?`<div class="str-level lucky-str">
      <div class="str-level-hdr">
        <span class="combo-badge">⚡ ${escHtml(t('share.luckyDex'))}</span>${strLenHtml(strs.LUCKY,panelOptions)}
        ${copyButton(strs.LUCKY,t('share.luckyDex'))}
      </div>
      <div class="strbox">${escHtml(strs.LUCKY)}</div>
      ${strWarnHtml(strs.LUCKY,panelOptions)}
    </div>`:''}${strs.XXL?`<div class="str-level xxl-str">
      <div class="str-level-hdr">
        <span class="combo-badge">XXL</span>${strLenHtml(strs.XXL,panelOptions)}
        ${copyButton(strs.XXL,'XXL')}
      </div>
      <div class="strbox">${escHtml(strs.XXL)}</div>
      ${strWarnHtml(strs.XXL,panelOptions)}
    </div>`:''}${strs.XXS?`<div class="str-level xxs-str">
      <div class="str-level-hdr">
        <span class="combo-badge">XXS</span>${strLenHtml(strs.XXS,panelOptions)}
        ${copyButton(strs.XXS,'XXS')}
      </div>
      <div class="strbox">${escHtml(strs.XXS)}</div>
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
          <div class="strbox">${escHtml(o.value)}</div>
          ${strWarnHtml(o.value,panelOptions)}
        </div>`).join('')}</div>
    </div>`:''}</div>`;
}

  root.stringPanels = Object.freeze({
    strLevelsHtml
  });
})(window);
