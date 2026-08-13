const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const window={};
vm.runInNewContext(readFileSync(path.join(root,'js/domain/favoriteCardInteractions.js'),'utf8'),{window});
const interactions=window.PogoDomain.favoriteCardInteractions;

test('swipe policy requires a deliberate horizontal threshold and rejects vertical scroll',()=>{
  assert.equal(interactions.swipeIntent(-51,2).intent,'snap-back');
  assert.equal(interactions.swipeIntent(-52,2).intent,'open');
  assert.equal(interactions.swipeIntent(52,2).intent,'close');
  assert.equal(interactions.swipeIntent(-30,34).intent,'vertical');
  assert.equal(interactions.swipeIntent(4,5).intent,'pending');
});

test('swipe handlers only change presentation state and expose no mutation call',()=>{
  const block=html.slice(html.indexOf('function closeFavoriteCardActions'),html.indexOf('function setFavoriteSearch'));
  assert.match(block,/swipe-open/);
  assert.match(block,/favoriteCardInteractionsDomain\.swipeIntent/);
  assert.doesNotMatch(block,/setFavoriteTags|toggleTrainerFavorite|removeTrainerFavorite|localStorage|Firebase|fetch\(/);
});

test('only one card opens and tap-outside or Escape closes presentation state',()=>{
  assert.match(html,/closeFavoriteCardActions\(gesture\.card\)/);
  assert.match(html,/if\(!event\.target\.closest\('\.favorite-card-shell'\)\)closeFavoriteCardActions\(\)/);
  assert.match(html,/event\.key==='Escape'[\s\S]*closeFavoriteCardActions\(\)/);
});

test('cards use lightweight tag and overflow actions with keyboard parity',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.match(html,/class="[^"]*favorite-card-add-tag[^"]*"/);
  assert.match(render,/favorite-card-footer[\s\S]*favorite-card-open[\s\S]*favorite-card-add-tag[\s\S]*organizer\.tagAction[\s\S]*favorite-card-more/);
  assert.doesNotMatch(render,/favorite-card-tags">\$\{hasTags[\s\S]*favorite-card-add-tag/);
  assert.match(html,/class="[^"]*favorite-card-more[^"]*" aria-haspopup="menu"/);
  assert.match(html,/class="favorite-card-menu" role="menu"/);
  assert.match(html,/organizer\.editTagsFor/);
  assert.match(html,/organizer\.addTagsFor/);
  assert.match(html,/organizer\.moreActionsFor/);
  assert.doesNotMatch(html,/class="favorite-card-action" onclick="openTrainerOrganizer/);
});

test('ordinary Favorite cards are local bookmarks and cannot hydrate public shares',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('async function toggleTrainerFavorite'));
  assert.doesNotMatch(render,/ensureFavoriteShareSessionCache|favoriteShareSessionCache|managedPublicShareRepository|readFavorite|hydrate|trainer\.listUnavailable|trainer-change-counts|trainer-unread/);
  assert.match(render,/store\.read\(\)/);
  assert.match(render,/store\.filterFavorites/);
  assert.match(render,/favoriteTagChips\(item,state\)/);
  assert.match(render,/data-trainer-action="open"/);
});

test('remove remains explicit confirmed and unavailable from swipe alone',()=>{
  assert.match(html,/role="menuitem" class="danger" data-trainer-action="remove"/);
  assert.match(html,/function removeTrainerFavorite[\s\S]*organizer\.removeConfirm/);
});

test('SEC-03 trainer names are data, never inline JavaScript source',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.match(render,/data-trainer-action="open"/);
  assert.match(render,/data-trainer-action="organize"/);
  assert.match(render,/data-trainer-action="remove"/);
  assert.match(html,/function favoriteTrainerAction\(event\)/);
  assert.doesNotMatch(render,/onclick="(?:openTrainerByName|openTrainerOrganizer|openFavoriteTagsFromMenu|removeTrainerFavorite)\('/);
});

test('canonical picker retains multi-select, inline creation, duplicate reuse, and scoped Escape',()=>{
  assert.match(html,/id="organizer-tag-assignment"/);
  assert.match(html,/class="[^"]*organizer-selectable-chip[^"]*"[^>]+aria-pressed=/);
  assert.match(html,/function toggleTrainerOrganizerTag[\s\S]*setFavoriteTags/);
  assert.match(html,/function createLocalTrainerTag[\s\S]*ensureTag[\s\S]*setFavoriteTags/);
  assert.match(html,/function trainerTagInputKeydown[\s\S]*event\.key==='Enter'[\s\S]*event\.key==='Escape'/);
  assert.doesNotMatch(html,/id="organizer-tag-manager"|class="organizer-manage-details"/);
});

test('Find Trainer, autocomplete, Favorites, and cards share one deliberate container',()=>{
  assert.match(html,/\.trainer-discovery-content\{width:min\(100%,760px\);max-width:var\(--container-standard\)\}/);
  assert.match(html,/\.trainer-search-shell\{[^}]*width:100%;max-width:none/);
  assert.match(html,/\.trainer-suggestions\{[^}]*left:0;right:0/);
  const find=html.slice(html.indexOf('<!-- FIND TRAINER'),html.indexOf('<!-- MY LIST'));
  assert.match(find,/class="[^"]*trainer-discovery-content[^"]*"[\s\S]*id="find-trainer-input"[\s\S]*id="favorite-trainers"/);
});

test('Favorites and Recents use one stacked hierarchy with distinct density and time semantics',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.match(render,/favoritesHeading[\s\S]*recentHeading/);
  assert.match(render,/<h2 class="trainer-quick-heading">/);
  assert.match(render,/class="recent-trainer-list"/);
  assert.match(render,/type="button" class="recent-trainer-row card-row"/);
  assert.match(render,/class="recent-trainer-chevron"/);
  assert.doesNotMatch(render,/role="tab"|trainer-history-tabs/);
  assert.doesNotMatch(render,/trainerDate\(updatedAt\)/);
  assert.match(render,/trainerViewedText\(item\.openedAt\)/);
  assert.match(render,/organizer\.noFavoritesHelp/);
  assert.match(render,/organizer\.noMatchesHelp/);
  assert.match(render,/trainer\.noRecentsHelp/);
});

test('touch, wrapping, reduced-motion, and local-only safety contracts remain explicit',()=>{
  assert.match(html,/\.favorite-card-add-tag\{width:auto;height:48px;min-width:64px/);
  assert.match(html,/\.favorite-card-more\{width:48px;height:48px;min-width:48px/);
  assert.match(html,/\.favorite-card-tag\{[^}]*min-height:26px/);
  assert.match(html,/touch-action:pan-y/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.favorite-card-surface\{transition:none\}\}/);
  assert.match(html,/overflow-wrap:anywhere/);
  assert.match(html,/@media\(max-width:600px\)\{[^}]*[\s\S]*?\.favorite-card-surface\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html,/-webkit-line-clamp:2/);
  assert.match(html,/\.favorite-card-footer\{justify-content:flex-end;padding-top:4px;border-top:1px solid var\(--border\)\}/);
  assert.match(html,/\.favorite-filter-chip\{[^}]*min-height:48px[^}]*background:transparent/);
  assert.match(html,/\.favorite-filter-chip-surface\{[^}]*min-height:30px[^}]*padding:4px 9px/);
  assert.match(html,/class="favorite-filter-chip-surface"><span class="favorite-filter-check" aria-hidden="true"/);
  assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(?:mutate|write|save)/);
});
