const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {installShareApplication}=require('./helpers/share-application.cjs');
test.use({serviceWorkers:'block'});
const output=process.env.SHARE_APPLICATION_OUTPUT;
async function capture(page,name){if(output){fs.mkdirSync(output,{recursive:true});await expect(page.locator('#toast')).toBeHidden({timeout:6000});await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});}}
const primary=page=>page.locator('#product-share-primary');

test('actual Share opens without writes, switches native choices, restores focus and keeps scopes honest',async({page})=>{
  await installShareApplication(page);
  const trigger=page.locator('.wants-list-toolbar button').first();await trigger.click();
  await expect(page.locator('[data-share-mode=link]')).toBeFocused();
  await page.keyboard.press('ArrowRight');await expect(page.locator('[data-share-mode=image]')).toBeFocused();
  await expect(page.locator('[data-share-mode=image]')).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End');await expect(page.locator('[data-share-mode=text]')).toBeFocused();
  await page.keyboard.press('Home');await expect(page.locator('[data-share-mode=link]')).toBeFocused();
  await primary(page).focus();await page.keyboard.press('Tab');await expect(page.locator('.share-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(primary(page)).toBeFocused();
  await expect(page.locator('#product-share-options')).toBeEmpty();
  await expect(page.locator('.share-public-list li')).toHaveCount(9);
  await expect(primary(page)).toHaveText('Copy link');
  await expect(page.locator('#product-share-modal')).not.toContainText(/PRIVATE_|Phone pages|publication|confirmed/i);
  await page.locator('[data-share-mode=text]').click();
  await page.locator('#share-scope-selected').check();
  await expect(primary(page)).toBeDisabled();
  await expect(page.locator('#product-share-count')).toHaveText('0 wants');
  await expect(page.locator('#product-share-preview')).toContainText('No wants');
  await page.locator('#share-scope-full').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#share-scope-top')).toBeChecked();await expect(page.locator('#share-scope-top')).toBeFocused();
  await primary(page).click();
  const preview=await page.locator('.share-text-preview').textContent();
  expect(await page.evaluate(()=>__shareTest.copies.at(-1))).toBe(preview);
  expect(preview).toContain('Exact form');expect(preview).toContain('Saturday after 3 pm\n');expect(preview).not.toContain('Snom');
  await page.locator('#share-text-markdown').check();
  await expect(page.locator('[name=share-scope]')).toHaveCount(0);
  await expect(page.locator('#product-share-count')).toHaveText('9 wants');
  await primary(page).click();expect(await page.evaluate(()=>__shareTest.copies.at(-1))).toBe(await page.locator('.share-text-preview').textContent());
  await page.locator('#share-text-csv').check();
  const csv=await page.locator('.share-text-preview').textContent();
  await page.evaluate(()=>{window.__download=null;downloadBlob=(blob,filename)=>{window.__download={blob,filename};};});
  await primary(page).click();expect(await page.evaluate(()=>__download.blob.text())).toBe(csv);
  await page.locator('[data-share-mode=image]').click();await page.locator('#share-image-classic').check();
  await expect(page.locator('[name=share-scope]')).toHaveCount(0);
  await expect(page.locator('#product-share-count')).toHaveText('7 wants');
  await expect(page.locator('.share-fixed-scope')).toContainText('Trades');
  await page.locator('[data-share-mode=link]').click();await expect(page.locator('.share-public-list li')).toHaveCount(9);
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(0);
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__shareTest.before));
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();expect(await page.locator('#app').evaluate(el=>el.inert)).toBe(false);
});

test('verified publication, clipboard-only recovery and a new operation use the real sharing handler',async({page})=>{
  await installShareApplication(page);await page.evaluate(()=>{__shareTest.clipboardFails=true;openProductShare();});
  await primary(page).click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopyFailed');
  await expect(page.locator('#share-public-url')).toHaveValue(/view=LocalTrainer/);
  await expect(page.locator('#share-public-url')).toBeFocused();
  expect(await page.evaluate(()=>[__shareTest.writes.length,__shareTest.reads.length,__shareTest.copies.length])).toEqual([1,1,1]);
  const published=await page.evaluate(()=>JSON.stringify(__shareTest.stored));expect(published).not.toContain('PRIVATE_');expect(published).toContain('Saturday after 3 pm');
  await capture(page,'link-copy-recovery-1440');
  await page.evaluate(()=>__shareTest.clipboardFails=false);await primary(page).click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopied');
  await expect(page.locator('#share-manual-link')).toBeHidden();
  expect(await page.evaluate(()=>[__shareTest.writes.length,__shareTest.copies.length])).toEqual([1,2]);
  await page.keyboard.press('Escape');await page.evaluate(()=>openProductShare());await primary(page).click();
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(2);
});

test('failed or unverified sharing never offers a URL; incomplete hydration never writes',async({page})=>{
  await installShareApplication(page);await page.evaluate(()=>{openProductShare();__shareTest.readbackMismatch=true;});await primary(page).click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.shareFailed');
  await expect(page.locator('#share-public-url')).toHaveValue('');expect(await page.evaluate(()=>__shareTest.copies)).toEqual([]);
  await page.evaluate(()=>{__shareTest.readbackMismatch=false;managedPublicSharePublication.markFailed(activePublicShareHydrationToken,'costumes');});
  await primary(page).click();await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notReady');
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(1);
});

test('first-share disclosure uses existing owner review; concurrent public edits and account switches cannot copy old results',async({page})=>{
  await installShareApplication(page);await page.evaluate(()=>{ownerPublicShareReview.status='missing_projection';openProductShare();});
  await expect(primary(page)).toHaveText('Share & copy link');await expect(page.locator('#product-share-disclosure')).toContainText('anyone with the link');
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(0);
  await page.evaluate(()=>{__shareTest.holdWrite=true;void copyShareLink();});
  await expect.poll(()=>page.evaluate(()=>!!__shareTest.resolveWrite)).toBe(true);
  await page.evaluate(()=>{allData.users[cur].bio='Changed during requested action';__shareTest.resolveWrite();});
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.changed');
  expect(await page.evaluate(()=>__shareTest.copies.length)).toBe(0);await expect(page.locator('#share-public-url')).toHaveValue('');
  await page.evaluate(()=>{__shareTest.resolveWrite=null;void copyShareLink();});
  await expect.poll(()=>page.evaluate(()=>!!__shareTest.resolveWrite)).toBe(true);
  await page.evaluate(()=>{cur='OtherSyntheticOwner';auth={currentUser:{uid:'other-synthetic-uid'}};__shareTest.resolveWrite();});
  await expect(page.locator('#product-share-modal')).toBeHidden();expect(await page.evaluate(()=>__shareTest.copies.length)).toBe(0);
});

test('double activation, closing/reopening, account changes and clipboard cancellation cannot finish stale UI',async({page})=>{
  await installShareApplication(page);await page.evaluate(()=>{__shareTest.holdWrite=true;openProductShare();void copyShareLink();void copyShareLink();});
  await expect.poll(()=>page.evaluate(()=>__shareTest.writes.length)).toBe(1);await expect(primary(page)).toBeDisabled();
  await page.keyboard.press('Escape');await page.evaluate(()=>{openProductShare();__shareTest.resolveWrite();});
  await expect(primary(page)).toHaveText('Copy link');await expect(page.locator('#share-link-status')).toBeEmpty();
  expect(await page.evaluate(()=>__shareTest.copies.length)).toBe(0);
  await page.evaluate(()=>{__shareTest.holdWrite=false;__shareTest.holdClipboard=true;void copyShareLink();});
  await expect.poll(()=>page.evaluate(()=>!!__shareTest.rejectClipboard)).toBe(true);
  await page.evaluate(()=>{resetSessionTransientUi('test-signout');auth.currentUser=null;cur=null;__shareTest.rejectClipboard(Error('denied after signout'));});
  await expect(page.locator('#product-share-modal')).toBeHidden();expect(await page.evaluate(()=>__shareTest.fallbacks)).toBe(0);
  await expect(page.locator('#share-public-url')).toHaveValue('');
});

test('ordinary edits refresh quietly, invalidate copy recovery, and changed pending saves cannot reuse it',async({page})=>{
  await installShareApplication(page);await page.evaluate(()=>{__shareTest.clipboardFails=true;openProductShare();});await primary(page).click();
  await expect(page.locator('#share-manual-link')).toBeVisible();
  await page.evaluate(()=>{allData.users[cur].bio='Updated public profile';renderMyList();});
  await expect(page.locator('#share-link-status')).toBeEmpty();await expect(page.locator('#share-manual-link')).toBeHidden();
  await expect(page.locator('.share-public-profile')).toContainText('Updated public profile');
  await primary(page).click();expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(2);
  await page.evaluate(()=>{managedAccountSyncRuntime={ownerUid:auth.currentUser.uid,snapshot:async()=>({pendingCount:1})};});
  await primary(page).click();await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notSaved');
  await expect(page.locator('#share-public-url')).toHaveValue('');expect(await page.evaluate(()=>[__shareTest.writes.length,__shareTest.copies.length])).toEqual([2,2]);
});

test('selection is real and board/classic/cards preview and delivery reuse the exact renderer blob',async({page})=>{
  test.setTimeout(90000);await installShareApplication(page);
  await page.locator('#wants-select-toggle').click();await page.locator('.wants-select').first().check();await page.locator('.wants-select').nth(1).check();
  await page.locator('#wants-selection-share').click();
  await expect(page.locator('#share-scope-selected')).toBeChecked();await expect(page.locator('#share-scope-selected+span+span')).toContainText('(2)');
  await expect(page.locator('#product-share-count')).toHaveText('2 wants');
  await page.evaluate(()=>{deliverImageBlob=async(blob,filename)=>{window.__delivered={blob,filename};return'downloaded';};});
  for(const style of ['board','classic','cards']){
    await page.locator('#share-image-'+style).check();
    await expect(page.locator('.share-image-preview')).toBeVisible({timeout:45000});await expect(primary(page)).toBeEnabled();
    await primary(page).click();
    expect(await page.evaluate(async()=>({same:__delivered.blob===productShareUi.blob,url:await (await fetch(document.querySelector('.share-image-preview').src)).arrayBuffer().then(b=>b.byteLength),bytes:__delivered.blob.size})) ).toMatchObject({same:true});
    expect(await page.evaluate(()=>__delivered.blob.size)).toBeGreaterThan(1000);
  }
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(0);
});

test('browser image downloads match the preview bytes and CSV matches its visible output',async({page})=>{
  test.setTimeout(90000);await installShareApplication(page);await page.evaluate(()=>openProductShare('image'));
  for(const style of ['board','classic','cards']){
    await page.locator('#share-image-'+style).check();
    if(style==='board')await page.locator('#share-scope-top').check();
    await expect(page.locator('.share-image-preview')).toBeVisible({timeout:45000});await expect(primary(page)).toBeEnabled();
    const digest=await page.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await (await fetch(document.querySelector('.share-image-preview').src)).arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''));
    const [download]=await Promise.all([page.waitForEvent('download'),primary(page).click()]);
    if(style==='board')expect(download.suggestedFilename()).toBe('pogo-localtrainer-top.png');
    else expect(download.suggestedFilename()).toMatch(style==='cards'?/^pogo-localtrainer-trades-darkcards-\d{4}-\d{2}-\d{2}\.png$/:/^pogo-localtrainer-trades-\d{4}-\d{2}-\d{2}\.png$/);
    expect(createHash('sha256').update(fs.readFileSync(await download.path())).digest('hex')).toBe(digest);
    if(style==='board')await expect(page.locator('#product-share-count')).toHaveText('4 wants');
  }
  await page.locator('[data-share-mode=text]').click();await page.locator('#share-text-csv').check();
  const csv=await page.locator('.share-text-preview').textContent();
  const [download]=await Promise.all([page.waitForEvent('download'),primary(page).click()]);
  expect(download.suggestedFilename()).toBe('pogo-localtrainer-wants.csv');expect(fs.readFileSync(await download.path(),'utf8')).toBe(csv);
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(0);
});

async function shareGeometry(page){return page.evaluate(()=>{
  const box=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const modal=document.querySelector('.product-share-modal'),body=document.querySelector('.share-body'),footer=document.querySelector('.share-footer');
  const collisions=[...modal.querySelectorAll('.choice-label,.share-footer-actions button')].flatMap(el=>{
    const bounds=box(el.matches('button')?el:el.closest('label')),range=document.createRange();range.selectNodeContents(el);
    return[...range.getClientRects()].filter(r=>r.width&&r.height&&(r.left<bounds.x-1||r.right>bounds.right+1||r.top<bounds.y-1||r.bottom>bounds.bottom+1)).map(r=>({text:el.textContent,bounds,textRight:r.right,textBottom:r.bottom}));
  });
  return{viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,rootFont:getComputedStyle(document.documentElement).fontSize,zoom:getComputedStyle(document.documentElement).zoom,modal:box(modal),body:box(body),footer:box(footer),scrollWidth:modal.scrollWidth,clientWidth:modal.clientWidth,bodyScrollWidth:body.scrollWidth,bodyClientWidth:body.clientWidth,bodyOverflow:getComputedStyle(body).overflowY,backgroundOverflow:getComputedStyle(document.body).overflowY,collisions,targets:[...modal.querySelectorAll('.share-choice,.share-footer-actions button')].map(box)};
});}

test('actual screens, localized mobile bounds, scroll ownership, 200% German footer and themes',async({page,browser})=>{
  test.setTimeout(180000);await installShareApplication(page);
  const measurements=[];
  for(const width of [1440,390,320])for(const locale of ['en','ja','es','de']){
    await page.setViewportSize({width,height:900});await page.evaluate(async locale=>{await changeInterfaceLocale(locale);openProductShare();},locale);
    for(const mode of ['link','image','text']){
      await page.locator('[data-share-mode='+mode+']').click();
      if(mode==='image')await expect(page.locator('.share-image-preview')).toBeVisible({timeout:45000});
      const measured=await shareGeometry(page);measurements.push({width,locale,mode,...measured});
      expect(measured.collisions).toEqual([]);expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth+1);
      expect(measured.bodyScrollWidth).toBeLessThanOrEqual(measured.bodyClientWidth+1);expect(measured.backgroundOverflow).toBe('hidden');
      expect(measured.footer.bottom).toBeLessThanOrEqual(900);expect(measured.targets.every(target=>target.height>=48)).toBe(true);
      if(locale==='en'&&[1440,390].includes(width))await capture(page,`${mode}-${width}`);
      if(width===320&&locale==='de'&&mode==='image')await capture(page,'image-de-320');
    }
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:390,height:900});
  await page.evaluate(()=>{document.documentElement.style.fontSize='32px';openProductShare('image');});
  await expect(page.locator('.share-image-preview')).toBeVisible({timeout:45000});
  const enlarged=await shareGeometry(page);measurements.push({case:'German 200% text, NOT native zoom',...enlarged});
  expect(enlarged.rootFont).toBe('32px');expect(enlarged.zoom).toBe('1');expect(enlarged.collisions).toEqual([]);
  expect(enlarged.scrollWidth).toBe(enlarged.clientWidth);expect(enlarged.bodyScrollWidth).toBe(enlarged.bodyClientWidth);
  const actions=await page.locator('.share-footer-actions button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
  expect(actions[0].x).toBe(actions[1].x);expect(actions[0].width).toBe(actions[1].width);expect(actions[0].y).toBeGreaterThan(actions[1].y);
  await page.locator('#product-share-body').evaluate(el=>el.scrollTop=el.scrollHeight);await capture(page,'footer-de-200-after');
  expect(await primary(page).isVisible()).toBe(true);
  expect(await page.locator('.share-image-preview').evaluate(el=>el.getBoundingClientRect().bottom<=document.getElementById('product-share-body').getBoundingClientRect().bottom)).toBe(true);
  await page.evaluate(async()=>{document.documentElement.style.fontSize='';await changeInterfaceLocale('en');});
  await page.setViewportSize({width:390,height:460});
  const short=await shareGeometry(page);measurements.push({case:'short viewport',...short});expect(short.footer.bottom).toBeLessThanOrEqual(460);expect(short.body.height).toBeGreaterThan(60);
  await page.locator('#product-share-body').evaluate(el=>el.scrollTop=el.scrollHeight);
  await capture(page,'image-short-390x460');
  await page.setViewportSize({width:1440,height:900});
  for(const theme of ['light','dark','system']){
    await page.emulateMedia({colorScheme:'light'});await page.evaluate(theme=>applyTheme(theme==='system'?'auto':theme),theme);
    await page.locator('[data-share-mode=text]').click();
    measurements.push({theme,modalBackground:await page.locator('.product-share-modal').evaluate(el=>getComputedStyle(el).backgroundColor)});
    if(theme!=='dark')await capture(page,'text-'+theme);
  }
  const lightSystem=await page.locator('.product-share-modal').evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.emulateMedia({colorScheme:'dark'});
  const darkSystem=await page.locator('.product-share-modal').evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(darkSystem).not.toBe(lightSystem);measurements.push({theme:'system-dark',modalBackground:darkSystem});
  await page.evaluate(()=>applyTheme('dark'));
  await page.locator('#share-scope-top').hover();await capture(page,'controls-pointer');
  await page.locator('#share-scope-top').click();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#share-scope-top')).toBeFocused();await capture(page,'controls-keyboard-selected');
  await page.locator('#share-scope-selected').check();await expect(primary(page)).toBeDisabled();await capture(page,'controls-empty-selection-disabled');
  if(output)fs.writeFileSync(path.join(output,'application-measurements.json'),JSON.stringify({browser:browser.version(),measurements},null,2));
});
