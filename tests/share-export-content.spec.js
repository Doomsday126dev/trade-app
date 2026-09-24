const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installShareApplication}=require('./helpers/share-application.cjs');
const baseline=process.env.SHARE_EXPORT_BASELINE==='1';
test('actual renderer content, full multiline notes, identity and artwork evidence',async({page,browser},testInfo)=>{
  test.setTimeout(180000);
  const assetResponses=[];
  page.on('response',response=>{if(/charizard/i.test(response.url()))assetResponses.push({url:response.url(),status:response.status()});});
  await installShareApplication(page,{gmaxName:'Gigantamax Charizard'});
  const result=await page.evaluate(async()=>{
    const entries=productDeclarations().entries;
    // Same public inputs on both trees. Includes the prior fixture's Gmax alias
    // and a maximum supported note; no hidden account data enters the renderers.
    const exact=entries.find(e=>e.name==='Spinda (Form 7)');
    exact.note='Meet Saturday after 3 pm.\nPlease keep the exact form and every requirement.\n'+'Long public note with no omitted ending. '.repeat(3);
    exact.note=exact.note.slice(0,152)+'THE END.';
    exact.mod='Exact form seven; keep this qualifier intact';
    const publicEntries=publicSharePublicationDomain.publicDeclarations(entries).map((e,i)=>({...e,dn:entries[i].dn,no:entries[i].no,catalogId:entries[i].catalogId||entries[i].ref?.catalogId||'',note:publicSharePublicationDomain.publicNoteForDisplay(e.note)}));
    const requests=[];
    const inspect=async entry=>{
      const urls=exportSpriteFallbackUrls(entry);
      const outcomes=[];
      for(const url of urls){const image=await loadCanvasImage(url);outcomes.push({url,loaded:!!image,visible:!!image&&canvasImageHasVisiblePixels(image),width:image?.naturalWidth||0});}
      return{entry,primary:exportSpriteUrl(entry),context:spriteCatalogContext(entry.no,entry.name,entry.dn,entry.catalogId),outcomes};
    };
    const original=entries.find(e=>e.category==='gmax');
    requests.push({case:'original fixture',...await inspect(original)});
    requests.push({case:'allowlisted preview',...await inspect(publicEntries.find(e=>e.category==='gmax'))});
    const catalog=listSource('gmax').find(e=>/charizard/i.test(e.name));
    requests.push({case:'catalog control',...await inspect({...catalog,category:'gmax',intent:'lf',p:'H'})});
    const draw=CanvasRenderingContext2D.prototype.fillText,outputs={};
    try{
      for(const style of ['classic','cards']){
        const text=[];
        CanvasRenderingContext2D.prototype.fillText=function(value,x,y,...rest){
          const m=this.measureText(value);text.push({text:String(value),x,y,width:m.width,font:this.font,align:this.textAlign,canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,scale:this.getTransform().a});
          return draw.call(this,value,x,y,...rest);
        };
        const scoped=publicEntries.filter(e=>e.category==='wishlist');
        const blob=await renderListImage(scoped,'wishlist','LocalTrainer · Looking For',style);
        outputs[style]={data:await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);}),text};
      }
    }finally{CanvasRenderingContext2D.prototype.fillText=draw;}
    return{inputs:publicEntries,artwork:requests,outputs};
  });
  const root=process.env.SHARE_HARDENING_OUTPUT;
  if(root){
    const dir=path.join(root,testInfo.project.name);fs.mkdirSync(dir,{recursive:true});
    for(const [style,value]of Object.entries(result.outputs)){fs.writeFileSync(path.join(dir,style+'.png'),Buffer.from(value.data.split(',')[1],'base64'));delete value.data;}
    fs.writeFileSync(path.join(dir,'export-content.json'),JSON.stringify({browser:browser.version(),baseline,assetResponses,...result},null,2));
  }
  for(const style of ['classic','cards']){
    const drawn=result.outputs[style].text.map(x=>x.text).join(' ').replace(/\s+/g,' ');
    if(baseline){expect(drawn).not.toContain('THE END.');expect(drawn).not.toContain('Lucky');continue;}
    expect(drawn).toContain('THE END.');expect(drawn).toContain('Lucky');expect(drawn).toContain('Shiny');
    expect(drawn).toContain('XXL');expect(drawn).toContain('XXS');expect(drawn).toContain('♀');
    expect(drawn).toContain('Spinda (Form 7)');expect(drawn).toContain('Exact form seven; keep this qualifier intact');
    for(const entry of result.inputs.filter(e=>e.category==='wishlist')){
      expect(drawn).toContain(entry.dn||entry.name);
      if(entry.note)expect(drawn).toContain(entry.note.replace(/\s+/g,' '));
    }
    expect(drawn).not.toContain('PRIVATE_');expect(drawn).not.toContain('Gigantamax');
    const overflow=result.outputs[style].text.filter(t=>{
      const left=t.x-(t.align==='center'?t.width/2:t.align==='right'?t.width:0);
      return left<-.5||left+t.width>t.canvasWidth/t.scale+.5||t.y>t.canvasHeight/t.scale;
    });
    expect(overflow).toEqual([]);
  }
});

test('long localized public captions remain complete inside their own image cells',async({page},testInfo)=>{
  test.skip(baseline,'Baseline omissions are recorded by the identical-input comparison above.');
  await installShareApplication(page);
  const result=await page.evaluate(async()=>{
    await changeInterfaceLocale('ja');
    const entries=[1,7,9].map((form,i)=>({intent:'lf',category:'wishlist',name:`Spinda (Form ${form})`,dn:`Spinda (Form ${form})`,no:327,p:'H',shiny:i!==1,lucky:i!==2,xxl:i===0,xxs:i===0,gender:i===1?'m':'f',mod:'Exact form '+form+' — '+'長い条件を省略しない'.repeat(12),note:'First line\n\n'+'N'.repeat(100)+'\n最後の公開メモも保持します。'}));
    const output={};const original=drawListImageCaption;
    try{for(const style of ['classic','cards']){
      const captions=[];
      drawListImageCaption=function(ctx,item,x,y,options){
        const expected=[item.entry.dn,productShareDescription({...item.entry,name:'',dn:'',p:'',note:''}),item.entry.note].filter(Boolean).join('');
        const width=style==='classic'?(560-12)/3:(560-24-12)/3;
        captions.push({expected,drawn:item.lines.map(line=>line.text).join(''),blankLines:item.lines.filter(line=>line.text==='').length,overflow:item.lines.filter(line=>{ctx.font=line.bold?'700 12px sans-serif':'12px sans-serif';return ctx.measureText(line.text).width>width-16+.5;})});
        return original(ctx,item,x,y,options);
      };
      const blob=await renderListImage(entries,'wishlist','LocalTrainer',style);
      output[style]={captions,data:await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);})};
    }}finally{drawListImageCaption=original;}
    return output;
  });
  for(const [style,value]of Object.entries(result)){
    for(const caption of value.captions){expect(caption.drawn.replace(/\s/gu,'')).toBe(caption.expected.replace(/\s/gu,''));expect(caption.blankLines).toBe(1);expect(caption.overflow).toEqual([]);}
    const root=process.env.SHARE_HARDENING_OUTPUT;
    if(root){const dir=path.join(root,testInfo.project.name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,style+'-long-ja.png'),Buffer.from(value.data.split(',')[1],'base64'));delete value.data;fs.writeFileSync(path.join(dir,style+'-long-ja.json'),JSON.stringify(value,null,2));}
  }
});

test('catalog Gigantamax fixture keeps exact artwork when the approved asset is available',async({page},testInfo)=>{
  test.skip(baseline,'Transport-controlled local-fixture qualification, separate from the unchanged baseline proxy failure.');
  await installShareApplication(page);
  const direct='https://img.pokemondb.net/sprites/home/normal/charizard-gigantamax.png';
  let transportStatus;
  await page.route('https://images.weserv.nl/**',async route=>{
    if(!route.request().url().includes('charizard-gigantamax.png'))return route.continue();
    const response=await route.fetch({url:direct});transportStatus=response.status();
    await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});
  });
  const result=await page.evaluate(async()=>{
    canvasImageCache.clear();openProductShare('image');
    const entry=productShareSnapshot.find(e=>e.category==='gmax');
    const urls=exportSpriteFallbackUrls(entry),image=await loadCanvasImageWithFallback(urls);
    return{entry,context:spriteCatalogContext(entry.no,entry.name,entry.dn,entry.catalogId),urls,loaded:!!image,visible:!!image&&canvasImageHasVisiblePixels(image),width:image?.naturalWidth};
  });
  expect(result.entry.name).toBe('Charizard (Gigantamax)');expect(result.entry.no).toBe(6);expect(result.entry.category).toBe('gmax');
  expect(result.context.canonicalName).toBe('Charizard (Gigantamax)');
  expect(result.urls.length).toBeGreaterThan(0);expect(result.urls.every(url=>url.includes('charizard-gigantamax.png'))).toBe(true);
  expect(transportStatus).toBe(200);expect(result.loaded).toBe(true);expect(result.visible).toBe(true);
  await expect(page.locator('.share-image-preview')).toBeVisible();
  const root=process.env.SHARE_HARDENING_OUTPUT;
  if(root){
    const dir=path.join(root,testInfo.project.name);fs.mkdirSync(dir,{recursive:true});
    const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await productShareUi.blob.arrayBuffer())));
    fs.writeFileSync(path.join(dir,'board-controlled-exact-gmax.png'),Buffer.from(bytes));
    fs.writeFileSync(path.join(dir,'gmax-controlled-asset.json'),JSON.stringify({transport:'Test-only fulfillment of the existing exact proxy request from the same exact upstream Gmax asset; NOT a product proxy fix.',direct,transportStatus,...result},null,2));
  }
});
