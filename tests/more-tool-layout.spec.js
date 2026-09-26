const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {install}=require('./helpers/more-application.cjs');
test.use({serviceWorkers:'block'});
const output=process.env.MORE_OUTPUT_DIR;
async function capture(page,name){if(output){fs.mkdirSync(output,{recursive:true});await expect(page.locator('#toast')).toBeHidden();await page.screenshot({path:path.join(output,name+'.png'),fullPage:name.includes('text-200'),animations:'disabled'});}}
async function localeThroughSettings(page,locale){
  await page.locator('#more-settings').click();await page.locator('[data-settings-target="language"]').click();
  await page.locator('#settings-language').selectOption(locale);await page.locator('.settings-modal-close').click();await expect(page.locator('#settings-modal')).toBeHidden();
}
for(const width of [1920,1440,768,390,320])test(`actual More rows fit and remain grouped at ${width}px in EN/JA/ES/DE`,async({page})=>{
  await page.setViewportSize({width,height:width===1920?1080:900});await install(page);
  const measurements=[];
  for(const locale of ['en','ja','es','de']){
    await localeThroughSettings(page,locale);
    const measured=await page.locator('#tab-more').evaluate(shell=>{
      const box=el=>{const {x,y,width,height,right,bottom}=el.getBoundingClientRect();return{x,y,width,height,right,bottom};};
      return{width:innerWidth,height:innerHeight,shell:box(shell),columns:getComputedStyle(shell.querySelector('.more-groups')).gridTemplateColumns,
        overflow:document.documentElement.scrollWidth>innerWidth,
        rows:[...shell.querySelectorAll('.more-destination')].filter(el=>el.getClientRects().length).map(el=>{
          const content=el.querySelector('span'),range=document.createRange();range.selectNodeContents(content);
          return{id:el.id,box:box(el),content:box(content),text:[...range.getClientRects()].map(r=>({left:r.left,right:r.right})),icons:[...el.querySelectorAll('svg')].map(box)};
        })};
    });
    measurements.push({locale,...measured});expect(measured.overflow).toBe(false);expect(measured.rows).toHaveLength(7);
    expect(measured.columns.split(' ').length).toBe(width>=768?2:1);
    for(const row of measured.rows){
      expect(row.box.height).toBeGreaterThanOrEqual(48);expect(row.icons).toHaveLength(2);
      expect(row.icons[0].right).toBeLessThanOrEqual(row.content.x);expect(row.content.right).toBeLessThanOrEqual(row.icons[1].x);
      for(const text of row.text){expect(text.left).toBeGreaterThanOrEqual(row.content.x-1);expect(text.right).toBeLessThanOrEqual(row.content.right+1);}
    }
    if(locale==='en'||width===320&&locale==='de')await capture(page,`more-${width}-${locale}`);
  }
  if(output)fs.writeFileSync(path.join(output,`more-${width}-measurements.json`),JSON.stringify(measurements,null,2));
});
test('More short viewport, themes, pointer and enlarged localized text remain usable',async({page})=>{
  await install(page);await page.setViewportSize({width:390,height:500});
  for(const theme of ['light','dark','auto']){
    await page.emulateMedia({colorScheme:theme==='auto'?'light':'dark'});
    await page.locator('#more-settings').click();await page.locator('[data-settings-target="appearance"]').click();await page.locator(`[data-settings-theme="${theme}"]`).click();await page.locator('.settings-modal-close').click();
    await page.locator('#more-help').scrollIntoViewIfNeeded();await expect(page.locator('#more-help')).toBeInViewport();await capture(page,`more-short-${theme}`);
  }
  await localeThroughSettings(page,'de');await page.setViewportSize({width:320,height:600});
  await page.evaluate(()=>{document.documentElement.style.fontSize=`${parseFloat(getComputedStyle(document.documentElement).fontSize)*2}px`;});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#more-help').scrollIntoViewIfNeeded();await page.locator('#more-help').focus();await page.keyboard.press('Enter');await expect(page.locator('#shortcuts-modal')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#more-help')).toBeFocused();
  await capture(page,'more-320-de-text-200');
  await page.evaluate(()=>{document.documentElement.style.fontSize='';applyTheme('dark');});await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>scrollTo(0,0));
  await page.locator('#more-transfer').hover();await capture(page,'more-pointer');
  await page.locator('#more-events').focus();await page.keyboard.press('Tab');await capture(page,'more-keyboard');
});
test('actual contextual My List, trainer selection and Help captures',async({page})=>{
  await install(page);await page.setViewportSize({width:1440,height:900});
  await page.locator('#nav-mylist').click();await page.locator('#wants-list-tools summary').click();await capture(page,'my-list-import-entry');
  await page.locator('#wants-import').click();await page.locator('#import-str-input').fill('1,7');await page.locator('#import-step1 .bpri').click();await capture(page,'import-preview');await page.keyboard.press('Escape');
  await page.locator('#nav-find').click();await page.locator('#trainer-mode-favorites').click();await capture(page,'trainers-transfer-entry');
  await page.locator('#trainer-transfer-review').click();await capture(page,'transfer-no-selection');await page.locator('[data-safe-transfer-trainer="ada"]').click();await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','ready');await capture(page,'transfer-selected');await page.keyboard.press('Escape');
  await page.locator('#nav-more').click();await page.locator('#more-help').click();await capture(page,'help');await page.keyboard.press('Escape');
});
test('genuinely empty owned My List entry capture',async({page})=>{
  await install(page,{empty:true});await page.setViewportSize({width:390,height:900});await page.locator('#nav-mylist').click();await expect(page.locator('#wants-empty-import')).toBeVisible();await capture(page,'empty-import-390');
});
