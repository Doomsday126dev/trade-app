const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

const root=join(__dirname,'..');

function harness(){
  const window={};
  vm.runInNewContext(readFileSync(join(root,'js/domain/specialTradeBoardExport.js'),'utf8'),{window,Date,Promise});
  const drawn=[];
  const ctx={font:'',fillStyle:'',strokeStyle:'',lineWidth:1,textAlign:'left',scale(){},fillRect(){},strokeRect(){},measureText(text){return{width:String(text).length*8};},fillText(text,x,y){drawn.push({text:String(text),x,y});}};
  const canvas={width:0,height:0,getContext(){return ctx;}};
  return{domain:window.PogoDomain.productSharePhoneExport,drawn,canvas,ctx};
}

test('phone sheet keeps all 70 entries ordered and all distinguishing label text',async()=>{
  const {domain,drawn,canvas}=harness();
  const entries=Array.from({length:70},(_,index)=>({intent:'lf',p:index<24?'H':index<47?'M':'L',name:`Entry ${String(index+1).padStart(2,'0')}`}));
  entries[0].dn='Pikachu with an exceptionally long distinguishing fossil costume label';
  entries[69].missing=true;
  const sectionsFor=list=>['H','M','L'].map(priority=>({priority,flags:[],entries:list.filter(entry=>entry.p===priority)}));
  await domain.render({
    entries,owner:'Fixture',sectionsFor,sectionLabel:section=>({H:'High',M:'Medium',L:'Low'})[section.priority],
    detailsFor:entry=>entry===entries[0]?'Female · Shiny · Keep exact form wording':entry===entries[1]?'Saturday\u2028After 3 pm':'',loadImage:async entry=>entry.missing?null:entry,
    drawImage(_ctx,image,x,y){drawn.push({image:image.name,x,y});},createCanvas:()=>canvas,toBlob:async()=>({type:'image/png'}),
    locale:'en',titleLabel:'Looking For',countLabel:count=>`${count} Pokémon`,missingArtLabel:'Art unavailable'
  });
  assert.equal(drawn.filter(item=>item.image).length,69);
  assert.ok(drawn.filter(item=>item.text).map(item=>item.text).join('').replaceAll(' ','').includes('Artunavailable'));
  for(let index=1;index<70;index++)assert.ok(drawn.some(item=>item.text?.includes(`Entry ${String(index+1).padStart(2,'0')}`)),`entry ${index+1}`);
  assert.equal(drawn.filter(item=>['High','Medium','Low'].includes(item.text)).length,3);
  assert.ok(drawn.find(item=>item.text==='High').y<drawn.find(item=>item.text==='Medium').y);
  assert.ok(drawn.find(item=>item.text==='Medium').y<drawn.find(item=>item.text==='Low').y);
  const orderedY=entries.map((entry,index)=>index<69?drawn.find(item=>item.image===entry.name).y:drawn.find(item=>item.text===entry.name).y);
  assert.ok(orderedY.every((y,index)=>index===0||y>orderedY[index-1]),'entries remain visually ordered from first through seventieth');
  assert.equal(domain.metrics.width,420);
  assert.equal(domain.metrics.columns,1);
  assert.equal(canvas.width,840);
  assert.ok(canvas.height>1000&&canvas.height<24000,'70 entries fit below the 12000 logical-pixel cap');
  assert.ok(domain.metrics.nameFontSize*390/domain.metrics.width>=12,'name text remains at least 12px when fit to a 390px phone');
  assert.ok(!drawn.some(item=>item.text?.includes('…')));
  const firstNoteLine=drawn.find(item=>item.text==='Saturday'),secondNoteLine=drawn.find(item=>item.text==='After 3 pm');
  assert.ok(firstNoteLine&&secondNoteLine,'published note line separator remains visible in the phone export');
  assert.equal(secondNoteLine.x,firstNoteLine.x);assert.equal(secondNoteLine.y-firstNoteLine.y,domain.metrics.lineHeight);
  assert.equal(drawn.some(item=>item.text==='Saturday After 3 pm'),false);
});

test('wrapping breaks long words without truncating them',()=>{
  const {domain,ctx}=harness();
  const label='VeryLongExactFormIdentityWithoutSpaces';
  assert.equal(domain.wrapText(ctx,label,64).join(''),label);
  assert.deepEqual(Array.from(domain.wrapText(ctx,'Saturday\u2028After 3 pm',256)),['Saturday','After 3 pm']);
});

test('Share image UI keeps compact export and exposes an accessible phone option',()=>{
  const html=readFileSync(join(root,'index.html'),'utf8');
  const app=readFileSync(join(root,'js/app/application.js'),'utf8');
  assert.match(html,/<button[^>]+aria-pressed="true"[^>]+data-product-image-format="compact"/);
  assert.match(html,/<button[^>]+aria-pressed="false"[^>]+data-product-image-format="phone"/);
  assert.match(app,/productShareImageFormat==='phone'/);
  assert.match(app,/ensureProductSharePhoneExportDomain\(\)/);
  assert.match(app,/function ensureProductSharePhoneExportDomain\(\)[\s\S]+ensureSpecialTradeBoardExportDomain\(\)\.then/);
  assert.doesNotMatch(app,/js\/domain\/productSharePhoneExport\.js/);
  assert.match(app,/phoneExport\.render/);
});
