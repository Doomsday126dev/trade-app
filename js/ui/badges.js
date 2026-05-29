(function(global){
  const root = global.PogoUi = global.PogoUi || {};
  const priorities = global.PogoDomain && global.PogoDomain.priorities;
  if(!priorities)throw new Error('Priority helpers must load before badge HTML helpers');
  const {PRI,priLabel}=priorities;

  function priBadge(p){return `${PRI[p]?.emoji||''} ${priLabel(p)}`.trim();}
  function diffBadgeHtml(diff){
    if(diff.firstVisit)return'';
    const total=diff.added.length+diff.removed.length+diff.changed.length;
    if(!total)return'';
    const parts=[];
    if(diff.added.length)parts.push(`<span class="user-str-diff-badge added">+${diff.added.length}</span>`);
    if(diff.removed.length)parts.push(`<span class="user-str-diff-badge removed">−${diff.removed.length}</span>`);
    if(diff.changed.length)parts.push(`<span class="user-str-diff-badge">~${diff.changed.length}</span>`);
    return parts.join('');
  }

  root.badges = Object.freeze({
    priBadge,
    diffBadgeHtml
  });
})(window);
