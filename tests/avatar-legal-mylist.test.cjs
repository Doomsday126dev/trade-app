const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);

test('visual avatar picker uses the canonical catalog lazily and keeps string persistence',()=>{
  const picker=html.slice(html.indexOf('let avatarPickerEntriesCache'),html.indexOf('// Build a <img>'));
  assert.match(picker,/pokemonCatalogDomain\.canonicalizeEntries/);
  assert.match(picker,/spriteLookupKeys\?\.some\(isUnresolvedSpriteKey\)/);
  assert.match(picker,/\.slice\(0,q\?48:24\)/);
  assert.match(picker,/role="option"/);assert.match(picker,/avatarPickerKeydown/);assert.match(picker,/ArrowDown/);assert.match(picker,/onclick="selectAvatarOption\(this\.dataset\.catalogId\)"/);
  const profile=html.slice(html.indexOf('data-settings-section="profile"'),html.indexOf('data-settings-section="language"'));
  assert.match(profile,/<input type="hidden" id="prof-av-input">/);assert.doesNotMatch(profile,/id="prof-av-list"|<datalist/);
  const save=html.slice(html.indexOf('async function saveProfile'),html.indexOf('async function savePinSettings'));
  assert.match(save,/const avatarPokemon=document\.getElementById\('prof-av-input'\)\?\.value\.trim\(\)\|\|''/);
  assert.match(save,/const upd=\{friendCode:fc,bio,discord,avatarPokemon\}/);
});

test('legacy and unknown avatar values retain safe compatibility behavior',()=>{
  const lookup=html.slice(html.indexOf('function avatarEntryForName'),html.indexOf('function openAvatarPicker'));
  assert.match(lookup,/pokemonCatalogDomain\.resolveLegacyKey\(name\)/);assert.match(lookup,/legacyAliases/);assert.match(lookup,/spriteSourceIndex\(\)\.get\(norm\)\|\|null/);
  assert.match(lookup,/prev\.innerHTML=\(cur\|\|'\?'\)\.slice\(0,2\)\.toUpperCase\(\)/);
});

test('Legal and Attribution is user reachable, conservative, localized, and registry driven',()=>{
  assert.match(html,/data-settings-target="legal"/);assert.match(html,/data-settings-section="legal"/);assert.match(html,/renderLegalSources\(\)/);
  assert.match(html,/PoGo Trades is an unofficial fan-made tool and is not affiliated with, endorsed by, or sponsored by Scopely Explore/);
  assert.match(html,/Pokémon, Pokémon GO, character names, images, and related marks are the property of their respective rights holders/);
  assert.match(html,/SPRITE_SOURCE_REGISTRY\.map/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/https:\/\/github\.com\/Doomsday126dev\/trade-app\/issues/);
  const legal=html.slice(html.indexOf('data-settings-section="legal"'),html.indexOf('</section>',html.indexOf('data-settings-section="legal"')));
  assert.doesNotMatch(legal,/licensed|authorized|fair use|official partner/i);
  assert.doesNotMatch(legal,/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('normal My List rows are dense and progressive while reorder remains explicit',()=>{
  const rows=html.slice(html.indexOf('function myListRowHtml'),html.indexOf('function myListPrioritySectionHtml'));
  assert.match(rows,/reorderMode&&!bulkMode\?'draggable="true"'/);assert.match(rows,/reorderMode\?`<button type="button" class="drag-handle"/);
  assert.match(rows,/class="myrow-priority-quick"/);assert.doesNotMatch(rows,/class="myrow-priority" role="group"/);
  assert.match(rows,/details class="myrow-editor"/);assert.match(html,/@media\(max-width:600px\)[^{]*\{[\s\S]*?\.myrow-priority-quick\{display:none\}/);
  assert.match(html,/\.myrow\{min-height:58px/);assert.match(html,/id="mylist-reorder-toggle"/);
});

test('priority moves are exact, announced, and do not reuse toggle-delete behavior',()=>{
  const move=html.slice(html.indexOf('function movePriority'),html.indexOf('function setPri'));
  assert.match(move,/\['H','M','L'\]\.includes\(p\)/);assert.match(move,/current\.p===p/);assert.match(move,/priValue\(p,current\.mod,current\.lucky,current\.xxl,current\.xxs,current\.shiny,current\.backgroundId\)/);
  assert.match(move,/announceMyListAction/);assert.doesNotMatch(move,/delete list|confirm\(/);
  const editor=html.slice(html.indexOf('function myListEditorHtml'),html.indexOf('function hydrateMyRowEditor'));
  assert.match(editor,/myrow-priority-editor/);assert.match(editor,/movePriority/);
});

test('reorder persists explicit within-priority order without rewriting Firebase list data',()=>{
  const drop=html.slice(html.indexOf('function dragDrop'),html.indexOf('function announceMyListAction'));
  assert.match(drop,/sourcePriority!==targetPriority/);assert.match(drop,/myList\.reorderWithinPriority/);assert.match(drop,/names\.splice\(si,1\);names\.splice\(ti,0,srcName\)/);assert.match(drop,/persistMyListOrder\(model,myListType,session\.username\)/);assert.doesNotMatch(drop,/writeList\(myListType,cur/);
});

test('Batch B adds no Firebase surface or new profile schema',()=>{
  assert.doesNotMatch(html,/avatarCatalogId|avatarPokemon\s*:\s*\{/);
  assert.doesNotMatch(html,/onValue\(/);
  assert.match(html,/const upd=\{friendCode:fc,bio,discord,avatarPokemon\}/);
});
