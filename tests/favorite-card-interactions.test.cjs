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
  assert.match(html,/class="favorite-card-add-tag"/);
  assert.match(html,/class="favorite-card-more" aria-haspopup="menu"/);
  assert.match(html,/class="favorite-card-menu" role="menu"/);
  assert.match(html,/organizer\.editTagsFor/);
  assert.match(html,/organizer\.addTagsFor/);
  assert.match(html,/organizer\.moreActionsFor/);
  assert.doesNotMatch(html,/class="favorite-card-action" onclick="openTrainerOrganizer/);
});

test('remove remains explicit confirmed and unavailable from swipe alone',()=>{
  assert.match(html,/role="menuitem" class="danger" onclick="removeTrainerFavorite/);
  assert.match(html,/function removeTrainerFavorite[\s\S]*organizer\.removeConfirm/);
});

test('canonical picker retains multi-select, inline creation, duplicate reuse, and scoped Escape',()=>{
  assert.match(html,/id="organizer-tag-assignment"/);
  assert.match(html,/class="organizer-selectable-chip"[^>]+aria-pressed=/);
  assert.match(html,/function toggleTrainerOrganizerTag[\s\S]*setFavoriteTags/);
  assert.match(html,/function createLocalTrainerTag[\s\S]*ensureTag[\s\S]*setFavoriteTags/);
  assert.match(html,/function trainerTagInputKeydown[\s\S]*event\.key==='Enter'[\s\S]*event\.key==='Escape'/);
  assert.doesNotMatch(html,/id="organizer-tag-manager"|class="organizer-manage-details"/);
});

test('Find Trainer, autocomplete, Favorites, and cards share one deliberate container',()=>{
  assert.match(html,/\.trainer-discovery-content\{width:min\(100%,760px\);max-width:760px\}/);
  assert.match(html,/\.trainer-search-shell\{[^}]*width:100%;max-width:none/);
  assert.match(html,/\.trainer-suggestions\{[^}]*left:0;right:0/);
  const find=html.slice(html.indexOf('<!-- FIND TRAINER'),html.indexOf('<!-- MY LIST'));
  assert.match(find,/class="trainer-discovery-content"[\s\S]*id="find-trainer-input"[\s\S]*id="favorite-trainers"/);
});

test('touch, wrapping, reduced-motion, and local-only safety contracts remain explicit',()=>{
  assert.match(html,/\.favorite-card-add-tag,\.favorite-card-more\{width:48px;height:48px/);
  assert.match(html,/\.favorite-card-tag\{[^}]*min-height:26px/);
  assert.match(html,/touch-action:pan-y/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.favorite-card-surface\{transition:none\}\}/);
  assert.match(html,/overflow-wrap:anywhere/);
  assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(?:mutate|write|save)/);
});
