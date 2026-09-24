const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installShareApplication}=require('./helpers/share-application.cjs');
const baseline=process.env.SHARE_EXPORT_BASELINE==='1';
test('actual renderer content, full multiline notes, identity and artwork evidence',async({page,browser},testInfo)=>{
  test.setTimeout(180000);
  await installShareApplication(page);
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
    fs.writeFileSync(path.join(dir,'export-content.json'),JSON.stringify({browser:browser.version(),baseline,...result},null,2));
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
