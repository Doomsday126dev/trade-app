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
  await page.waitForFunction(()=>typeof renderSpecialBoardImage==='function');
}

test('Special Trade Board PNG is content-sized, nonblank, and preserves exact sprite fallbacks',async({page})=>{
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
      {name:'Avalugg (Hisuian Form)',dn:'Avalugg (Hisuian Form)',no:713,note:'Long qualifier note'},
      {name:'Jigglypuff (Ribbon)',dn:'Jigglypuff (Ribbon)',no:39,shiny:true,gender:'f'}
    ],
    ft:[{name:'Pikachu (Saree)',dn:'Pikachu (Saree)',no:25,qty:2,lucky:true,backgroundId:'location-gofest2026chicago'}]
  };
  const result=await page.evaluate(async board=>{
    const fallbackCalls=[],imageCalls=[];
    const originalFallback=drawSpriteFallback,originalImage=drawImageContain;
    drawSpriteFallback=(ctx,entry,...args)=>{fallbackCalls.push(entry.name);return originalFallback(ctx,entry,...args);};
    drawImageContain=(ctx,image,...args)=>{imageCalls.push([image.naturalWidth,image.naturalHeight]);return originalImage(ctx,image,...args);};
    try{
      const blob=await renderSpecialBoardImage(board,'FixtureTrainer');
      const layout=PogoDomain.specialTradeBoardExport.buildLayout(board);
      const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
      const pixels=context.getImageData(0,0,bitmap.width,bitmap.height).data;
      const colors=new Set();
      for(let index=0;index<pixels.length;index+=Math.max(4,Math.floor(pixels.length/3000/4)*4))colors.add(`${pixels[index]},${pixels[index+1]},${pixels[index+2]},${pixels[index+3]}`);
      return{width:bitmap.width,height:bitmap.height,expectedHeight:layout.height*2,bytes:blob.size,colorCount:colors.size,fallbackCalls,imageCalls:imageCalls.length};
    }finally{drawSpriteFallback=originalFallback;drawImageContain=originalImage;}
  },fixture);
  expect(result.width).toBe(1440);
  expect(result.height).toBe(result.expectedHeight);
  expect(result.bytes).toBeGreaterThan(20_000);
  expect(result.colorCount).toBeGreaterThan(8);
  expect(result.imageCalls).toBeGreaterThan(0);
  expect(result.fallbackCalls).toContain('Pikachu (Worlds 2026)');
  expect(result.fallbackCalls).not.toContain('Pikachu (Saree)');
});
