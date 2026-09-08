const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {installReviewFixture,showReviewSurface,settleReview,installPublicReview}=require('./helpers/ui-review-fixture.cjs');

const output=process.env.UI_REVIEW_DIR;
const phase=process.env.UI_REVIEW_PHASE||'after';
test.use({serviceWorkers:'block',trace:'off'});
test('whole-app matched visual evidence',async({browser})=>{
  test.skip(!output,'Explicit before/after review capture only.');
  test.setTimeout(300000);
  fs.mkdirSync(path.join(output,phase),{recursive:true});
  const records=[];
  for(const width of [1440,390,320]){
    const context=await browser.newContext({viewport:{width,height:width===1440?900:width===390?844:740},serviceWorkers:'block',locale:'en-US',colorScheme:'dark'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await installReviewFixture(page);
    for(const surface of ['my-list','advanced','trainers','favorites','group','who-wants','events','more','settings','settings-language','share','editor','admin']){
      await showReviewSurface(page,surface);await settleReview(page);
      const file=`${surface}-${width}-dark.png`;
      await page.screenshot({path:path.join(output,phase,file),animations:'disabled'});
      const audit=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        controls:[...document.querySelectorAll('select')].filter(node=>node.getClientRects().length).map(node=>({id:node.id,label:node.getAttribute('aria-label'),
          appearance:getComputedStyle(node).appearance,background:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage,
          height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width})),
        visibleBrokenImages:[...document.images].filter(image=>{const r=image.getBoundingClientRect();return r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&!image.naturalWidth;}).map(image=>image.alt)}));
      records.push({surface,width,theme:'dark',file,...audit});
    }
    await page.close();
    const publicPage=await context.newPage();await installPublicReview(publicPage);await settleReview(publicPage);
    const file=`public-share-${width}-dark.png`;await publicPage.screenshot({path:path.join(output,phase,file),animations:'disabled'});
    records.push({surface:'public-share',width,theme:'dark',file});
    expect(errors).toEqual([]);
    await context.close();
  }
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:width===1440?900:844},serviceWorkers:'block',locale:'en-US',colorScheme:'light'});
    const page=await context.newPage();await installReviewFixture(page,{theme:'light'});
    for(const surface of ['my-list','favorites','who-wants','settings-language']){
      await showReviewSurface(page,surface);await settleReview(page);
      const file=`${surface}-${width}-light.png`;
      await page.screenshot({path:path.join(output,phase,file),animations:'disabled'});records.push({surface,width,theme:'light',file});
    }
    const publicPage=await context.newPage();await installPublicReview(publicPage,{theme:'light'});await settleReview(publicPage);
    const file=`public-share-${width}-light.png`;await publicPage.screenshot({path:path.join(output,phase,file),animations:'disabled'});records.push({surface:'public-share',width,theme:'light',file});
    await context.close();
  }
  fs.writeFileSync(path.join(output,phase,'capture.json'),JSON.stringify({phase,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),capturedAt:new Date().toISOString(),synthetic:true,records},null,2));
});

for(const engine of ['chromium','webkit']){
  test(`${engine}: controls, navigation and disclosures across desktop and narrow mobile`,async()=>{
    test.skip(Boolean(output)||test.info().project.name!=='desktop','Keep evidence capture and engine coverage separate.');
    test.setTimeout(180000);
    const browser=await require('@playwright/test')[engine].launch();
    try{
      for(const width of [1440,390,320]){
        const context=await browser.newContext({baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174',viewport:{width,height:900},serviceWorkers:'block'});
        const page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await installReviewFixture(page);
        for(const theme of ['dark','light']){
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
          for(const surface of ['my-list','favorites','group','who-wants','events','more','settings-language','share','editor','admin']){
            await showReviewSurface(page,surface);
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            const controls=await page.evaluate(()=>[...document.querySelectorAll('select')].filter(node=>node.getClientRects().length).map(node=>{
              const style=getComputedStyle(node),box=node.getBoundingClientRect();
              return {id:node.id,appearance:style.appearance,image:style.backgroundImage,colorScheme:style.colorScheme,width:box.width,right:box.right,height:box.height};
            }));
            for(const control of controls){
              expect(control.appearance,control.id).toBe('none');
              expect(control.image,control.id).toContain('data:image/svg+xml');
              expect(control.colorScheme,control.id).toBe(theme);
              expect(control.height,control.id).toBe(48);
              expect(control.right,control.id).toBeLessThanOrEqual(width);
              if(control.id==='trainer-group-scope')expect(control.width,control.id).toBeGreaterThanOrEqual(220);
            }
            expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
          }
          // Restore the representative member after the isolated owner-Admin fixture.
          await page.evaluate(()=>{cur='Avery';auth={currentUser:{uid:'synthetic-ui-review-avery'}};resetTrainerGroups();});
        }
        await showReviewSurface(page,'my-list');
        await expect(page.locator('#mylist-out,#intent-entries,.mylist-type-tabs,#ac-input')).toHaveCount(0);
        await page.locator('#legacy-list-tools > summary').click();
        await expect(page.locator('#legacy-list-tools > button')).toHaveCount(1);
        await expect(page.locator('#legacy-list-tools')).not.toContainText('Build your trade list');
        await page.locator('#legacy-list-tools > button').click();
        await expect(page.locator('#import-category')).toBeVisible();
        const beforeImport=await page.evaluate(()=>JSON.stringify(allData));
        await page.locator('#import-category').selectOption('dynamax');
        await page.locator('#import-str-input').fill('4');
        await page.evaluate(()=>parseImportString());
        await expect(page.locator('#import-preview-list')).toContainText('Charmander');
        expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(beforeImport);
        await page.evaluate(()=>closeModal('import-modal'));

        const high=page.locator('#combined-list > [data-wants-section="H"]');
        const copy=high.locator('[data-contextual-copy]');
        await copy.focus();await expect(copy).toBeFocused();
        expect(await copy.evaluate(node=>getComputedStyle(node).outlineStyle)).not.toBe('none');
        await expect(high.locator('textarea')).toBeHidden();
        await copy.click();
        expect(await page.evaluate(()=>__reviewCopy)).toBe(await copy.getAttribute('data-contextual-copy'));
        await expect(high.locator('textarea')).toBeHidden();

        for(const locale of ['de','ja']){
          await page.evaluate(async locale=>{await i18nCore.setLocale(locale);renderMyList();},locale);
          expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
          const button=high.locator('[data-contextual-copy]');
          expect(await button.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
        }
        await page.evaluate(async()=>{await i18nCore.setLocale('en');renderMyList();});
        await showReviewSurface(page,'favorites');
        await page.evaluate(()=>openTrainerGroup(''));
        await page.locator('[data-group-open-id="favorites"]').focus();
        await page.locator('[data-group-open-id="favorites"]').press('Enter');
        await expect(page.locator('#favorite-trainers')).toBeHidden();
        await expect(page.locator('#trainer-group-results textarea')).toBeHidden();
        await page.locator('[data-group-action="back"]').click();
        await expect(page.locator('[data-group-open-id="favorites"]')).toBeFocused();
        await expect(page.locator('#favorite-trainers')).toBeVisible();

        await page.locator('.group-new > summary').click();
        const draft=page.locator('[data-group-form="create"] input');
        await draft.fill('Weekend across regions');
        await page.evaluate(()=>renderTrainerGroups());
        await expect(draft).toHaveValue('Weekend across regions');await expect(draft).toBeFocused();
        await expect(page.locator('.group-new')).toHaveAttribute('open','');
        await expect(draft).toHaveAttribute('maxlength','40');
        await draft.fill('A'.repeat(40));
        await page.locator('[data-group-form="create"] button').click();
        await expect(page.locator('#trainer-groups-title')).toHaveText('A'.repeat(40));
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(errors).toEqual([]);
        await context.close();
      }
    }finally{await browser.close();}
  });
}
