const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.join(__dirname,'..');

function loadVisualDomain(){
  const window={PogoDomain:{}};
  vm.runInNewContext(readFileSync(path.join(root,'js','domain','backgroundVisual.js'),'utf8'),{window});
  return window.PogoDomain.backgroundVisual;
}

test('background artwork fails closed unless an exact canonical ID is approved',()=>{
  const visuals=loadVisualDomain();
  assert.equal(visuals.schemaVersion,2);
  assert.equal(visuals.resolve('location-gofest2026chicago'),null);
  assert.equal(visuals.resolve('special-go-wild-area-global'),null);
  assert.equal(visuals.resolve('not valid'),null);
  assert.equal(visuals.resolve(''),null);
  assert.equal(visuals.className(null),'');
  assert.equal(visuals.style(null),'');

  for(const [id,visual] of Object.entries(visuals.approvedArtwork)){
    assert.equal(visuals.resolve(id),visual);
    assert.equal(visual.id,id);
    assert.match(visual.assetUrl,/^(?:assets\/|https:\/\/)/);
    assert.equal(visuals.className(visual),'background-artwork-exact');
    assert.match(visuals.style(visual),/^--background-artwork:url\("[^"]+"\)$/);
  }
});

test('all background surfaces use exact artwork or an honest compact label',()=>{
  const source=readFileSync(path.join(root,'js','app','application.js'),'utf8');
  const share=readFileSync(path.join(root,'js','app','publicShareApp.js'),'utf8');
  const visualSource=readFileSync(path.join(root,'js','domain','backgroundVisual.js'),'utf8');
  const css=readFileSync(path.join(root,'css','app.css'),'utf8');
  const inventory=JSON.parse(readFileSync(path.join(root,'scripts','pages','frontend-files.json'),'utf8'));
  const sw=readFileSync(path.join(root,'sw.js'),'utf8');

  for(const contract of [
    'function backgroundVisualMotifHtml',
    'function backgroundBadgeHtml',
    'class="myrow${',
    'class="share-pcard card-row${',
    'class="diff-card${',
    'class="diff-match-chip ',
    'class="sb-row${',
    'specialTradeBoardExportDomain.badgeTokens',
    'drawExportEntryNoteLabel'
  ])assert.ok(source.includes(contract),`missing background contract: ${contract}`);
  assert.match(source,/backgroundShortLabel\(e\.backgroundId\)/);
  assert.match(share,/background-badge-kind[^>]*aria-hidden="true">BG/);
  assert.match(css,/\.background-artwork-exact/);
  assert.match(css,/var\(--background-artwork\)/);

  const combined=`${source}\n${share}\n${visualSource}\n${css}`;
  assert.doesNotMatch(combined,/background-pattern-|drawExportBackgroundVisual/);
  assert.doesNotMatch(visualSource,/hashString|PALETTES|PATTERNS|linear-gradient/);
  assert.ok(inventory.scriptFiles.includes('js/domain/backgroundVisual.js'));
  assert.ok(inventory.lazyScriptFiles.includes('js/domain/specialTradeBoardExport.js'));
  assert.match(sw,/'js\/domain\/backgroundVisual\.js'/);
  assert.match(sw,/'js\/domain\/specialTradeBoardExport\.js'/);
});

test('localized legal copy describes the exact-art-or-label contract',()=>{
  const expectations={
    en:'Background qualifiers are shown as labels unless exact, approved artwork is available for that background.',
    ja:'背景修飾は、その背景に正確に対応する承認済み画像がある場合を除き、ラベルで表示します。',
    es:'Los fondos se muestran como etiquetas salvo que exista una imagen exacta y aprobada para ese fondo.',
    de:'Hintergründe werden als Kennzeichnung angezeigt, sofern keine exakt passende, freigegebene Grafik vorliegt.'
  };
  const index=readFileSync(path.join(root,'index.html'),'utf8');
  for(const [locale,copy] of Object.entries(expectations)){
    assert.ok(index.includes(copy),`missing bootstrap ${locale} background contract`);
    assert.ok(readFileSync(path.join(root,'js','i18n','locales',`${locale}.js`),'utf8').includes(copy),`missing ${locale} background contract`);
  }
  assert.doesNotMatch(index,/catalog ID.*(?:color|pattern)|colores y patrones|独自の色とパターン|HintergrÃ/i);
});
