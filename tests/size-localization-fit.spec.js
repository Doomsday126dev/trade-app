const{test,expect}=require('@playwright/test');const{install,edit}=require('./helpers/want-editor-application.cjs');
for(const locale of ['en','es','de','ja'])for(const enlarged of [false,true])test(`Size choices fit ${locale} ${enlarged?'enlarged':'normal'} at 320px`,async({page},info)=>{
 await install(page);await page.setViewportSize({width:320,height:900});await page.evaluate(async locale=>{await changeInterfaceLocale(locale);applyTheme('dark');},locale);await edit(page,'Rotom');
 if(enlarged)await page.locator('.combined-size-field label span').evaluateAll(spans=>spans.forEach(span=>span.style.fontSize=(parseFloat(getComputedStyle(span).fontSize)*2)+'px'));
 await page.locator('.combined-size-field').scrollIntoViewIfNeeded();
 const metrics=await page.locator('.combined-size-field label').evaluateAll(labels=>labels.map(label=>{const rect=label.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect();return{text:label.innerText,left:rect.left,right:rect.right,textLeft:text.left,textRight:text.right,height:rect.height};}));
 await page.screenshot({path:info.outputPath('size-'+locale+'-'+(enlarged?'large':'normal')+'.png')});
 for(const m of metrics){expect(m.textLeft,m.text).toBeGreaterThanOrEqual(m.left-1);expect(m.textRight,m.text).toBeLessThanOrEqual(m.right+1);expect(m.height).toBeGreaterThanOrEqual(44);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
