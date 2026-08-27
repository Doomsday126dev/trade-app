const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const NEW_YORK='location-gofestnewyorkcity';
const OSAKA='location-gofestosaka';

function loadDomain(){
  const window={PogoDomain:{}};
  const context=vm.createContext({window,Intl});
  for(const file of ['js/domain/backgroundCatalog.js','js/domain/priorityValues.js','js/domain/pokemonKeys.js']){
    vm.runInContext(readFileSync(path.join(root,file),'utf8'),context);
  }
  return window.PogoDomain;
}
const domain=loadDomain();

function compatible(wantName,want,haveName,have){
  return wantName===haveName&&domain.priorityValues.matchesTradeIntent(want,have);
}

test('legacy priority values remain byte-compatible and background values round-trip',()=>{
  const values=['H','M(F)','L[lucky][shiny][xxl][xxs](winter costume)','[shiny]'];
  for(const value of values){
    const parsed=domain.priorityValues.parsePri(value);
    assert.equal(parsed.backgroundId,'');
    assert.equal(domain.priorityValues.priValue(parsed.p,parsed.mod,parsed.lucky,parsed.xxl,parsed.xxs,parsed.shiny),value);
  }
  const encoded=domain.priorityValues.priValue('H','F',false,false,false,true,NEW_YORK);
  assert.equal(encoded,`H[shiny][bg:${NEW_YORK}](F)`);
  assert.deepEqual(JSON.parse(JSON.stringify(domain.priorityValues.parsePri(encoded))),{
    p:'H',mod:'F',lucky:false,xxl:false,xxs:false,shiny:true,backgroundId:NEW_YORK
  });
});

test('unknown future IDs remain stable while malformed and ambiguous IDs fail safely',()=>{
  assert.equal(domain.priorityValues.parsePri('H[bg:future-event-2030]').backgroundId,'future-event-2030');
  assert.equal(domain.priorityValues.parsePri('H[bg:NOT VALID]').backgroundId,'');
  assert.equal(domain.priorityValues.parsePri(`H[bg:${NEW_YORK}][bg:${OSAKA}]`).backgroundId,'');
  assert.equal(domain.backgroundCatalog.get('future-event-2030'),null);
  assert.equal(domain.backgroundCatalog.display('future-event-2030'),'future-event-2030');
});

test('generic wants accept background inventory while specific wants require exact identity',()=>{
  const matches=domain.priorityValues.matchesTradeIntent;
  assert.equal(matches({p:'H'},{backgroundId:NEW_YORK}),true);
  assert.equal(matches({p:'H',backgroundId:NEW_YORK},{backgroundId:NEW_YORK}),true);
  assert.equal(matches({p:'H',backgroundId:NEW_YORK},{backgroundId:OSAKA}),false);
  assert.equal(matches({p:'H',backgroundId:NEW_YORK},{}),false);
});

test('background composes with shiny, gender, and exact form identity',()=>{
  const want={p:'H',mod:'F',shiny:true,backgroundId:NEW_YORK};
  assert.equal(compatible('Pikachu',want,'Pikachu',{gender:'f',shiny:true,backgroundId:NEW_YORK}),true);
  assert.equal(compatible('Pikachu',want,'Pikachu',{gender:'f',shiny:false,backgroundId:NEW_YORK}),false);
  assert.equal(compatible('Pikachu',want,'Pikachu',{gender:'m',shiny:true,backgroundId:NEW_YORK}),false);
  assert.equal(compatible('Pikachu',want,'Pikachu (Libre)',{gender:'f',shiny:true,backgroundId:NEW_YORK}),false);
  assert.equal(compatible('Pikachu (Libre)',{backgroundId:NEW_YORK},'Pikachu (Libre)',{backgroundId:NEW_YORK}),true);
});

test('legacy Have numbers stay numeric and structured qualifiers preserve canonical IDs',()=>{
  assert.equal(domain.pokemonKeys.haveEntryValue(3,0),3);
  const value=domain.pokemonKeys.haveEntryValue(2,0,{backgroundId:NEW_YORK,shiny:true});
  assert.deepEqual(JSON.parse(JSON.stringify(value)),{qty:2,backgroundId:NEW_YORK,shiny:true});
  assert.deepEqual(JSON.parse(JSON.stringify(domain.pokemonKeys.haveEntryInfo(value))),{
    qty:2,mirrorOnly:false,dontNeedBack:false,giveaway:false,note:'',mode:'any',backgroundId:NEW_YORK,shiny:true,lucky:false,xxl:false,xxs:false
  });
});

test('one qualifier flows through product rows, matching, board, and exports',()=>{
  for(const marker of [
    'id="add-pmon-background"','function openBackgroundPicker','function setBackground(',
    'backgroundBadgeHtml(backgroundId','function renderShareView(username,type)',
    'function computeTradeMatchSummary','tradeListComparisonDomain.compareWantedLists',
    'function setSpecialBackground','class="sb-row-background',
    "'Background ID','Background'",'backgroundDisplayName(e.backgroundId)',
    'function exportEntryNoteLabel','drawExportEntryNoteLabel'
  ])assert.ok(html.includes(marker),`missing ${marker}`);
});

test('picker is released-only, keyboard-usable, relevant-first, and incrementally rendered',()=>{
  const picker=html.slice(html.indexOf('<!-- BACKGROUND PICKER -->'),html.indexOf('<!-- READ-ONLY SHARE VIEW'));
  const logic=html.slice(html.indexOf('let _backgroundPickerContext'),html.indexOf('// ── UNDO'));
  assert.match(picker,/role="combobox"/);
  assert.match(picker,/role="listbox"/);
  assert.match(logic,/aria-activedescendant/);
  assert.match(picker,/data-background-filter="relevant"/);
  assert.match(picker,/data-background-filter="all"/);
  assert.match(picker,/id="background-show-more"/);
  assert.match(logic,/backgroundCatalogDomain\.search\(query,\{pokemonName:pokemon,limit:500\}\)/);
  assert.match(logic,/record\.pokemon\.length>0&&!relevant/);
  assert.match(logic,/background\.notListed/);
  assert.match(logic,/records\.slice\(0,_backgroundPickerVisibleLimit\)/);
  assert.match(logic,/event\.key==='ArrowDown'/);
  assert.match(logic,/event\.key!=='ArrowUp'/);
  assert.match(logic,/event\.key==='Enter'/);
  assert.match(logic,/event\.key==='Escape'/);
  assert.doesNotMatch(logic,/includeCandidates:true/);
});

test('Pokémon GO search strings remain valid by deliberately ignoring background IDs',()=>{
  const strings=html.slice(html.indexOf('function buildStrings('),html.indexOf('function myListSearchLabel('));
  assert.doesNotMatch(strings,/\[bg:|backgroundDisplayName|backgroundShortLabel/);
  assert.match(strings,/dexStringFromNumbers|entrySearchFilters/);
});
