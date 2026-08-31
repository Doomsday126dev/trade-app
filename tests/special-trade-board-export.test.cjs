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

test('export domain owns only content-derived dense geometry',()=>{
  const domain=loadDomain();
  assert.equal(domain.schemaVersion,2);
  assert.deepEqual(Object.keys(domain).sort(),['buildLayout','columnsFor','metrics','schemaVersion']);
});

test('canvas renderer uses reviewed sprites with unambiguous starbursts and aligned vector gender badges',()=>{
  const source=readFileSync(path.join(root,'js','app','application.js'),'utf8');
  const start=source.indexOf('async function renderSpecialBoardImage');
  const end=source.indexOf('// ── READ-ONLY SHARE VIEW',start);
  const renderer=source.slice(start,end);
  assert.match(source,/function ensureSpecialTradeBoardExportDomain\(\)/);
  assert.match(source,/specialTradeBoardExport\.js\?v=\$\{encodeURIComponent\(window\.__POGO_RELEASE_ID\|\|''\)\}/);
  assert.match(renderer,/specialTradeBoardExportDomain\.buildLayout\(drawableBoard\)/);
  assert.match(renderer,/drawShinySparkles/);
  assert.match(renderer,/drawStarburst/);
  assert.doesNotMatch(renderer,/drawDiamond|shadowBlur/);
  assert.match(renderer,/drawStarburst\(x\+6,y\+2,2\.4,\.65,'#67e8f9'\)/);
  assert.match(renderer,/drawShinySparkles\(x\+w-11,y\+1\)/);
  assert.doesNotMatch(renderer,/drawStarburst\(x-5\.2,y\+4\.4/);
  assert.match(renderer,/drawGenderMarker/);
  const genderMarker=renderer.slice(renderer.indexOf('const drawGenderMarker'),renderer.indexOf('const drawEntryMarkers'));
  assert.match(genderMarker,/roundedRect\(ctx,x-7,y-7,14,14,4\)/);
  assert.match(genderMarker,/ctx\.arc/);
  assert.match(genderMarker,/ctx\.moveTo/);
  assert.match(genderMarker,/ctx\.lineTo/);
  assert.doesNotMatch(genderMarker,/fillText|['"]F['"]|['"]M['"]/);
  assert.match(renderer,/filter\(entry=>imgMap\.has\(boardEntryImageKey\(entry\)\)\)/);
  assert.match(source,/const mappedHome=/);
  assert.match(source,/other\/home\/\$\{id\}\.png/);
  assert.match(source,/const highQuality=\[\.\.\.mappedHome,\.\.\.publicSpriteUrls/);
  assert.doesNotMatch(renderer,/drawWrappedText\(ctx,e\.dn\|\|e\.name/);
  assert.match(renderer,/exportSpriteFallbackUrls/);
  assert.match(renderer,/drawImageContain/);
  assert.doesNotMatch(renderer,/drawSpriteFallback|Artwork pending|backgroundShortLabel|· BG|backgroundId|backgroundImageMap|drawBackgroundArtwork/);
  assert.doesNotMatch(renderer,/drawMirrorMarker|drawQuantityMarker|drawLuckyMarker|entry\.mirror|entry\.qty|entry\.lucky|e\.note|entry\.note/);
  assert.doesNotMatch(renderer,/drawExportBackgroundVisual|background-pattern|linearGradient|createPattern|hashString/);
});

test('Board editor presents only artwork, gender, Shiny, and removal controls',()=>{
  const source=readFileSync(path.join(root,'js','app','application.js'),'utf8');
  const start=source.indexOf('function renderSpecialBoard()');
  const end=source.indexOf('async function clearSpecialBoard()',start);
  const editor=source.slice(start,end);
  assert.match(editor,/sb-row-gender/);
  assert.match(editor,/toggleSpecialFlag\('\$\{side\}',\$\{i\},'shiny'\)/);
  assert.match(editor,/sb-row-rm/);
  assert.doesNotMatch(editor,/sb-row-background|setSpecialBackground|sb-row-note|setSpecialNote|sb-row-qty|setSpecialQty|mirror/);
  const globals=source.slice(source.indexOf('Object.assign(window,{'));
  assert.doesNotMatch(globals,/setSpecialBackground|setSpecialNote|setSpecialQty/);
});
