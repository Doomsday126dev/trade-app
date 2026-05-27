(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  const PRI=Object.freeze({
    H:Object.freeze({label:'High',emoji:'🔴'}),
    M:Object.freeze({label:'Medium',emoji:'🟡'}),
    L:Object.freeze({label:'Low',emoji:'🟢'})
  });
  const PRI_ORDER=Object.freeze({H:0,M:1,L:2});
  const LIST_LABELS=Object.freeze({
    wishlist:'Trades',
    dynamax:'Dynamax',
    gmax:'Gigantamax',
    costumes:'Others'
  });

  function priLabel(p){return PRI[p]?.label||p;}
  function priName(p){return `${p} - ${priLabel(p)}`;}
  function listLabel(type){return LIST_LABELS[type]||type;}

  root.priorities=Object.freeze({
    PRI,
    PRI_ORDER,
    LIST_LABELS,
    priLabel,
    priName,
    listLabel
  });
})(window);
