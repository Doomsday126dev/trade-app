const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');

function imageHarness(locale='en'){
  const drawn=[],artRequests=[],window={};
  const context=vm.createContext({window,Date,Promise,Intl});
  for(const file of ['js/i18n/locales/en.js',`js/i18n/locales/${locale}.js`,'js/domain/priorityValues.js']){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  const ctx={font:'',fillStyle:'',textAlign:'left',scale(){},fillRect(){},measureText(text){return{width:String(text).length*6};},fillText(text,x,y){drawn.push({text:String(text),x,y});}};
  const canvas={width:0,height:0,getContext(){return ctx;},toBlob(done){done({type:'image/png',size:1024});}};
  const t=(key,values={})=>String(window.PogoLocales[locale][key]||key).replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''));
  Object.assign(context,{
    PogoDomain:window.PogoDomain,
    i18nCore:{t,getLocale:()=>locale},
    document:{createElement(){return canvas;}},
    entrySpriteUrl(entry,name,gender){artRequests.push({name,gender,catalogId:entry.catalogId});return entry.spriteUrl||name;},
    exportSpriteFallbackUrls:entry=>entry,
    loadCanvasImageWithFallback:async entry=>entry.noArt?null:entry,
    drawImageContain(_ctx,entry,x,y){drawn.push({image:entry.name,x,y});},
    drawFittedText(_ctx,text,x,y){drawn.push({text:String(text),x,y,fitted:true});},
    wantSectionLabel:section=>window.PogoDomain.priorityValues.wantSectionLabel(section,t)
  });
  const source=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
  const start=source.indexOf('function productShareImageDetails('),end=source.indexOf('\nfunction refreshAll()',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(source.slice(start,end),context);
  return{context,drawn,artRequests,canvas,t};
}

const entry=(name,values={})=>({name,dn:name,intent:'lf',p:'',...values});
const fixture=()=>[
  entry('Pikachu',{p:'H',shiny:true,gender:'f',note:'Saturday'}),
  entry('Polteageist',{p:'H',mod:'Antique',lucky:true,xxl:true}),
  entry('Raichu (Alolan)',{p:'M',gender:'m',catalogId:'raichu-alolan'}),
  entry('Snom',{p:'L'}),
  entry('Pikachu',{lucky:true}),
  entry('Eevee',{xxl:true}),
  entry('Flabébé',{xxs:true}),
  entry('Minior (Red)',{shiny:true}),
  entry('Pumpkaboo',{lucky:true,xxl:true}),
  entry('Unmapped',{noArt:true,mod:'Exact costume',note:'Keep this note'})
];

test('active export uses ordered priority and exact special sections without losing distinct wants',async()=>{
  const {context,drawn,artRequests,canvas}=imageHarness();
  const entries=fixture(),before=JSON.stringify(entries);
  await context.renderProductShareImage(entries,'Fixture');
  assert.equal(JSON.stringify(entries),before);
  assert.equal(canvas.width,1800);
  const text=drawn.filter(item=>'text' in item);
  for(const label of ['High','Medium','Low','Lucky','XXL','XXS','Shiny','Lucky · XXL','Needs priority']){
    const headers=text.filter(item=>item.text===label&&item.fitted);
    assert.equal(headers.length,1,label);
  }
  for(const label of ['High','Medium','Low'])assert.equal(text.filter(item=>item.text===label).length,1,label);
  const priorityY=['High','Medium','Low'].map(label=>text.find(item=>item.text===label).y);
  assert.ok(priorityY[0]<priorityY[1]&&priorityY[1]<priorityY[2]);
  const lucky=text.find(item=>item.text==='Lucky'&&item.fitted),combo=text.find(item=>item.text==='Lucky · XXL'&&item.fitted);
  assert.equal(lucky.y,combo.y,'small special sections share a compact band');
  assert.ok(lucky.x<combo.x,'special sections retain separate headings');
  assert.equal(drawn.filter(item=>item.image==='Pikachu').length,2,'priority and Lucky declarations both survive');
  const imageNames=drawn.filter(item=>item.image).map(item=>item.image);
  assert.equal(imageNames.length,entries.length-1);
  assert.ok(text.some(item=>item.text==='Unmapped'),'missing art still names the entry');
  assert.ok(text.map(item=>item.text).join(' ').includes('Antique'));
  assert.ok(text.map(item=>item.text).join(' ').includes('Alolan'));
  assert.equal(text.filter(item=>item.text==='✦').length,2,'shiny remains visible in priority and special wants');
  assert.ok(text.some(item=>item.text.includes('♀')));
  assert.ok(text.some(item=>item.text.includes('♂')));
  assert.ok(artRequests.some(item=>item.catalogId==='raichu-alolan'&&item.gender==='m'));
  assert.ok(text.every(item=>item.y<canvas.height/2),'all exact details fit within the exported image');
  assert.ok(!text.some(item=>item.text==='Other'||/Top want/.test(item.text)));
});

test('image details suppress only flags already supplied by the special section',()=>{
  const {context}=imageHarness();
  const wanted=entry('Pikachu',{p:'H',lucky:true,xxl:true,gender:'f',mod:'Antique',note:'Keep note'});
  assert.equal(context.productShareImageDetails(wanted,{priority:'H',flags:[]}), '♀ · Antique · Lucky · XXL · Keep note');
  assert.equal(context.productShareImageDetails({...wanted,p:''},{priority:'',flags:['lucky','xxl']}),'♀ · Antique · Keep note');
  assert.equal(context.productShareImageDetails(entry('Charmander',{category:'dynamax'}),{priority:'M',flags:[]}),'Dynamax');
  assert.equal(context.productShareImageDetails(entry('Charizard',{category:'gmax'}),{priority:'L',flags:[]}),'Gigantamax');
  assert.equal(context.productShareImageDetails(entry('Eevee',{gender:'f',mod:'F'}),{priority:'M',flags:[]}),'♀');
  assert.equal(context.productShareImageDetails(entry('Eevee',{mod:'M'}),{priority:'H',flags:[]}),'♂');
  assert.equal(context.productShareImageDetails(entry('Eevee',{gender:'f',mod:'F, Antique'}),{priority:'M',flags:[]}),'♀ · F, Antique');
});

for(const locale of ['en','ja','es','de'])test(`export and workflow terminology follow ${locale} without changing stored priorities`,async()=>{
  const {context,drawn,t}=imageHarness(locale);
  await context.renderProductShareImage(fixture(), 'Fixture');
  for(const key of ['priority.high','priority.medium','priority.low','workflow.needsPriority']){
    assert.equal(drawn.filter(item=>item.text===t(key)&&item.fitted).length,1,key);
  }
  assert.equal(t('phase2.top'),t('priority.high'));
  assert.equal(t('phase2.topWant'),t('priority.high'));
  const en=imageHarness().context.window.PogoLocales.en,own=context.window.PogoLocales[locale];
  for(const key of Object.keys(en).filter(key=>key.startsWith('workflow.'))){
    assert.ok(own[key],key);
    assert.deepEqual([...own[key].matchAll(/\{\w+\}/g)].map(match=>match[0]).sort(),[...en[key].matchAll(/\{\w+\}/g)].map(match=>match[0]).sort(),key);
  }
});
