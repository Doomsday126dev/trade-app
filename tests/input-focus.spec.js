const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const {install,addDialog}=require('./helpers/want-editor-application.cjs');
const css=fs.readFileSync('css/app.css','utf8');
const fields=['#login-field','#search-field','#app-field','#plain-field','#find-field','#admin-field','#quantity-field','#note-field','#gender-field'];
const markup=`<main style="max-width:600px;padding:20px"><button id="before">Start</button>
<div class="field"><label>Sign in<input id="login-field" type="password"></label></div>
<div class="srch"><input id="search-field" aria-label="Search"></div>
<input id="app-field" class="app-field" aria-label="Profile">
<input id="plain-field" class="ac-input" aria-label="Picker">
<section id="tab-find" style="display:block"><input id="find-field" class="field-control app-search-input" aria-label="Find trainer"></section>
<section id="tab-admin" style="display:block"><input id="admin-field" aria-label="Admin"></section>
<input id="quantity-field" class="have-row-qty" type="number" aria-label="Quantity">
<textarea id="note-field" class="field-control" aria-label="Note"></textarea>
<select id="gender-field" class="field-control" aria-label="Gender"><option>Any gender</option></select>
<button id="after">Done</button></main>`;
function contrast(a,b){const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),l=s=>rgb(s).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),x=l(a),y=l(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
for(const theme of ['dark','light'])test(`all text controls share one thin high-contrast focus edge in ${theme}`,async({page},info)=>{
  await page.emulateMedia({colorScheme:theme});
  await page.setContent(`<html data-theme="${theme}"><head><style>${css}</style></head><body>${markup}</body></html>`);
  for(const selector of fields){
    const field=page.locator(selector);const before=await field.boundingBox();await field.focus();
    await expect(field).toHaveCSS('outline-width','2px');await expect(field).toHaveCSS('outline-offset','-1px');await expect(field).toHaveCSS('box-shadow','none');
    const style=await field.evaluate(n=>{const s=getComputedStyle(n);return{outline:s.outlineColor,bg:s.backgroundColor,canvas:getComputedStyle(document.body).backgroundColor}});
    expect(contrast(style.outline,style.bg),selector).toBeGreaterThanOrEqual(3);
    expect(contrast(style.outline,style.canvas),selector).toBeGreaterThanOrEqual(3);
    const after=await field.boundingBox();expect(after.width).toBe(before.width);expect(after.height).toBe(before.height);
  }
  await page.locator('#before').focus();await page.keyboard.press('Tab');await expect(page.locator(fields[0])).toBeFocused();
  await expect(page.locator(fields[0])).toHaveCSS('outline-width','2px');
  await page.locator('#gender-field').focus();await page.screenshot({path:info.outputPath(`focus-${theme}.png`)});
  await page.locator('#after').focus();await expect(page.locator('#after')).toHaveCSS('outline-width','3px');
});
test('actual request editor uses the shared focus edge for variant, gender and note',async({page},info)=>{
  await install(page);await addDialog(page,'Groudon');
  await page.locator('#combined-preferences').evaluate(el=>el.open=true);
  await page.locator('#combined-mod').focus();await page.keyboard.press('Tab');await expect(page.locator('#combined-gender')).toBeFocused();
  for(const id of ['combined-mod','combined-gender','combined-note']){await page.locator('#'+id).focus();await expect(page.locator('#'+id)).toHaveCSS('outline-width','2px');await expect(page.locator('#'+id)).toHaveCSS('outline-offset','-1px');await expect(page.locator('#'+id)).toHaveCSS('box-shadow','none');}
  await page.locator('#combined-gender').focus();await page.screenshot({path:info.outputPath('editor-focus.png')});
  await page.locator('#combined-editor-modal button').filter({hasText:'Cancel'}).click();await expect(page.locator('#combined-editor-modal')).not.toHaveClass(/open/);
});
test('forced-colors retains a system focus outline',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Forced colors emulation is Chromium-only');
  await page.setContent(`<style>${css}</style>${markup}`);await page.emulateMedia({forcedColors:'active'});expect(await page.evaluate(()=>matchMedia('(forced-colors:active)').matches)).toBe(true);await page.locator('#gender-field').focus();
  await expect(page.locator('#gender-field')).toHaveCSS('outline-style','solid');await expect(page.locator('#gender-field')).toHaveCSS('outline-width','2px');
});
