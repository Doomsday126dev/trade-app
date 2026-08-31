const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.join(__dirname,'..');

function loadDomain(){
  const window={PogoDomain:{}};
  vm.runInNewContext(readFileSync(path.join(root,'js','domain','specialTradeBoardExport.js'),'utf8'),{window});
  return window.PogoDomain.specialTradeBoardExport;
}

function entries(count,prefix='Entry'){
  return Array.from({length:count},(_,index)=>({name:`${prefix} ${index+1}`,dn:`${prefix} ${index+1}`}));
}

function assertBounded(layout){
  assert.ok(layout.height>layout.headerHeight);
  for(const section of layout.sections){
    assert.ok(section.header.x>=layout.padding);
    assert.ok(section.header.x+section.header.width<=layout.width-layout.padding+0.01);
    assert.equal(section.cards.length,section.count);
    for(const card of section.cards){
      assert.ok(card.x>=layout.padding);
      assert.ok(card.y>=section.header.y+section.header.height+layout.sectionHeaderGap);
      assert.ok(card.x+card.width<=layout.width-layout.padding+0.01);
      assert.ok(card.y+card.height<=section.bottom+0.01);
    }
    for(let left=0;left<section.cards.length;left++)for(let right=left+1;right<section.cards.length;right++){
      const a=section.cards[left],b=section.cards[right];
      const overlaps=a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
      assert.equal(overlaps,false,`${section.id} cards ${left} and ${right} overlap`);
    }
  }
  const last=layout.sections.at(-1);
  if(last)assert.equal(layout.height,Math.ceil(last.bottom+layout.bottomPadding+layout.footerHeight));
}

test('layout is content-sized for 1/1, 9/1, dense, and single-lane boards',()=>{
  const domain=loadDomain();
  const fixtures=[
    {lf:entries(1,'LF'),ft:entries(1,'FT')},
    {lf:entries(9,'LF'),ft:entries(1,'FT')},
    {lf:entries(17,'LF'),ft:entries(14,'FT')},
    {lf:entries(7,'LF'),ft:[]},
    {lf:[],ft:entries(5,'FT')}
  ];
  for(const fixture of fixtures)assertBounded(domain.buildLayout(fixture));

  const compact=domain.buildLayout(fixtures[0]);
  assert.equal(compact.columns,12);
  assert.equal(compact.entryCount,2);
  assert.deepEqual(Array.from(compact.sections,section=>section.rows),[1,1]);

  const nineOne=domain.buildLayout(fixtures[1]);
  assert.equal(nineOne.columns,12);
  assert.equal(nineOne.entryCount,10);
  assert.deepEqual(Array.from(nineOne.sections,section=>section.rows),[1,1]);
  assert.equal(nineOne.sections[1].cards.length,1);
  assert.equal(nineOne.sections[1].bottom,nineOne.sections[1].cards[0].y+nineOne.cardHeight);
});

test('qualifier tokens cover required Board combinations without inventing artwork',()=>{
  const domain=loadDomain();
  const tokens=domain.badgeTokens({shiny:true,lucky:true,mirror:true,qty:3,note:'Needs room'}, {backgroundLabel:'Chicago 2026',gender:'f'});
  assert.deepEqual(Array.from(tokens,token=>[token.kind,token.label,token.marker||'']),[
    ['background','Chicago 2026 · BG',''],['shiny','Shiny','sparkles'],['gender','Female','f'],['lucky','Lucky','lucky'],['mirror','Mirror','mirror'],['quantity','×3',''],['note','Needs room','']
  ]);
  assert.deepEqual(Array.from(domain.badgeTokens({}, {backgroundLabel:'New York City'}),token=>token.label),['New York City · BG']);
  assert.deepEqual(Array.from(domain.badgeTokens({}, {backgroundLabel:'GO Wild Area'}),token=>token.label),['GO Wild Area · BG']);
  assert.deepEqual(Array.from(domain.badgeTokens({note:'Female'}, {gender:'f'}),token=>token.label),['Female']);
  assert.deepEqual(Array.from(domain.badgeTokens({lucky:true,note:'Lucky'}),token=>token.label),['Lucky']);
});

test('badge geometry never crosses the card and reports bounded overflow',()=>{
  const domain=loadDomain();
  const tokens=domain.badgeTokens({shiny:true,lucky:true,mirror:true,qty:12,note:'A deliberately long qualifier note'}, {backgroundLabel:'Chicago 2026',gender:'f'});
  const x=8,y=58,width=120;
  const plan=domain.layoutBadgeRows(tokens,{x,y,width,measure:value=>String(value).length*4.4});
  assert.ok(plan.placements.length>0);
  assert.ok(plan.rows<=1);
  for(const placement of plan.placements){
    assert.ok(placement.x>=x);
    assert.ok(placement.x+placement.width<=x+width+0.01);
    assert.ok(placement.y>=y);
    assert.ok(placement.y+placement.height<=y+13);
  }
  for(let index=1;index<plan.placements.length;index++){
    const previous=plan.placements[index-1],current=plan.placements[index];
    if(previous.row===current.row)assert.ok(previous.x+previous.width<=current.x);
  }
  assert.ok(plan.hiddenCount>=1);
  const overflow=plan.placements.find(placement=>placement.token.kind==='overflow');
  if(overflow)assert.match(overflow.label,/^\+\d+$/);
});

test('compact marker semantics do not depend on font glyphs',()=>{
  const domain=loadDomain();
  const tokens=domain.badgeTokens({shiny:true,lucky:true,mirror:true,qty:2},{backgroundLabel:'Chicago 2026',gender:'m'});
  assert.deepEqual(Array.from(tokens.filter(token=>token.marker),token=>[token.kind,token.marker]),[
    ['shiny','sparkles'],['gender','m'],['lucky','lucky'],['mirror','mirror']
  ]);
  assert.equal(tokens.some(token=>token.symbol),false);
  assert.equal(tokens.find(token=>token.kind==='background').label,'Chicago 2026 · BG');
});

test('canvas renderer uses the accepted sprite resolver and pure geometry contract',()=>{
  const source=readFileSync(path.join(root,'js','app','application.js'),'utf8');
  const start=source.indexOf('async function renderSpecialBoardImage');
  const end=source.indexOf('// ── READ-ONLY SHARE VIEW',start);
  const renderer=source.slice(start,end);
  assert.match(source,/function ensureSpecialTradeBoardExportDomain\(\)/);
  assert.match(source,/specialTradeBoardExport\.js\?v=\$\{encodeURIComponent\(window\.__POGO_RELEASE_ID\|\|''\)\}/);
  assert.match(renderer,/specialTradeBoardExportDomain\.buildLayout\(board\)/);
  assert.match(renderer,/drawSparkleCluster/);
  assert.match(renderer,/drawGenderMarker/);
  assert.match(renderer,/drawBackgroundFrame/);
  assert.match(renderer,/backgroundImageMap\.get\(id\)/);
  assert.match(renderer,/const label=`\$\{backgroundShortLabel\(id\)\|\|'Background'\} · BG`/);
  assert.match(source,/const mappedHome=/);
  assert.match(source,/other\/home\/\$\{id\}\.png/);
  assert.match(source,/const highQuality=\[\.\.\.mappedHome,\.\.\.publicSpriteUrls/);
  assert.doesNotMatch(renderer,/drawWrappedText\(ctx,e\.dn\|\|e\.name/);
  assert.match(renderer,/exportSpriteFallbackUrls/);
  assert.match(renderer,/drawImageContain/);
  assert.match(renderer,/drawSpriteFallback/);
  assert.match(renderer,/backgroundShortLabel\(e\.backgroundId\)/);
  assert.doesNotMatch(renderer,/drawExportBackgroundVisual|background-pattern|linearGradient|createPattern|hashString/);
});
