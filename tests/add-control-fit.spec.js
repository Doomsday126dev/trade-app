const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installVisualFixture}=require('./helpers/visual-consistency.cjs');

test.use({serviceWorkers:'block'});

for(const width of [320,390])for(const locale of ['en','ja','es','de'])for(const enlarged of [false,true]){
  test(`Add controls contain ${locale} labels at ${width}px${enlarged?' with enlarged text':''}`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await installVisualFixture(page);
    await page.evaluate(()=>openAccountSettingsSection('language'));
    await page.locator('#settings-language').selectOption(locale);
    await expect(page.locator('#settings-language')).toHaveValue(locale);
    await page.locator('.settings-modal-close').click();
    if(enlarged)await page.evaluate(()=>{
      document.documentElement.style.fontSize='200%';
      for(const el of document.querySelectorAll('.wants-add-form button,.wants-add-form button span,.wants-add-form .add-pri-label')){
        el.style.fontSize=`${parseFloat(getComputedStyle(el).fontSize)*2}px`;
      }
    });
    const result=await page.locator('.wants-add-form').evaluate(form=>{
      const input=form.querySelector('#wants-add-name'),buttons=[form.querySelector('.add-actions .bsave'),form.querySelector('.add-advanced-toggle')];
      const controls=buttons.map(button=>{
        const box=button.getBoundingClientRect(),textRects=[],walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){
          if(!walker.currentNode.textContent.trim())continue;
          const range=document.createRange();range.selectNodeContents(walker.currentNode);
          for(const rect of range.getClientRects())if(rect.width&&rect.height)textRects.push({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom});
        }
        return{label:button.textContent.trim(),width:box.width,height:box.height,left:box.left,right:box.right,top:box.top,bottom:box.bottom,textRects,overflow:getComputedStyle(button).overflow};
      });
      return{viewport:innerWidth,formWidth:form.getBoundingClientRect().width,searchWidth:input.getBoundingClientRect().width,controls,documentOverflow:document.documentElement.scrollWidth>innerWidth};
    });
    expect(result.searchWidth).toBeGreaterThanOrEqual(140);
    expect(result.documentOverflow).toBe(false);
    for(const control of result.controls){
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.textRects.length).toBeGreaterThan(0);
      for(const rect of control.textRects){
        expect(rect.left,`${locale} ${width}px ${control.label} left: ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(control.left-0.5);
        expect(rect.right,`${locale} ${width}px ${control.label} right: ${JSON.stringify(result)}`).toBeLessThanOrEqual(control.right+0.5);
        expect(rect.top,`${locale} ${width}px ${control.label} top: ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(control.top-0.5);
        expect(rect.bottom,`${locale} ${width}px ${control.label} bottom: ${JSON.stringify(result)}`).toBeLessThanOrEqual(control.bottom+0.5);
      }
    }
    const output=process.env.CONTROL_FIT_OUTPUT_DIR;
    if(output&&locale==='de'){
      fs.mkdirSync(output,{recursive:true});
      if(width===390&&!enlarged){
        await page.screenshot({path:path.join(output,'add-controls-de-390.png'),animations:'disabled'});
        await page.locator('#combined-list > [data-wants-section="H"] [data-contextual-copy]').click();
        await expect(page.locator('#combined-list > [data-wants-section="H"] [data-contextual-copy]')).toHaveClass(/is-copied/);
        await page.screenshot({path:path.join(output,'copy-success-de-390.png'),animations:'disabled'});
      }
      if(width===320&&enlarged)await page.screenshot({path:path.join(output,'add-controls-de-320-enlarged.png'),animations:'disabled'});
    }
  });
}

test('desktop Add controls retain the accepted horizontal layout',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await installVisualFixture(page);
  await page.evaluate(()=>openAccountSettingsSection('language'));
  await page.locator('#settings-language').selectOption('de');
  await page.locator('.settings-modal-close').click();
  const boxes=await page.locator('.wants-add-form').evaluate(form=>{
    const search=form.querySelector('#wants-add-name').getBoundingClientRect(),add=form.querySelector('.bsave').getBoundingClientRect();
    return{search:{left:search.left,right:search.right,top:search.top},add:{left:add.left,top:add.top},formWidth:form.getBoundingClientRect().width};
  });
  expect(boxes.search.right).toBeLessThan(boxes.add.left);
  expect(Math.abs(boxes.search.top-boxes.add.top)).toBeLessThan(16);
  expect(boxes.formWidth).toBeGreaterThan(700);
});
