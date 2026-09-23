const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installVisualFixture,HIGH_NAMES}=require('./helpers/visual-consistency.cjs');
const {installReviewFixture,showReviewSurface,installPublicReview}=require('./helpers/ui-review-fixture.cjs');
test.use({serviceWorkers:'block'});
const output=process.env.VISUAL_CONSISTENCY_OUTPUT_DIR;
const baseline=process.env.VISUAL_CONSISTENCY_BASELINE==='1';
async function capture(page,name){
  if(!output)return;
  fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,`${name}.png`),animations:'disabled'});
}
async function metrics(page){return page.evaluate(()=>{
  const box=element=>{if(!element)return null;const rect=element.getBoundingClientRect();return{left:rect.left,right:rect.right,width:rect.width};};
  const shell=document.querySelector('#tab-mylist');
  const grid=document.querySelector('[data-wants-section="H"] .mygrid');
  const surfaces={heading:box(shell?.querySelector('.my-hdr')),add:box(shell?.querySelector('.add-form')),toolbar:box(shell?.querySelector('.wants-list-toolbar')),section:box(shell?.querySelector('[data-wants-section="H"] .wants-section-header')),grid:box(grid)};
  return{viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,zoom:getComputedStyle(document.documentElement).zoom,rootFont:getComputedStyle(document.documentElement).fontSize,shell:box(shell),surfaces,contentWidth:surfaces.grid?.width,cardWidth:box(grid?.querySelector('.wants-row'))?.width,columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:null,pageOverflow:document.documentElement.scrollWidth>innerWidth};
});}
test('same fixture wide comparison and measured responsive columns',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await installVisualFixture(page);
  await capture(page,baseline?'my-list-before-1920':'my-list-after-1920');
  const measurements=[{capture:'wide-comparison',...await metrics(page)}];
  for(const width of [1920,1440,1120,1088,1087,1024,818,817,768,390,320]){
    await page.setViewportSize({width,height:900});
    const measured=await metrics(page);measurements.push(measured);
    expect(measured.pageOverflow).toBe(false);
    if(!baseline)expect(measured.columns).toBe(measured.contentWidth>=64*parseFloat(measured.rootFont)?3:measured.contentWidth>=48*parseFloat(measured.rootFont)?2:1);
    if(!baseline&&[1920,1440].includes(width)){
      expect(measured.shell.width).toBe(1120);
      expect(Math.abs((measured.shell.left+measured.shell.right)/2-width/2)).toBeLessThanOrEqual(1);
      expect(measured.contentWidth).toBe(1056);
      expect(measured.cardWidth).toBeGreaterThanOrEqual(340);
      expect(measured.cardWidth).toBeLessThanOrEqual(365);
      for(const surface of Object.values(measured.surfaces)){
        expect(surface).not.toBeNull();
        expect(Math.abs(surface.left-measured.surfaces.grid.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(surface.right-measured.surfaces.grid.right)).toBeLessThanOrEqual(1);
      }
    }
    expect(await page.locator('[data-wants-section="H"] .myrow-name').allTextContents()).toEqual(HIGH_NAMES);
    if([1440,1024,390,320].includes(width))await capture(page,`${baseline?'before':'after'}-my-list-${width}`);
  }
  if(output)fs.writeFileSync(path.join(output,`${baseline?'before':'after'}-measurements.json`),JSON.stringify(measurements,null,2));
});
test('compact cards wrap long localized labels beside selection and actions',async({page})=>{
  test.skip(baseline);await installVisualFixture(page);
  await page.evaluate(()=>startWantsSelection());
  const row=page.locator('#combined-list > [data-wants-section="H"] .wants-row').first();
  await row.locator('.wants-select').check();
  for(const width of [1440,1920])for(const label of [
    'Pikachu (Winterveranstaltung mit außergewöhnlicher Sonderform)',
    'ピカチュウ（特別な冬のイベントで登場する長い姿の名称）'
  ]){
    await page.setViewportSize({width,height:900});
    await row.locator('.wants-name').evaluate((node,value)=>{node.textContent=value;},label);
    const layout=await row.evaluate(node=>{
      const box=element=>{const rect=element.getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};};
      const name=node.querySelector('.wants-name'),range=document.createRange();range.selectNodeContents(name);
      return{row:box(node),sprite:box(node.querySelector('.myrow-sprite-wrap')),name:box(name),actions:box(node.querySelector('.mctrl')),
        targets:[...node.querySelectorAll('.myrow-edit,.myrow-remove')].map(box),
        textRects:[...range.getClientRects()].filter(rect=>rect.width&&rect.height).map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom})),
        whiteSpace:getComputedStyle(name).whiteSpace,overflow:getComputedStyle(name).overflow,fontSize:getComputedStyle(name).fontSize};
    });
    expect(layout.row.width).toBeGreaterThanOrEqual(340);
    expect(layout.row.width).toBeLessThanOrEqual(365);
    expect(layout.textRects.length).toBeGreaterThanOrEqual(2);
    expect(layout.whiteSpace).toBe('normal');expect(layout.overflow).toBe('visible');expect(layout.fontSize).toBe('14px');
    expect(layout.sprite.width).toBe(34);expect(layout.targets).toHaveLength(2);
    for(const target of layout.targets){expect(target.width).toBeGreaterThanOrEqual(40);expect(target.height).toBeGreaterThanOrEqual(44);}
    expect(layout.sprite.right).toBeLessThanOrEqual(layout.name.left+1);
    expect(layout.name.right).toBeLessThanOrEqual(layout.actions.left+1);
    expect(layout.actions.right).toBeLessThanOrEqual(layout.row.right+1);
    for(const rect of layout.textRects){
      expect(rect.left).toBeGreaterThanOrEqual(layout.name.left-1);
      expect(rect.right).toBeLessThanOrEqual(layout.name.right+1);
      expect(rect.top).toBeGreaterThanOrEqual(layout.name.top-1);
      expect(rect.bottom).toBeLessThanOrEqual(layout.name.bottom+1);
    }
  }
});
test('copy feedback occupies the same footprint in every locale and failures expose recovery',async({page})=>{
  test.setTimeout(90000);
  test.skip(baseline);await installVisualFixture(page);
  for(const width of [1440,390,320])for(const locale of ['en','ja','de','es']){
    await page.setViewportSize({width,height:900});
    await page.evaluate(async locale=>{await changeInterfaceLocale(locale);changePokemonGoSearchLocale('en');},locale);
    const section=page.locator('#combined-list > [data-wants-section="H"]'),button=section.locator('[data-contextual-copy]');
    const command=await button.getAttribute('data-contextual-copy');
    expect(command).toContain('!traded');expect(command).not.toContain('こうかん');
    if(width===390)await expect(page.locator('#toast')).toBeHidden({timeout:5000});
    const geometry=()=>section.evaluate(el=>{
      const box=node=>{const {x,y,width,height}=node.getBoundingClientRect();return{x,y,width,height};};
      return{header:box(el.querySelector('.wants-section-header')),button:box(el.querySelector('[data-contextual-copy]')),row:box(el.querySelector('.wants-row'))};
    });
    await button.scrollIntoViewIfNeeded();
    await section.locator('.wants-row').first().evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished));});
    const before=await geometry();
    if(width===390&&locale==='en')await capture(page,'copy-idle-390');
    await button.click();await expect(button).toHaveClass(/is-copied/);
    expect(await geometry()).toEqual(before);
    expect(await page.evaluate(()=>__visualCopied)).toBe(command);
    await expect(section.locator('[role="status"]')).not.toBeEmpty();
    if(width===390)await capture(page,`copy-success-${locale}-390`);
    expect((await metrics(page)).pageOverflow).toBe(false);
  }
  await expect(page.locator('[data-contextual-copy].is-copied')).toHaveCount(0);
  await page.evaluate(async()=>{await changeInterfaceLocale('en');navigator.clipboard.writeText=async()=>{throw Error('synthetic denied');};});
  await expect(page.locator('#toast')).toBeHidden({timeout:5000});
  const section=page.locator('#combined-list > [data-wants-section="H"]');
  await section.locator('[data-contextual-copy]').click();
  await expect(section.locator('[data-contextual-copy]')).not.toHaveClass(/is-copied/);
  await expect(section.locator('.contextual-copy-status')).toHaveClass(/is-error/);
  await expect(section.locator('.contextual-copy-status')).toBeInViewport();
  await expect(section.locator('textarea')).toBeFocused();
  expect(await section.locator('textarea').evaluate(el=>el.selectionEnd-el.selectionStart)).toBeGreaterThan(0);
  await capture(page,'copy-error-320');
});

test('long real catalog labels, selection, order, focus and zoom retain usable row geometry',async({page})=>{
  test.skip(baseline);await installVisualFixture(page);
  await page.evaluate(()=>{
    const costumes=[...listSource('costumes')].sort((a,b)=>b.name.length-a.name.length).slice(0,3);
    allData.costumes[cur]=Object.fromEntries(costumes.map(entry=>[entry.name,'H[shiny][lucky][xxl](F)']));
    renderMyList();startWantsSelection();
    window.__longNames=costumes.map(entry=>entry.name);
  });
  await page.locator('#combined-list .wants-select').first().check();
  await expect.poll(async()=>{
    const colors=await page.locator('#combined-list .wants-row').evaluateAll(rows=>rows.slice(0,2).map(row=>getComputedStyle(row).backgroundColor));
    return colors[0]===colors[1];
  }).toBe(false);
  const names=await page.locator('#combined-list .wants-row').evaluateAll(rows=>rows.map(row=>row.dataset.name));
  const assertRows=async()=>{
    expect(await page.locator('#combined-list .wants-row').evaluateAll(rows=>rows.map(row=>row.dataset.name))).toEqual(names);
    const collisions=await page.locator('#combined-list .wants-row').evaluateAll(rows=>rows.flatMap(row=>{
      const r=row.getBoundingClientRect(),sprite=row.querySelector('.myrow-sprite-wrap').getBoundingClientRect(),copy=row.querySelector('.myrow-copy').getBoundingClientRect(),actions=row.querySelector('.mctrl').getBoundingClientRect();
      return sprite.right>copy.left+1||copy.right>actions.left+1||actions.right>r.right+1||row.scrollWidth>row.clientWidth+1?[row.dataset.name]:[];
    }));
    expect(collisions).toEqual([]);expect((await metrics(page)).pageOverflow).toBe(false);
  };
  for(const width of [1920,1440,1366,1024,768,390,320]){
    await page.setViewportSize({width,height:900});await assertRows();
    await page.locator('#combined-list > [data-wants-section="H"] .wants-row').last().scrollIntoViewIfNeeded();
    await capture(page,`long-selected-${width}`);
  }
  await page.setViewportSize({width:1440,height:900});
  const row=page.locator('#combined-list .wants-row').first();
  await row.locator('.wants-name').focus();await page.keyboard.press('Tab');await expect(row.locator('.myrow-edit')).toBeFocused();
  await page.keyboard.press('Tab');await expect(row.locator('.myrow-remove')).toBeFocused();
  expect(await page.evaluate(()=>{
    const row=document.querySelector('#combined-list .wants-row'),focused=document.activeElement;
    renderMyList();return row===document.querySelector('#combined-list .wants-row')&&document.activeElement===focused;
  })).toBe(true);
  await page.setViewportSize({width:1920,height:1080});
  await page.evaluate(()=>{document.documentElement.style.zoom='2';scrollTo(0,0);});
  await assertRows();expect((await metrics(page)).columns).toBe(2);
  expect(await page.evaluate(()=>document.querySelector('.logo').getBoundingClientRect().right<=document.querySelector('.topbar-r').getBoundingClientRect().left)).toBe(true);
  await page.locator('#combined-list > [data-wants-section="H"]').evaluate(el=>scrollTo(0,el.offsetTop-140));
  await capture(page,'my-list-engine-zoom-200');
  await page.evaluate(()=>{
    document.documentElement.style.zoom='1';
    const sizes=[...document.querySelectorAll('html,body,button,input,select,textarea,span,label,p,h1,h2,h3')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)*2]);
    sizes.forEach(([el,size])=>el.style.fontSize=size+'px');
    scrollTo(0,0);
  });
  await assertRows();expect((await metrics(page)).columns).toBe(1);
  await capture(page,'my-list-text-enlargement-200');
});

test('Settings scroll ownership, localized controls, drafts and focus survive every section',async({page})=>{
  test.skip(baseline);await installVisualFixture(page);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:844});
    await page.locator('#account-trigger').focus();
    await page.evaluate(()=>{scrollTo(0,400);openSettingsPanel('account',{returnFocus:document.getElementById('account-trigger')});});
    const initialScroll=await page.evaluate(()=>scrollY);
    for(const section of ['profile','language','appearance','security','tools','data']){
      await page.evaluate(section=>selectSettingsSection(section),section);
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
      expect(await page.evaluate(()=>getComputedStyle(document.body).overflowY)).toBe('hidden');
      await page.locator('#settings-detail').hover();await page.mouse.wheel(0,1800);
      expect(await page.evaluate(()=>scrollY)).toBe(initialScroll);
      expect(await page.locator('.settings-modal-header').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
      expect(await page.locator('#settings-modal').evaluate(el=>el.scrollTop)).toBe(0);
      await capture(page,`settings-${section}-${width}`);
      expect((await metrics(page)).pageOverflow).toBe(false);
    }
    await page.evaluate(()=>selectSettingsSection('profile'));
    await page.locator('#prof-bio').fill('Preserved visual draft');
    for(const locale of ['ja','de','es']){
      await page.evaluate(async locale=>changeInterfaceLocale(locale),locale);
      const close=page.locator('.settings-modal-close');
      expect(await close.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      if(width===1440)expect(await close.evaluate(el=>el.querySelector('span').getBoundingClientRect().height)).toBeLessThan(25);
      await expect(page.locator('#toast')).toBeHidden({timeout:5000});
      await page.locator('#profile-save').scrollIntoViewIfNeeded();await expect(page.locator('#profile-save')).toBeInViewport();
      await capture(page,`settings-save-${locale}-${width}`);
    }
    await page.locator('.settings-modal-close').focus();await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(()=>document.getElementById('settings-modal').contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    if(width<768){await expect(page.locator('#settings-modal')).toBeVisible();await page.keyboard.press('Escape');}
    await expect(page.locator('#settings-modal')).toBeHidden();await expect(page.locator('#account-trigger')).toBeFocused();
    await page.evaluate(async()=>{await changeInterfaceLocale('en');openAccountSettingsSection('profile');});
    await expect(page.locator('#prof-bio')).toHaveValue('Preserved visual draft');
    await page.locator('#profile-discard').click();await page.locator('.settings-modal-close').click();
  }
});

test('Legal and actual Privacy retain readable themes, focus and public-only loading',async({page})=>{
  test.skip(baseline);await installVisualFixture(page);
  for(const theme of ['dark','light'])for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:700});
    await page.evaluate(theme=>{applyTheme(theme);openLegalAcknowledgements(document.getElementById('account-trigger'));},theme);
    const dialog=page.locator('#legal-dialog');await expect(dialog).toBeVisible();
    await expect(page.locator('#legal-dialog-title')).toBeFocused();
    const box=await dialog.boundingBox();expect(Math.abs(box.x+(box.width/2)-width/2)).toBeLessThan(1);
    for(let i=0;i<4;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
    await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeInViewport();
    await capture(page,`legal-${theme}-${width}`);
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.locator('#account-trigger')).toBeFocused();
  }
  const requests=[];page.on('request',request=>requests.push(request.url()));
  await page.goto('./?legal=privacy');
  expect(requests.some(url=>/firebase|application\.js|accountSync/.test(url))).toBe(false);
  await expect(page.locator('#privacy-pg')).toBeVisible();
  await expect(page.locator('#privacy-pg')).toContainText('Last updated August 31, 2026');
  for(const theme of ['dark','light'])for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect((await metrics(page)).pageOverflow).toBe(false);await capture(page,`privacy-${theme}-${width}`);
    await page.locator('#privacy-pg section').last().scrollIntoViewIfNeeded();await capture(page,`privacy-final-${theme}-${width}`);
    await page.evaluate(()=>scrollTo(0,0));
  }
});

test('bounded retained-surface sweep uses populated and anonymous runtime fixtures',async({page})=>{
  test.skip(baseline);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await installReviewFixture(page);
    for(const surface of ['my-list','trainers','favorites','group','who-wants','share','editor']){
      await showReviewSurface(page,surface);
      expect((await metrics(page)).pageOverflow).toBe(false);await capture(page,`sweep-${surface}-${width}`);
      if(surface==='favorites'){
        await page.locator('.favorite-card-more').first().click();
        await expect(page.locator('.favorite-card-menu').first()).toBeVisible();
        await capture(page,`sweep-favorites-menu-${width}`);
      }
      if(surface==='share'){
        await page.locator('[data-share-mode="text"]').click();
        await capture(page,`sweep-export-text-${width}`);
      }
    }
  }
  await showReviewSurface(page,'my-list');
  await page.locator('#wants-add-name').fill('Pikachu');
  await capture(page,'sweep-add-search-320');
  await page.evaluate(()=>{document.getElementById('wants-add-name').value='';setWantsFindOpen(true);});
  await page.locator('#combined-filter').fill('No matching synthetic Pokemon');
  await capture(page,'sweep-my-list-empty-320');
  await showReviewSurface(page,'favorites');
  await page.evaluate(async()=>{ensureTrainerHistoryStore().replaceSyncedOrganization({favorites:[],tags:{}});await renderTrainerQuickLists();});
  await capture(page,'sweep-favorites-empty-320');
  await installPublicReview(page);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    expect((await metrics(page)).pageOverflow).toBe(false);
    await capture(page,`sweep-anonymous-${width}`);
  }
});
test('Settings and public reading surface captures',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await installVisualFixture(page);
  await page.evaluate(()=>openAccountSettingsSection('profile'));
  await capture(page,`${baseline?'before':'after'}-settings-desktop`);
  if(!baseline){
    expect(await page.locator('.settings-modal-close').evaluate(el=>getComputedStyle(el).flexBasis)).toBe('auto');
    await page.locator('#prof-bio').fill('An unsaved synthetic draft');
    await page.locator('#profile-save').scrollIntoViewIfNeeded();
    await expect(page.locator('#profile-save')).toBeInViewport();
    await capture(page,'settings-desktop-save');
  }
  await page.locator('.settings-modal-close').click();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>openAccountSettingsSection('profile'));
  await capture(page,`${baseline?'before':'after'}-settings-mobile`);
  await page.locator('#profile-save').scrollIntoViewIfNeeded();
  await capture(page,`${baseline?'before':'after'}-settings-mobile-save`);
  await page.locator('.settings-modal-close').click();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>openLegalAcknowledgements(document.getElementById('account-trigger')));
    await expect(page.locator('#legal-dialog')).toBeVisible();
    await capture(page,`${baseline?'before':'after'}-legal-${width}`);
    await page.keyboard.press('Escape');
  }
  await page.goto('./?legal=privacy');
  await expect(page.locator('.privacy-page')).toBeVisible();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await capture(page,`${baseline?'before':'after'}-privacy-${width}`);
  }
});
