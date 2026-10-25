const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const index=readFileSync(path.join(root,'index.html'),'utf8');
const provenance=readFileSync(path.join(root,'docs/ASSET-DATA-PROVENANCE.md'),'utf8');

test('visual avatar picker uses the canonical catalog lazily and keeps string persistence',()=>{
  const picker=html.slice(html.indexOf('let avatarPickerEntriesCache'),html.indexOf('// Build a <img>'));
  assert.match(picker,/pokemonCatalogDomain\.canonicalizeEntries/);
  assert.match(picker,/spriteLookupKeys\?\.some\(isUnresolvedSpriteKey\)/);
  assert.match(picker,/\.slice\(0,q\?48:24\)/);
  assert.match(picker,/role="option"/);assert.match(picker,/avatarPickerKeydown/);assert.match(picker,/ArrowDown/);assert.match(picker,/onclick="selectAvatarOption\(this\.dataset\.catalogId\)"/);
  const profile=html.slice(html.indexOf('data-settings-section="profile"'),html.indexOf('data-settings-section="language"'));
  assert.match(profile,/<input type="hidden" id="prof-av-input">/);assert.doesNotMatch(profile,/id="prof-av-list"|<datalist/);
  const save=html.slice(html.indexOf('async function saveProfile'),html.indexOf('async function savePinSettings'));
  assert.match(save,/avatarPokemon:raw\.avatarPokemon\.trim\(\)/);
  assert.match(save,/upd=\{friendCode:raw\.friendCode\.trim\(\),bio:raw\.bio\.trim\(\),discord:raw\.discord\.trim\(\),avatarPokemon:raw\.avatarPokemon\.trim\(\)\}/);
});

test('legacy and unknown avatar values retain safe compatibility behavior',()=>{
  const lookup=html.slice(html.indexOf('function avatarEntryForName'),html.indexOf('function openAvatarPicker'));
  assert.match(lookup,/pokemonCatalogDomain\.resolveLegacyKey\(name\)/);assert.match(lookup,/legacyAliases/);assert.match(lookup,/spriteSourceIndex\(\)\.get\(norm\)\|\|null/);
  assert.match(lookup,/prev\.innerHTML=\(cur\|\|'\?'\)\.slice\(0,2\)\.toUpperCase\(\)/);
});

test('legal acknowledgements are a compact link-free footer surface, not a primary setting',()=>{
  assert.doesNotMatch(index,/data-settings-target="legal"|data-settings-section="legal"/);
  assert.doesNotMatch(html,/function renderLegalSources|renderLegalSources\(\)/);
  assert.match(index,/id="app-legal-footer"/);assert.match(index,/onclick="openLegalAcknowledgements\(this\)"/);
  assert.match(index,/<dialog class="legal-dialog" id="legal-dialog"/);
  const start=index.indexOf('<dialog class="legal-dialog"'),end=index.indexOf('</dialog>',start);
  const legal=index.slice(start,end);
  assert.match(legal,/PokéAPI provides species, form, and sprite-repository inputs/);
  assert.match(legal,/their artwork is not served by PoGo Trades/);
  assert.doesNotMatch(legal,/legal\.backgroundUse/);
  assert.match(legal,/not affiliated with, endorsed by, or sponsored by the rights holders/);
  assert.doesNotMatch(legal,/<a\b|href=|https?:\/\//i);
  assert.doesNotMatch(legal,/licensed|authorized|fair use|official partner/i);
  assert.doesNotMatch(legal,/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('internal provenance distinguishes served assets from research-only sources',()=>{
  assert.match(provenance,/Attribution does not substitute for permission/);
  for(const source of ['PokéAPI','Pokémon Database','PokeMiners','Serebii','Pokémon GO Hub','Official Pokémon GO and Pokémon sources'])assert.match(provenance,new RegExp(source));
  assert.match(provenance,/PokeMiners[\s\S]*\*\*REFERENCE ONLY\*\*/);
  assert.match(provenance,/Serebii[\s\S]*\*\*REFERENCE ONLY\*\*/);
  assert.match(provenance,/Pokémon GO Hub[\s\S]*\*\*REMOVE \/ DO NOT SERVE\*\*/);
  assert.match(provenance,/Backgrounds remain out of active product surfaces/);
});

test('unified wanted rows expose identity, selection and an explicit edit action',()=>{
  const rows=html.slice(html.indexOf('template.innerHTML=`<article class="myrow wants-row'),html.indexOf('function refreshCombinedSearch'));
  assert.match(rows,/data-name="\$\{escAttr\(e\.name\)\}"/);
  assert.match(rows,/data-priority=/);assert.match(rows,/class="wants-select"/);
  assert.match(rows,/openCombinedEditor/);assert.match(rows,/class="myrow-copy"/);
  assert.doesNotMatch(rows,/draggable="true"|confirmRemove\(/);
  assert.match(index,/id="combined-editor-modal"[^>]+role="dialog"/);
  assert.match(index,/id="combined-save"/);
});

test('combined priority edits preserve explicit removal and session-bound mutations',()=>{
  const edit=html.slice(html.indexOf('async function saveCombinedEditor'),html.indexOf('let boardHiddenKeys'));
  assert.match(edit,/remove=false/);assert.match(edit,/draft\.owner!==cur\|\|draft\.uid!==auth\?\.currentUser\?\.uid/);
  assert.match(edit,/applyAccountSyncTradeMutations/);assert.match(edit,/wantsCollapsedSections\.delete/);
  assert.match(index,/id="wants-remove"[^>]+onclick="saveCombinedEditor\(true\)"/);
  assert.match(index,/id="combined-priority"/);
});

test('reorder persists explicit within-priority order without rewriting Firebase list data',()=>{
  const drop=html.slice(html.indexOf('function dragDrop'),html.indexOf('function announceMyListAction'));
  assert.match(drop,/sourcePriority!==targetPriority/);assert.match(drop,/myList\.reorderWithinPriority/);assert.match(drop,/names\.splice\(si,1\);names\.splice\(ti,0,srcName\)/);assert.match(drop,/persistMyListOrder\(model,myListType,session\.username\)/);assert.doesNotMatch(drop,/writeList\(myListType,cur/);
});

test('Batch B adds no Firebase surface or new profile schema',()=>{
  assert.doesNotMatch(html,/avatarCatalogId|avatarPokemon\s*:\s*\{/);
  assert.doesNotMatch(html,/onValue\(/);
  assert.match(html,/avatarPokemon:raw\.avatarPokemon\.trim\(\)/);
});
