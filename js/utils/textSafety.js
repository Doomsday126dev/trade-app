(function(global){
  const root=global.PogoUtils=global.PogoUtils||{};

  function safeFilePart(s){
    return String(s||'list').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'list';
  }

  function escHtml(s){
    return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function escAttr(s){return escHtml(s);}

  root.textSafety=Object.freeze({safeFilePart,escHtml,escAttr});
})(window);
