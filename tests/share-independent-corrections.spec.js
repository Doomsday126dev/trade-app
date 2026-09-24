const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installShareApplication}=require('./helpers/share-application.cjs');
const before=process.env.SHARE_CORRECTIONS_BEFORE==='1';
function output(testInfo){const dir=path.join(process.env.SHARE_CORRECTIONS_OUTPUT||testInfo.outputDir,testInfo.project.name);fs.mkdirSync(dir,{recursive:true});return dir;}
async function localApp(page){
  // Deterministic application behavior only. No proxy experiments, live services
  // or remote artwork qualification in this correction's tests.
  await installShareApplication(page,{allowRemoteArtwork:false});
}
async function keyboardOpen(page){
  const trigger=page.locator('.wants-list-toolbar button').first();
  // Start at the document's normal focus and reach the actual Share trigger.
  // macOS WebKit's default Tab visits form fields; Option+Tab includes buttons.
  const next=page.context().browser().browserType().name()==='webkit'?'Alt+Tab':'Tab';
  for(let i=0;i<80&&!await trigger.evaluate(el=>el===document.activeElement);i++)await page.keyboard.press(next);
  await expect(trigger).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.locator('#product-share-tab-link')).toBeFocused();
  return trigger;
}
async function geometry(page){return page.locator('#product-share-body').evaluate(el=>{
  const last=el.querySelector('.share-public-list li:last-child'),rect=el.getBoundingClientRect(),lastRect=last?.getBoundingClientRect();
  return{focus:document.activeElement.id||document.activeElement.className,scrollTop:el.scrollTop,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,
    lastVisible:!!lastRect&&lastRect.top>=rect.top&&lastRect.bottom<=rect.bottom,outline:getComputedStyle(el).outlineStyle,
    bodyOverflow:getComputedStyle(el).overflowY,pageScroll:document.scrollingElement.scrollTop};
});}

test('keyboard alone reaches the final Link preview row and returns to its trigger',async({page,browser},testInfo)=>{
  await page.setViewportSize({width:1440,height:760});await localApp(page);
  await page.evaluate(()=>{
    allData.users[cur].intentDeclarations=Array.from({length:50},(_,i)=>({entityId:'keyboard-'+i,side:'lf',name:'Spinda (Form '+(i%8+1)+')',p:'H',mod:'Keyboard preview row '+(i+1),note:'Public synthetic want '+(i+1)+' — preserve the exact requested form.'}));
    for(const category of ['wishlist','dynamax','gmax','costumes'])allData[category][cur]={};
    renderMyList();
  });
  const trigger=await keyboardOpen(page),body=page.locator('#product-share-body');
  await expect(page.locator('.share-public-list li')).toHaveCount(50);
  const initial=await geometry(page);expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
  await page.keyboard.press('Tab');const tab=await geometry(page);
  await page.keyboard.press('PageDown');
  if(!before)await expect.poll(async()=>(await geometry(page)).scrollTop).toBeGreaterThan(0);
  const pageDown=await geometry(page);
  await page.keyboard.press('End');
  if(!before)await expect.poll(async()=>(await geometry(page)).lastVisible).toBe(true);
  const end=await geometry(page);
  await page.screenshot({path:path.join(output(testInfo),'keyboard-link-'+(before?'before':'after')+'.png')});
  fs.writeFileSync(path.join(output(testInfo),'keyboard-link.json'),JSON.stringify({browser:browser.version(),viewport:page.viewportSize(),before,initial,tab,pageDown,end,interaction:'Tab (Option+Tab to reach the Share trigger in macOS WebKit) / Enter / Tab / PageDown / End; no pointer, wheel, focus() or scrollTop assignment'},null,2));
  if(before){expect(tab.focus).not.toBe('product-share-body');expect(pageDown.scrollTop).toBe(0);expect(end.scrollTop).toBe(0);return;}
  await expect(body).toBeFocused();expect(tab.outline).toBe('solid');
  await page.keyboard.press('Tab');await expect(page.locator('.share-footer-actions .bghost')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#product-share-primary')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('.share-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#product-share-primary')).toBeFocused();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  expect(await page.locator('#app').evaluate(el=>el.inert)).toBe(false);
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(0);
});

test('Text and Image retain tab navigation, native radio arrows and preview focus on refresh',async({page},testInfo)=>{
  test.skip(before,'Only the Link defect is reproduced on the reviewed candidate.');
  await localApp(page);await keyboardOpen(page);
  for(const mode of ['image','text']){
    await page.keyboard.press('ArrowRight');await expect(page.locator('#product-share-tab-'+mode)).toBeFocused();
    await page.keyboard.press('Tab');await expect(page.locator('#product-share-body')).toBeFocused();
    await page.keyboard.press('Tab');await expect(page.locator('#share-scope-full')).toBeFocused();
    await page.keyboard.press('ArrowRight');await expect(page.locator('#share-scope-top')).toBeChecked();await expect(page.locator('#share-scope-top')).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(page.locator('#share-scope-full')).toBeChecked();
    await page.keyboard.press('Tab');const format=mode==='image'?'image-board':'text-plain';
    await expect(page.locator('#share-'+format)).toBeFocused();
    await page.keyboard.press('ArrowRight');const next=mode==='image'?'image-classic':'text-markdown';
    await expect(page.locator('#share-'+next)).toBeChecked();await expect(page.locator('#share-'+next)).toBeFocused();
    if(mode==='image')await expect(page.locator('.share-image-preview')).toBeVisible();
    await expect(page.locator('#share-'+next)).toBeFocused(); // async preview must not steal focus
    await page.keyboard.press('Shift+Tab');await expect(page.locator('#product-share-body')).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(page.locator('#product-share-tab-'+mode)).toBeFocused();
  }
  await page.keyboard.press('Home');await expect(page.locator('#product-share-tab-link')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#product-share-body')).toBeFocused();
  await page.evaluate(()=>refreshProductShare());await expect(page.locator('#product-share-body')).toBeFocused();
  await page.screenshot({path:path.join(output(testInfo),'keyboard-panel-focus.png')});
  expect(await page.evaluate(()=>__shareTest.writes.length)).toBe(0);
});

for(const locale of ['en','ja','es','de'])test(`actual Share and legacy exports compose complete localized headings (${locale})`,async({page,browser},testInfo)=>{
  test.skip(before,'The prior actual PNGs retain the original malformed heading.');
  await localApp(page);
  await page.evaluate(async locale=>{
    await changeInterfaceLocale(locale);
    window.__headingSeed=structuredClone(allData);
    window.__headingRecords=[];
    const original=renderListImage,caption=drawListImageCaption,fill=CanvasRenderingContext2D.prototype.fillText;
    renderListImage=async function(entries,type,owner,style,intent){
      const record={owner,type,style,intent,drawn:[],captions:[],expectedNames:entries.map(e=>e.dn||e.name)};
      const measure=document.createElement('canvas').getContext('2d');
      record.header=listImageHeader(measure,owner,type,intent,style);
      record.expectedTitle=listImageHeading(owner,intent);
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
        const m=this.measureText(text);
        record.drawn.push({text:String(text),x,y,font:this.font,left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});
        return fill.call(this,text,x,y,...rest);
      };
      drawListImageCaption=function(ctx,item,x,y,options){
        const width=style==='classic'?(560-12)/3:(560-24-12)/3;
        record.captions.push({name:item.entry.dn||item.entry.name,
          expected:[item.entry.dn||item.entry.name,productShareDescription({...item.entry,name:'',dn:'',p:'',note:''}),publicSharePublicationDomain.publicNoteForDisplay(item.entry.note)].filter(Boolean).join(''),
          drawn:item.lines.map(line=>line.text).join(''),blankLines:item.lines.filter(line=>line.text==='').length,
          overflow:item.lines.filter(line=>{ctx.font=line.bold?'700 12px sans-serif':'12px sans-serif';return ctx.measureText(line.text).width>width-16+.5;})});
        return caption(ctx,item,x,y,options);
      };
      try{
        const blob=await original(entries,type,owner,style,intent);record.mime=blob.type;
        record.data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});
        __headingRecords.push(record);return blob;
      }finally{drawListImageCaption=caption;CanvasRenderingContext2D.prototype.fillText=fill;}
    };
    // Replace only file/share-sheet delivery. Both entry points and the actual
    // renderers remain in use; exact Blob bytes and established names are checked.
    deliverImageBlob=async(blob,filename,title)=>{window.__headingDelivery={filename,title,type:blob.type,data:await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);})};return'downloaded';};
  },locale);
  const results=[];
  for(const owner of ['LocalTrainer','Trainer'+'LongExactIdentity'.repeat(3)+'123456']){
    await page.evaluate(owner=>{
      allData=structuredClone(__headingSeed);
      for(const surface of ['users','wishlist','dynamax','gmax','costumes']){allData[surface][owner]=allData[surface].LocalTrainer;if(owner!=='LocalTrainer')delete allData[surface].LocalTrainer;}
      if(owner!=='LocalTrainer'){
        const entry=allData.users[owner].intentDeclarations.find(e=>e.name==='Spinda (Form 7)');
        entry.mod='Exact form seven — '+'長い条件を省略しない'.repeat(10);
        entry.note=('First public line\n\n'+'N'.repeat(110)+'\nFinal public note THE END.').slice(0,160);
      }
      cur=owner;myListType='wishlist';myListIntent='lf';renderMyList();
      activePublicShareHydrationToken=managedPublicSharePublication.activate({uid:auth.currentUser.uid,username:cur}).token;
      for(const surface of ['profile','wishlist','dynamax','gmax','costumes'])managedPublicSharePublication.markLoaded(activePublicShareHydrationToken,surface);
    },owner);
    for(const flow of ['share','legacy'])for(const style of ['classic','cards']){
      await page.evaluate(()=>window.__headingDelivery=null);
      if(flow==='share'){
        await page.locator('.wants-list-toolbar button').first().click();
        await page.locator('#product-share-tab-image').click();
        await expect(page.locator('.share-image-preview')).toBeVisible();
        await page.locator('#share-image-'+style).check();
        await expect(page.locator('#product-share-primary')).toBeEnabled();
        await page.locator('#product-share-primary').click();
      }else await page.evaluate(style=>exportMyListImage(style),style);
      await expect.poll(()=>page.evaluate(()=>!!window.__headingDelivery)).toBe(true);
      const record=await page.evaluate(()=>({render:__headingRecords.at(-1),delivery:__headingDelivery,expectedFilename:listImageFilename(cur,myListType,__headingRecords.at(-1).style),writes:__shareTest.writes.length}));
      const {render,delivery}=record;
      expect(render.owner).toBe(owner);expect(render.intent).toBe('lf');expect(render.type).toBe('wishlist');
      expect(render.expectedTitle).toBe(owner+' · '+({en:'Wants',ja:'欲しいポケモン',es:'Busco',de:'Gesucht'})[locale]);
      expect(render.header.title.join('')).toBe(render.expectedTitle);
      expect(render.header.context.join('')).toBe(({en:'Category: Trades',ja:'カテゴリ：交換',es:'Categoría: Intercambios',de:'Kategorie: Tausche'})[locale]);
      expect(render.expectedTitle).not.toContain("'s");
      const lines=render.drawn.filter(draw=>draw.y<render.header.height);
      expect(lines.map(line=>line.text).join('')).toContain(render.expectedTitle);
      expect(lines.every(line=>line.left>=-.5&&line.right<=560.5&&line.top>=0&&line.bottom<render.header.height)).toBe(true);
      if(owner!=='LocalTrainer')expect(render.header.title.length).toBeGreaterThan(1);
      expect(render.mime).toBe('image/png');expect(delivery.type).toBe('image/png');expect(delivery.data).toBe(render.data);expect(delivery.filename).toBe(record.expectedFilename);
      expect(render.captions).toHaveLength(7);
      expect(render.captions.map(caption=>caption.name).sort()).toEqual([...render.expectedNames].sort());
      for(const caption of render.captions){expect(caption.drawn.replace(/\s/gu,'')).toBe(caption.expected.replace(/\s/gu,''));expect(caption.overflow).toEqual([]);}
      const exact=render.captions.find(caption=>caption.name.includes('7'));
      if(owner!=='LocalTrainer'){expect(exact.blankLines).toBe(1);expect(exact.drawn).toContain('THE END.');}
      else expect(exact.drawn).toContain('Public note with details for our trade.');
      expect(render.captions.map(caption=>caption.drawn).join('')).toContain('XXL');
      expect(render.captions.map(caption=>caption.drawn).join('')).toContain('XXS');
      expect(JSON.stringify(render)).not.toContain('PRIVATE_');expect(record.writes).toBe(0);
      const name=`${style}-${flow}-${locale}-${owner==='LocalTrainer'?'normal':'long'}`;
      fs.writeFileSync(path.join(output(testInfo),name+'.png'),Buffer.from(render.data.split(',')[1],'base64'));
      delete render.data;delete delivery.data;results.push({name,...record});
      if(flow==='share')await page.keyboard.press('Escape');
    }
  }
  // Retain explicit intent/category inputs for fixed-scope legacy contexts.
  const contexts=await page.evaluate(async()=>{
    const results=[];
    for(const type of ['dynamax','gmax','costumes'])for(const style of ['classic','cards']){
      // An empty renderer probe checks each separate context/intent heading
      // without pretending an ordinary form belongs to a Max category.
      await renderListImage([],type,cur,style,'ft');
      const record=__headingRecords.at(-1);delete record.data;results.push(record);
    }return results;
  });
  const forTrade={en:'For Trade',ja:'交換に出せる',es:'Ofrezco',de:'Zum Tausch'};
  const categories={en:{dynamax:'Category: Dynamax',gmax:'Category: Gigantamax',costumes:'Category: Others'},ja:{dynamax:'カテゴリ：ダイマックス',gmax:'カテゴリ：キョダイマックス',costumes:'カテゴリ：その他'},es:{dynamax:'Categoría: Dinamax',gmax:'Categoría: Gigamax',costumes:'Categoría: Otros'},de:{dynamax:'Kategorie: Dynamax',gmax:'Kategorie: Gigadynamax',costumes:'Kategorie: Andere'}};
  for(const record of contexts){
    expect(record.header.title.join('')).toBe(record.owner+' · '+forTrade[locale]);
    expect(record.header.context.join('')).toBe(categories[locale][record.type]);
    expect(record.drawn.filter(draw=>draw.y<record.header.height).every(draw=>draw.left>=-.5&&draw.right<=560.5&&draw.top>=0&&draw.bottom<record.header.height)).toBe(true);
    expect(record.captions).toHaveLength(0);
  }
  fs.writeFileSync(path.join(output(testInfo),'exports-'+locale+'.json'),JSON.stringify({browser:browser.version(),locale,transport:'All external artwork/services blocked; real local application renderers and local assets.',results,contexts},null,2));
});
