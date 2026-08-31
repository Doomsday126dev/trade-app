const {test,expect}=require('@playwright/test');

const sprite='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="24" fill="#8b7cf6"/></svg>';

async function loadExporter(page){
  await page.route('**/sw.js*',route=>route.abort());
  await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
  await page.route('https://raw.githubusercontent.com/PokeAPI/sprites/**',route=>route.fulfill({
    contentType:'image/svg+xml',headers:{'access-control-allow-origin':'*'},body:sprite
  }));
  await page.goto(`./?board-export=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('special-board-export-test'));
  await page.waitForFunction(()=>typeof renderSpecialBoardImage==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
}

test('Special Trade Board PNG is content-sized and ignores retired metadata and unavailable artwork',async({page})=>{
  await loadExporter(page);
  const fixture={
    lf:[
      {name:'Snom',dn:'Snom',no:872},
      {name:'Pikachu (Saree)',dn:'Pikachu (Saree)',no:25,shiny:true},
      {name:'Pikachu (Worlds 2026)',dn:'Pikachu (Worlds 2026)',no:25},
      {name:'Pikachu',dn:'Pikachu',no:25,backgroundId:'location-gofest2026chicago'},
      {name:'Eevee',dn:'Eevee',no:133,backgroundId:'location-gofestnewyorkcity',gender:'f'},
      {name:'Mewtwo',dn:'Mewtwo',no:150,backgroundId:'special-gofest2024wormhole',lucky:true},
      {name:'Basculin (White Stripe)',dn:'Basculin (White Stripe)',no:550,mirror:true},
      {name:'Avalugg (Hisuian Form)',dn:'Avalugg (Hisuian Form)',no:713,note:'Retired qualifier'},
      {name:'Jigglypuff (Ribbon)',dn:'Jigglypuff (Ribbon)',no:39,shiny:true,gender:'f'},
      {name:'Oricorio (Sensu)',dn:'Oricorio (Sensu Style)',no:741,gender:'m'}
    ],
    ft:[{name:'Dondozo',dn:'Dondozo',no:977,qty:2,lucky:true,backgroundId:'location-gofest2026chicago',note:'Retired metadata',mirror:true}]
  };
  const result=await page.evaluate(async board=>{
    const fallbackCalls=[],imageCalls=[];
    const originalFallback=drawSpriteFallback,originalImage=drawImageContain;
    drawSpriteFallback=(ctx,entry,...args)=>{fallbackCalls.push(entry.name);return originalFallback(ctx,entry,...args);};
    drawImageContain=(ctx,image,...args)=>{imageCalls.push([image.naturalWidth,image.naturalHeight]);return originalImage(ctx,image,...args);};
    try{
      const blob=await renderSpecialBoardImage(board,'FixtureTrainer');
      const drawableBoard={...board,lf:board.lf.filter(entry=>entry.name!=='Pikachu (Worlds 2026)')};
      const layout=PogoDomain.specialTradeBoardExport.buildLayout(drawableBoard);
      const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
      const pixels=context.getImageData(0,0,bitmap.width,bitmap.height).data;
      const colors=new Set();
      for(let index=0;index<pixels.length;index+=Math.max(4,Math.floor(pixels.length/3000/4)*4))colors.add(`${pixels[index]},${pixels[index+1]},${pixels[index+2]},${pixels[index+3]}`);
      const lfSection=layout.sections.find(section=>section.id==='lf');
      const markerColor=name=>{
        const index=drawableBoard.lf.findIndex(entry=>entry.name===name),card=lfSection.cards[index];
        const markerY=name==='Pikachu (Saree)'?7:2;
        return Array.from(context.getImageData(Math.round((card.x+card.width-11)*2),Math.round((card.y+markerY)*2),1,1).data);
      };
      return{width:bitmap.width,height:bitmap.height,expectedHeight:layout.height*2,bytes:blob.size,colorCount:colors.size,fallbackCalls,imageCalls:imageCalls.length,pikachuMarker:markerColor('Pikachu (Saree)'),jigglypuffMarker:markerColor('Jigglypuff (Ribbon)')};
    }finally{drawSpriteFallback=originalFallback;drawImageContain=originalImage;}
  },fixture);
  expect(result.width).toBe(1440);
  expect(result.height).toBe(result.expectedHeight);
  expect(result.bytes).toBeGreaterThan(20_000);
  expect(result.colorCount).toBeGreaterThan(8);
  expect(result.imageCalls).toBeGreaterThan(0);
  expect(result.fallbackCalls).toEqual([]);
  expect(result.pikachuMarker).toEqual([248,250,252,255]);
  expect(result.jigglypuffMarker).toEqual([248,250,252,255]);
});

test('Special Trade Board editor stays compact and touch-safe without retired controls',async({page})=>{
  await loadExporter(page);
  await page.evaluate(()=>{
    cur='BoardTester';
    allData.users=allData.users||{};
    allData.users[cur]={specialTradeBoard:{
      lf:[{name:'Eevee',dn:'Eevee',no:133,gender:'f',shiny:true,backgroundId:'location-gofest2026chicago',mirror:true,note:'Retired note'}],
      ft:[{name:'Mewtwo',dn:'Mewtwo',no:150,gender:'m',qty:12,lucky:true}]
    }};
    openSpecialTradeBoard();
  });
  for(const viewport of [{width:1440,height:900},{width:430,height:932},{width:390,height:844},{width:375,height:812},{width:320,height:568}]){
    await page.setViewportSize(viewport);
    const modal=page.locator('#special-board-modal .special-board-modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#special-board-modal .sb-row')).toHaveCount(2);
    await expect(page.locator('#special-board-modal .sb-row-gender')).toHaveCount(2);
    await expect(page.locator('#special-board-modal .sb-row-background,#special-board-modal .sb-row-note,#special-board-modal .sb-row-qty')).toHaveCount(0);
    await expect(page.locator('#special-board-modal [title*="Mirror"]')).toHaveCount(0);
    const geometry=await page.evaluate(()=>{
      const modal=document.querySelector('#special-board-modal .special-board-modal'),bounds=modal.getBoundingClientRect();
      const targets=[...modal.querySelectorAll('.special-board-add-row button,.sb-row button,.special-board-modal .mact button')].map(node=>{
        const box=node.getBoundingClientRect();return{width:box.width,height:box.height};
      });
      return{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,targets,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width+1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(viewport.height+1);
    expect(geometry.targets.every(target=>target.width>=44&&target.height>=44)).toBe(true);
  }
});
