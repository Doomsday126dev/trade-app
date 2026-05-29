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

function strLevelsHtml(strs){
  const combos=combinedStringOptions(strs);
  return`<div class="str-levels">${['H','M','L'].filter(p=>strs[p]).map(p=>`
    <div class="str-level">
      <div class="str-level-hdr">
        <span class="badge ${p}"><span class="prio-mark">${p}</span>${priBadge(p)}</span>${strLenHtml(strs[p])}
        <button class="cpbtn" type="button" data-copy="${escAttr(strs[p])}" onclick="copyStr(this.dataset.copy,this)" aria-label="Copy ${priLabel(p)} priority search string" style="margin-left:auto">📋 Copy</button>
      </div>
      <div class="strbox">${escHtml(strs[p])}</div>
      ${strWarnHtml(strs[p])}
    </div>`).join('')}${strs.LUCKY?`<div class="str-level lucky-str">
      <div class="str-level-hdr">
        <span class="combo-badge">⚡ Lucky Dex</span>${strLenHtml(strs.LUCKY)}
        <button class="cpbtn" type="button" data-copy="${escAttr(strs.LUCKY)}" onclick="copyStr(this.dataset.copy,this)" aria-label="Copy Lucky Dex search string" style="margin-left:auto">📋 Copy</button>
      </div>
      <div class="strbox">${escHtml(strs.LUCKY)}</div>
      ${strWarnHtml(strs.LUCKY)}
    </div>`:''}${strs.XXL?`<div class="str-level xxl-str">
      <div class="str-level-hdr">
        <span class="combo-badge">XXL</span>${strLenHtml(strs.XXL)}
        <button class="cpbtn" type="button" data-copy="${escAttr(strs.XXL)}" onclick="copyStr(this.dataset.copy,this)" aria-label="Copy XXL search string" style="margin-left:auto">📋 Copy</button>
      </div>
      <div class="strbox">${escHtml(strs.XXL)}</div>
      ${strWarnHtml(strs.XXL)}
    </div>`:''}${strs.XXS?`<div class="str-level xxs-str">
      <div class="str-level-hdr">
        <span class="combo-badge">XXS</span>${strLenHtml(strs.XXS)}
        <button class="cpbtn" type="button" data-copy="${escAttr(strs.XXS)}" onclick="copyStr(this.dataset.copy,this)" aria-label="Copy XXS search string" style="margin-left:auto">📋 Copy</button>
      </div>
      <div class="strbox">${escHtml(strs.XXS)}</div>
      ${strWarnHtml(strs.XXS)}
    </div>`:''}${combos.length?`<div class="combo-wrap">
      <button class="combo-toggle" type="button" onclick="toggleComboStrings(this)" aria-expanded="false">
        <span>Combined options <span class="combo-meta">${combos.length} available</span></span>
        <span class="collapse-icon">▼</span>
      </button>
      <div class="combo-body">${combos.map(o=>`
        <div class="str-level">
          <div class="str-level-hdr">
            <span class="combo-badge">${escHtml(o.label)}</span>${strLenHtml(o.value)}
            <button class="cpbtn" type="button" data-copy="${escAttr(o.value)}" onclick="copyStr(this.dataset.copy,this)" aria-label="Copy ${escAttr(o.label)} search string" style="margin-left:auto">📋 Copy</button>
          </div>
          <div class="strbox">${escHtml(o.value)}</div>
          ${strWarnHtml(o.value)}
        </div>`).join('')}</div>
    </div>`:''}</div>`;
}

  root.stringPanels = Object.freeze({
    strLevelsHtml
  });
})(window);
