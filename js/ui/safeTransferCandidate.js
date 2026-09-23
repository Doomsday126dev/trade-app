(function(global){
  const root=global.PogoUi=global.PogoUi||{};

  function mountSafeTransferCandidate(container,{controller,t=(key,vars={})=>{
    const fallback={
      scope:'Selected scope: {trainers}',loading:'Checking complete shared wants…',blocked:'A complete scoped snapshot is required before a search can be created.',
      ready:'{candidates} candidate species after protecting {protected} wanted species.',empty:'No candidate species remain in this scoped snapshot.',
      copy:'Copy part {part} of {total}',copied:'Copied.',copyFailed:'Copy failed. The current command is preserved below for manual copy.'
    }[key]||key;
    return fallback.replace(/\{(\w+)\}/g,(_,name)=>String(vars[name]??''));
  }}={}){
    if(!container||!controller?.subscribe||!controller?.copyPart)throw new TypeError('Safe-transfer candidate UI requires a container and controller');
    container.innerHTML='<p class="stb-summary" data-safe-transfer-scope></p><p class="stb-summary" data-safe-transfer-status role="status" aria-live="polite"></p><div data-safe-transfer-commands></div>';
    const scope=container.querySelector('[data-safe-transfer-scope]'),status=container.querySelector('[data-safe-transfer-status]'),commands=container.querySelector('[data-safe-transfer-commands]');
    function render(state){
      container.dataset.phase=state.phase;
      const selected=state.plan?.scope?.selected||state.request?.selection||[];
      scope.textContent=t('scope',{trainers:selected.map(item=>item.label).join(', ')});
      commands.replaceChildren();
      if(state.phase==='loading'){status.textContent=t('loading');return;}
      if(state.phase==='blocked'||state.phase==='invalidated'){status.textContent=t(state.plan?.status==='empty_candidates'?'empty':'blocked');return;}
      if(!state.plan){status.textContent='';return;}
      status.textContent=state.phase==='copy_failed'?t('copyFailed'):state.phase==='copied'?t('copied'):t('ready',{candidates:state.plan.candidateSpecies.length,protected:state.plan.protectedSpecies.length});
      state.plan.commands.forEach((command,index)=>{
        const section=container.ownerDocument.createElement('section'),field=container.ownerDocument.createElement('textarea'),button=container.ownerDocument.createElement('button');
        const manualRecovery=state.phase==='copy_failed'&&index===(state.copiedPart??0);
        section.className='stb-command-part';
        field.className='stb-output';field.readOnly=true;field.disabled=!manualRecovery;field.value=manualRecovery?state.manualCommand:command.value;field.dataset.safeTransferCommand=String(index);
        button.className='stb-action-btn';button.type='button';button.textContent=t('copy',{part:index+1,total:state.plan.commands.length});button.dataset.safeTransferCopy=String(index);button.disabled=state.phase==='copying';
        section.append(field,button);commands.append(section);
      });
      if(state.phase==='copy_failed')commands.querySelector(`[data-safe-transfer-command="${state.copiedPart??0}"]`)?.select();
    }
    const onClick=event=>{const button=event.target.closest?.('[data-safe-transfer-copy]');if(button)void controller.copyPart(Number(button.dataset.safeTransferCopy));};
    container.addEventListener('click',onClick);
    const unsubscribe=controller.subscribe(render);
    return Object.freeze({render,destroy(){unsubscribe();container.removeEventListener('click',onClick);container.replaceChildren();}});
  }

  root.safeTransferCandidate=Object.freeze({mountSafeTransferCandidate});
})(window);
