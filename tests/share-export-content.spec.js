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

test.describe('controlled exact-asset isolation',()=>{
// Only this supplied-asset test blocks workers. Normal SW/offline suites are unchanged.
test.use({serviceWorkers:'block'});
test('catalog Gigantamax fixture keeps exact artwork when the approved asset is available',async({page,context,browser,serviceWorkers},testInfo)=>{
  test.skip(baseline,'Transport-controlled local-fixture qualification, separate from the unchanged baseline proxy failure.');
  const direct='https://img.pokemondb.net/sprites/home/normal/charizard-gigantamax.png';
  const proxy='https://images.weserv.nl/?url=img.pokemondb.net%2Fsprites%2Fhome%2Fnormal%2Fcharizard-gigantamax.png';
  const exact=url=>url===direct||url===proxy;
  const started=Date.now(),timeline=[],routeEvidence=[];
  let phase='setup',dropped=0;
  const record=(event,data={},progress=false)=>{
    const row={ms:Date.now()-started,phase,event,...data};
    if(timeline.length<160)timeline.push(row);else dropped++;
    if(progress)console.log('GMAX_PHASE '+JSON.stringify(row));
  };
  page.on('request',request=>{if(exact(request.url()))record('request',{url:request.url(),type:request.resourceType()});});
  page.on('response',response=>{if(exact(response.url()))record('response',{url:response.url(),status:response.status()});});
  page.on('requestfailed',request=>{if(exact(request.url()))record('request-failed',{url:request.url(),error:request.failure()?.errorText});});
  page.on('console',message=>{
    if(message.text().startsWith('GMAX_BROWSER ')){
      const row=JSON.parse(message.text().slice(13));
      record(row.event,row,['render-start','render-complete','loader-settled'].includes(row.event));
    }
  });
  record('test-start',{browser:browser.version(),serviceWorkers,repeat:testInfo.repeatEachIndex},true);
  try{
    await installShareApplication(page,{onSetupPhase:async setupPhase=>{
      record(setupPhase,{},true);
      if(setupPhase==='routes-ready'){
        // The fixture's broad service-isolation routes are already installed.
        // Install last, BEFORE navigation/My List optical analysis can use this URL.
        await page.route('https://images.weserv.nl/**',async route=>{
          if(route.request().url()!==proxy)return route.fallback();
          const request={requestedUrl:route.request().url(),upstreamUrl:direct};
          routeEvidence.push(request);record('controlled-route-enter',{url:request.requestedUrl},true);
          try{
            const response=await route.fetch({url:direct});
            request.responseStatus=response.status();
            record('controlled-fetch-complete',{url:direct,status:response.status()},true);
            await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});
            request.fulfilled=true;
            record('controlled-fulfilled',{url:proxy},true);
          }catch(error){
            request.error=error.name;
            record('controlled-route-error',{name:error.name},true);throw error;
          }
        });
        record('controlled-route-registered',{url:proxy},true);
      }
      if(setupPhase==='application-ready')await page.evaluate(({direct,proxy})=>{
        // Passive observers return the original promises/behavior. Do not start
        // another loader probe or clear caches while optical work is in flight.
        const log=(event,data={})=>console.info('GMAX_BROWSER '+JSON.stringify({event,...data}));
        window.__gmaxObservedImages=new Map();
        const load=loadCanvasImage;
        loadCanvasImage=function(url){
          const relevant=url===proxy;
          if(relevant)log('loader-call',{phase:'renderer',url,cache:canvasImageCache.has(url)?'hit':'miss'});
          const result=load.apply(this,arguments);
          if(relevant)result.then(image=>{
            window.__gmaxObservedImages.set(url,image);
            log('loader-settled',{phase:'renderer',url,loaded:!!image,width:image?.naturalWidth||0,height:image?.naturalHeight||0});
          },()=>log('loader-rejected',{phase:'renderer',url}));
          return result;
        };
        const optical=_runSpriteScaleDetection;
        _runSpriteScaleDetection=function(url){
          const relevant=url===direct||url===proxy;
          if(relevant)log('optical-start',{phase:'setup-optical',url});
          const result=optical.apply(this,arguments);
          if(relevant)result.then(()=>log('optical-settled',{phase:'setup-optical',url}),()=>log('optical-rejected',{phase:'setup-optical',url}));
          return result;
        };
        const render=buildProductShareImage;
        buildProductShareImage=function(){
          log('render-start',{phase:'renderer'});
          const result=render.apply(this,arguments);
          window.__gmaxRenderTask=result;
          result.then(()=>log('render-complete',{phase:'renderer',imageError:productShareUi.imageError,hasBlob:!!productShareUi.blob}),()=>log('render-rejected',{phase:'renderer'}));
          return result;
        };
      },{direct,proxy});
    }});
    const workerState=await page.evaluate(async()=>({controller:!!navigator.serviceWorker?.controller,registrations:(await navigator.serviceWorker?.getRegistrations()||[]).length}));
    record('worker-state',workerState,true);
    expect(serviceWorkers).toBe('block');expect(context.serviceWorkers()).toHaveLength(0);
    expect(workerState).toEqual({controller:false,registrations:0});
    phase='renderer';
    // One actual UI renderer owns the load. Observe its image, not a competing
    // explicit loadCanvasImageWithFallback call that shares/masks its promise.
    await page.evaluate(()=>openProductShare('image'));
    const result=await page.evaluate(async()=>{
      await window.__gmaxRenderTask;
      const entry=productShareSnapshot.find(e=>e.category==='gmax'),urls=exportSpriteFallbackUrls(entry);
      const image=window.__gmaxObservedImages.get(urls[0]);
      if(image)await image.decode();
      return{entry,context:spriteCatalogContext(entry.no,entry.name,entry.dn,entry.catalogId),urls,loaded:!!image,decoded:!!image,visible:!!image&&canvasImageHasVisiblePixels(image),width:image?.naturalWidth||0,height:image?.naturalHeight||0};
    });
    record('renderer-art-result',{urls:result.urls,loaded:result.loaded,decoded:result.decoded,visible:result.visible,width:result.width,height:result.height},true);
    const evidence={transport:'Test-only fulfillment of the existing exact proxy request from the same exact upstream Gmax asset; NOT a product proxy fix.',browser:browser.version(),serviceWorkers,workerState,direct,routeEntered:routeEvidence.length>0,routeEvidence,...result};
    expect(result.entry.name).toBe('Charizard (Gigantamax)');expect(result.entry.no).toBe(6);expect(result.entry.category).toBe('gmax');
    expect(result.context.canonicalName).toBe('Charizard (Gigantamax)');
    expect(result.urls).toEqual([proxy]);
    expect(routeEvidence.length).toBeGreaterThan(0);
    // An actual matching callback proves the later specific route was not
    // shadowed by the fixture's broad handler; also verify setup ordering.
    const registered=timeline.findIndex(row=>row.event==='controlled-route-registered');
    const fixtureRoutes=timeline.findIndex(row=>row.event==='routes-ready');
    const firstRequest=timeline.findIndex(row=>row.event==='request'&&exact(row.url));
    expect(registered).toBeGreaterThan(fixtureRoutes);expect(firstRequest).toBeGreaterThan(registered);
    expect(result.loaded).toBe(true);expect(result.decoded).toBe(true);expect(result.visible).toBe(true);
    expect(result.width).toBeGreaterThan(0);expect(result.height).toBeGreaterThan(0);
    const preview=page.locator('#product-share-modal #product-share-preview img.share-image-preview');
    await expect(page.locator('#product-share-modal [data-share-mode="image"]')).toHaveAttribute('aria-selected','true');
    await expect(preview).toBeVisible();
    await expect.poll(()=>preview.evaluate(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0)).toBe(true);
    const previewDimensions=await preview.evaluate(async image=>{await image.decode();return{width:image.naturalWidth,height:image.naturalHeight};});
    const download=page.locator('#product-share-primary');
    await expect(download).toHaveText('Download image');await expect(download).toBeVisible();await expect(download).toBeEnabled();await expect(download).toHaveAttribute('aria-busy','false');
    // Optical analysis can start a second matching request after the renderer's
    // own image resolves. Entry alone is not fetch/fulfillment completion.
    await expect.poll(()=>routeEvidence.every(request=>request.fulfilled||request.error)).toBe(true);
    for(const request of routeEvidence){
      expect(request.requestedUrl).toBe(proxy);expect(request.upstreamUrl).toBe(direct);expect(request.responseStatus).toBe(200);
      expect(request.fulfilled).toBe(true);expect(request.error).toBeUndefined();
    }
    record('preview-ready',{...previewDimensions,downloadReady:true},true);
    await testInfo.attach('gmax-controlled-asset',{body:Buffer.from(JSON.stringify(evidence,null,2)),contentType:'application/json'});
    await testInfo.attach('gmax-current-preview',{body:Buffer.from(JSON.stringify(previewDimensions,null,2)),contentType:'application/json'});
    const root=process.env.SHARE_HARDENING_OUTPUT;
    if(root){
      const dir=path.join(root,testInfo.project.name);fs.mkdirSync(dir,{recursive:true});
      const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await productShareUi.blob.arrayBuffer())));
      fs.writeFileSync(path.join(dir,'board-controlled-exact-gmax.png'),Buffer.from(bytes));
      fs.writeFileSync(path.join(dir,'gmax-controlled-asset.json'),JSON.stringify({...evidence,previewDimensions},null,2));
    }
  }finally{
    // Workflow does not upload attachments: stdout is the primary bounded record.
    console.log('GMAX_TIMELINE '+JSON.stringify({timeline,routeEvidence,dropped}));
    await testInfo.attach('gmax-lifecycle',{body:Buffer.from(JSON.stringify({timeline,routeEvidence,dropped},null,2)),contentType:'application/json'});
  }
});
});
