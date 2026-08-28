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

test('background visuals are stable, local, and derived from canonical IDs',()=>{
  const visuals=loadVisualDomain();
  const record={type:'location'};
  const first=visuals.resolve('location-gofestnewyorkcity',record);
  const second=visuals.resolve('location-gofestnewyorkcity',record);
  const other=visuals.resolve('location-gofestosaka',record);

  assert.deepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(JSON.stringify(second)));
  assert.notDeepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(JSON.stringify(other)));
  assert.match(first.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(visuals.patterns.includes(first.pattern));
  assert.match(visuals.style(first),/^--background-visual-a:#[0-9a-f]{6};--background-visual-b:#[0-9a-f]{6};--background-visual-c:#[0-9a-f]{6}$/);
  assert.doesNotMatch(JSON.stringify(first),/https?:|url\(|data:/i);
});

test('special and location visuals use distinct, bounded presentation contracts',()=>{
  const visuals=loadVisualDomain();
  const location=visuals.resolve('location-gofestnewyorkcity',{type:'location'});
  const special=visuals.resolve('special-go-wild-area-global',{type:'special'});

  assert.equal(location.type,'location');
  assert.equal(special.type,'special');
  assert.match(visuals.className(location),/^background-visual-location background-pattern-/);
  assert.match(visuals.className(special),/^background-visual-special background-pattern-/);
  assert.equal(visuals.resolve('not valid',{type:'location'}),null);
  assert.equal(visuals.resolve('',{type:'location'}),null);
});

test('background visual treatment reaches every supported product surface and export',()=>{
  const source=readFileSync(path.join(root,'js','app','application.js'),'utf8');
  const css=readFileSync(path.join(root,'css','app.css'),'utf8');
  const inventory=JSON.parse(readFileSync(path.join(root,'scripts','pages','frontend-files.json'),'utf8'));
  const sw=readFileSync(path.join(root,'sw.js'),'utf8');

  for(const contract of [
    'function backgroundVisualMotifHtml',
    'function backgroundBadgeHtml',
    'function drawExportBackgroundVisual',
    'class="myrow${',
    'class="share-pcard card-row${',
    'class="diff-card${',
    'class="diff-match-chip ',
    'class="sb-row${'
  ])assert.ok(source.includes(contract),`missing visual contract: ${contract}`);
  assert.match(source,/drawExportBackgroundVisual\(ctx,e,[^\n]+\{dark:true/);
  const editor=source.slice(source.indexOf('function myListEditorHtml('),source.indexOf('function hydrateMyRowEditor('));
  assert.match(editor,/const jsDn=escAttr\(String\(dn\)/);
  assert.match(editor,/openBackgroundPicker\(\{target:'entry',name:'\$\{jsName\}',pokemonName:'\$\{jsDn\}'\}\)/);
  assert.match(css,/\.background-visual-card\{/);
  assert.match(css,/\.background-visual-swatch\{/);
  assert.match(css,/\.background-pattern-(?:horizon|rings|prism|constellation)/);
  assert.ok(inventory.scriptFiles.includes('js/domain/backgroundVisual.js'));
  assert.match(sw,/'js\/domain\/backgroundVisual\.js'/);
});
