(function(global){
  const root=global.PogoUi=global.PogoUi||{};

const EMPTY_SVGS={
  '📋':`<svg class="empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="8" width="36" height="48" rx="3"/><line x1="20" y1="20" x2="44" y2="20"/><line x1="20" y1="28" x2="44" y2="28"/><line x1="20" y1="36" x2="36" y2="36"/><circle cx="44" cy="44" r="7" stroke-dasharray="2 3"/></svg>`,
  '🔍':`<svg class="empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="28" r="14"/><line x1="38" y1="38" x2="50" y2="50"/></svg>`,
  '⚙️':`<svg class="empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="6"/><path d="M32 12v6M32 46v6M52 32h-6M18 32h-6M46 18l-4 4M22 42l-4 4M46 46l-4-4M22 22l-4-4"/></svg>`
};
function emptyHtml(t,s='',icon='🔍'){
  const svg=(typeof EMPTY_SVGS!=='undefined'&&EMPTY_SVGS[icon])||null;
  return`<div class="empty">${svg||`<div class="empty-i">${icon}</div>`}<div class="empty-t">${t}</div>${s?`<div class="empty-s">${s}</div>`:''}</div>`;
}

  root.emptyState=Object.freeze({
    EMPTY_SVGS,
    emptyHtml
  });
})(window);
