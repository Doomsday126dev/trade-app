(function(global){
  const root=global.PogoUi=global.PogoUi||{};

const ICONS={
  list:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="8" width="36" height="48" rx="3"/><line x1="20" y1="20" x2="44" y2="20"/><line x1="20" y1="28" x2="44" y2="28"/><line x1="20" y1="36" x2="36" y2="36"/></svg>`,
  search:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="28" r="14"/><line x1="38" y1="38" x2="50" y2="50"/></svg>`,
  settings:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="6"/><path d="M32 12v6M32 46v6M52 32h-6M18 32h-6M46 18l-4 4M22 42l-4 4M46 46l-4-4M22 22l-4-4"/></svg>`,
  users:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="25" cy="24" r="8"/><path d="M10 50c1-10 7-15 15-15s14 5 15 15"/><circle cx="45" cy="26" r="6"/><path d="M40 38c8-2 14 3 15 11"/></svg>`,
  activity:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="22"/><path d="M32 19v14l9 6"/></svg>`,
  archive:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="16" width="40" height="36" rx="3"/><path d="M9 10h46v9H9zM25 29h14"/></svg>`,
  alert:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 10 56 52H8L32 10Z"/><path d="M32 24v14M32 45h.01"/></svg>`,
  offline:`<svg class="empty-svg state-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 24c12-11 32-11 44 0M17 33c8-7 22-7 30 0M25 42c4-3 10-3 14 0"/><path d="m13 11 38 42"/></svg>`
};
const EMPTY_SVGS=Object.freeze({...ICONS,'📋':ICONS.list,'🔍':ICONS.search,'⚙️':ICONS.settings});
function emptyHtml(t,s='',icon='search'){
  const svg=(typeof EMPTY_SVGS!=='undefined'&&EMPTY_SVGS[icon])||null;
  return`<div class="empty empty-state">${svg||`<div class="empty-i" aria-hidden="true">${icon}</div>`}<div class="empty-t empty-state-title">${t}</div>${s?`<div class="empty-s empty-state-detail">${s}</div>`:''}</div>`;
}

const STATE_CONFIG=Object.freeze({
  loading:{icon:'list',live:'polite',busy:true},
  offline:{icon:'offline',live:'polite'},retrying:{icon:'list',live:'polite',busy:true},
  unavailable:{icon:'alert',live:'polite'},permission_denied:{icon:'alert',live:'assertive'},
  signed_out:{icon:'alert',live:'assertive'},empty:{icon:'search',live:'polite'},
  stale:{icon:'alert',live:'polite'},update_required:{icon:'alert',live:'assertive'}
});
function stateModel(kind,{title='',detail='',actionLabel='',action='' }={}){
  const safeKind=Object.prototype.hasOwnProperty.call(STATE_CONFIG,kind)?kind:'unavailable';
  return Object.freeze({kind:safeKind,title:String(title),detail:String(detail),actionLabel:String(actionLabel),action:String(action),...STATE_CONFIG[safeKind]});
}
function stateHtml(model){
  const m=stateModel(model?.kind||'unavailable',model||{}),esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const action=m.actionLabel&&m.action?`<button type="button" class="ui-state-action btn btn-secondary" data-state-action="${esc(m.action)}">${esc(m.actionLabel)}</button>`:'';
  const visual=m.busy?'<div class="ui-state-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>':`<div class="ui-state-icon" aria-hidden="true">${EMPTY_SVGS[m.icon]||EMPTY_SVGS.alert}</div>`;
  return`<div class="ui-state card-status ui-state-${m.kind}" role="status" aria-live="${m.live}"${m.busy?' aria-busy="true"':''}>${visual}<div class="ui-state-copy"><div class="ui-state-title type-card">${esc(m.title)}</div>${m.detail?`<div class="ui-state-detail type-meta">${esc(m.detail)}</div>`:''}</div>${action}</div>`;
}

  root.emptyState=Object.freeze({
    EMPTY_SVGS,
    STATE_CONFIG,
    emptyHtml,
    stateModel,
    stateHtml
  });
})(window);
