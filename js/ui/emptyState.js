(function(global){
  const root=global.PogoUi=global.PogoUi||{};

const EMPTY_SVGS={
  '📋':`<svg class="empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="8" width="36" height="48" rx="3"/><line x1="20" y1="20" x2="44" y2="20"/><line x1="20" y1="28" x2="44" y2="28"/><line x1="20" y1="36" x2="36" y2="36"/><circle cx="44" cy="44" r="7" stroke-dasharray="2 3"/></svg>`,
  '🔍':`<svg class="empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="28" r="14"/><line x1="38" y1="38" x2="50" y2="50"/></svg>`,
  '⚙️':`<svg class="empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="6"/><path d="M32 12v6M32 46v6M52 32h-6M18 32h-6M46 18l-4 4M22 42l-4 4M46 46l-4-4M22 22l-4-4"/></svg>`
};
function emptyHtml(t,s='',icon='🔍'){
  const svg=(typeof EMPTY_SVGS!=='undefined'&&EMPTY_SVGS[icon])||null;
  return`<div class="empty empty-state">${svg||`<div class="empty-i" aria-hidden="true">${icon}</div>`}<div class="empty-t empty-state-title">${t}</div>${s?`<div class="empty-s empty-state-detail">${s}</div>`:''}</div>`;
}

const STATE_CONFIG=Object.freeze({
  loading:{icon:'📋',live:'polite',busy:true},
  offline:{icon:'⚠️',live:'polite'},retrying:{icon:'📋',live:'polite',busy:true},
  unavailable:{icon:'⚠️',live:'polite'},permission_denied:{icon:'⚠️',live:'assertive'},
  signed_out:{icon:'⚠️',live:'assertive'},empty:{icon:'🔍',live:'polite'},
  stale:{icon:'⚠️',live:'polite'},update_required:{icon:'⚠️',live:'assertive'}
});
function stateModel(kind,{title='',detail='',actionLabel='',action='' }={}){
  const safeKind=Object.prototype.hasOwnProperty.call(STATE_CONFIG,kind)?kind:'unavailable';
  return Object.freeze({kind:safeKind,title:String(title),detail:String(detail),actionLabel:String(actionLabel),action:String(action),...STATE_CONFIG[safeKind]});
}
function stateHtml(model){
  const m=stateModel(model?.kind||'unavailable',model||{}),esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const action=m.actionLabel&&m.action?`<button type="button" class="ui-state-action btn btn-secondary" data-state-action="${esc(m.action)}">${esc(m.actionLabel)}</button>`:'';
  return`<div class="ui-state card-status ui-state-${m.kind}" role="status" aria-live="${m.live}"${m.busy?' aria-busy="true"':''}><div class="ui-state-icon" aria-hidden="true">${m.icon}</div><div class="ui-state-copy"><div class="ui-state-title type-card">${esc(m.title)}</div>${m.detail?`<div class="ui-state-detail type-meta">${esc(m.detail)}</div>`:''}</div>${action}</div>`;
}

  root.emptyState=Object.freeze({
    EMPTY_SVGS,
    STATE_CONFIG,
    emptyHtml,
    stateModel,
    stateHtml
  });
})(window);
