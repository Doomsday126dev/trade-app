const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const window={};
const context=vm.createContext({window,URL});
for(const file of ['js/domain/priorityValues.js','js/domain/trainerDiscovery.js','js/data/trainerHistoryStore.js','js/domain/eventPresentation.js']){
  vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
}
const discovery=window.PogoDomain.trainerDiscovery;
const history=window.PogoData.trainerHistoryStore;
const events=window.PogoDomain.eventPresentation;

function memoryStorage(){
  const map=new Map();
  return{getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),map};
}

test('trainer suggestions are case-insensitive, preserve display case, and prefer prefixes',()=>{
  assert.equal(JSON.stringify(discovery.trainerSuggestions(['AlphaNYC','myAlpha','Beta'],'ALP').map(item=>item.name)),JSON.stringify(['AlphaNYC','myAlpha']));
  assert.equal(discovery.trainerSuggestions(['Alpha'],'a',{minLength:2}).length,0);
});

test('trainer suggestions rank exact, prefix, token prefix, and substring matches deterministically',()=>{
  const names=['The Alpha Club','myAlpha','AlphaNYC','Alpha'];
  assert.equal(JSON.stringify(discovery.trainerSuggestions(names,'alpha').map(item=>item.name)),JSON.stringify(['Alpha','AlphaNYC','The Alpha Club','myAlpha']));
});

test('mixed-case trainers match lowercase, uppercase, partial prefix, and substring queries',()=>{
  const names=['ScoopskiPotat0'];
  for(const query of ['scoo','SCOO','potat','scoopskipotat0','SCOOPSKIPOTAT0'])assert.equal(discovery.bestTrainerSuggestion(names,query).name,'ScoopskiPotat0');
});

test('favorites and recents break textual ties but never outrank a stronger match',()=>{
  const names=['Alpha','AlphaNYC','myAlpha'];
  const ranked=discovery.trainerSuggestions(names,'alpha',{favoriteNames:['myAlpha'],recentNames:['AlphaNYC']}).map(item=>item.name);
  assert.equal(JSON.stringify(ranked),JSON.stringify(['Alpha','AlphaNYC','myAlpha']));
  const tied=discovery.trainerSuggestions(['AlphaTwo','AlphaOne'],'alpha',{favoriteNames:['AlphaTwo']}).map(item=>item.name);
  assert.equal(JSON.stringify(tied),JSON.stringify(['AlphaTwo','AlphaOne']));
});

test('desktop and mobile suggestion inputs produce identical stable results',()=>{
  const names=['ScoopskiPotat0','PotatoFan','The Potato'];
  const desktop=discovery.trainerSuggestions(names,'POT',{favoriteNames:['The Potato']});
  const mobile=discovery.trainerSuggestions(names,'pot',{favoriteNames:['The Potato']});
  assert.equal(JSON.stringify(desktop),JSON.stringify(mobile));
});

test('published-list diff detects add, remove, value changes, and category moves',()=>{
  const before={lists:{wishlist:{Pikachu:'H',Tauros:'M'},dynamax:{Bulbasaur:'L'}}};
  const after={lists:{wishlist:{Pikachu:'M',Bulbasaur:'L',Lugia:'H'}}};
  const diff=discovery.diffPublishedLists(before,after);
  assert.equal(JSON.stringify(diff.added.map(item=>item.name)),JSON.stringify(['Lugia']));
  assert.equal(JSON.stringify(diff.removed.map(item=>item.name)),JSON.stringify(['Tauros']));
  assert.equal(JSON.stringify(diff.modified.map(item=>item.name)),JSON.stringify(['Bulbasaur','Pikachu']));
  assert.equal(diff.modified.find(item=>item.name==='Bulbasaur').categoryChanged,true);
});

test('published-list diff uses stable stored identifiers and canonical public fields',()=>{
  const before={lists:{wishlist:{Pikachu:'H[lucky][iv:15/15/15](  antique   cup  )',Tauros:'M'}}};
  const reordered={lists:{wishlist:{TAUROS:'M()',pikachu:'H[lucky](antique cup)'}}};
  const diff=discovery.diffPublishedLists(before,reordered);
  assert.equal(diff.total,0);
});

test('unavailable current snapshot is not represented as mass removals',()=>{
  const diff=discovery.diffPublishedLists({lists:{wishlist:{Pikachu:'H'}}},null);
  assert.equal(diff.available,false);
  assert.equal(diff.removed.length,0);
});

test('trainer history is partitioned by UID and username and marks opened snapshots explicitly',()=>{
  const storage=memoryStorage();
  const a=history.createTrainerHistoryStore({storage,identity:{uid:'uid-a',username:'Alice'}});
  a.toggleFavorite('TrainerOne');
  a.rememberOpened('TrainerOne',{lists:{wishlist:{Pikachu:'H'}}},123);
  assert.equal(a.read().favorites.length,1);
  assert.equal(a.snapshotFor('trainerone').seenAt,123);
  const b=history.createTrainerHistoryStore({storage,identity:{uid:'uid-b',username:'Bob'}});
  assert.equal(b.read().favorites.length,0);
  const mismatch=history.createTrainerHistoryStore({storage,identity:{uid:'uid-a',username:'Mallory'}});
  assert.equal(mismatch.read().favorites.length,0);
});

test('reading favorites and history never marks a stored snapshot as seen',()=>{
  const storage=memoryStorage(),store=history.createTrainerHistoryStore({storage,identity:{uid:'uid-a',username:'Alice'}});
  store.rememberOpened('TrainerOne',{lists:{wishlist:{Pikachu:'H'}}},123);
  const before=JSON.stringify(store.read());
  store.isFavorite('TrainerOne');store.snapshotFor('TrainerOne');store.read();
  assert.equal(JSON.stringify(store.read()),before);
});

test('legacy local favorites migrate once into the existing account partition',()=>{
  const storage=memoryStorage(),identity={uid:'uid-a',username:'Alice'};
  storage.setItem(`${history.PREFIX}uid-a`,JSON.stringify({version:1,owner:identity,favorites:[{trainerName:'zeta'},{trainerName:'Alpha'}],recent:[{trainerName:'zeta',openedAt:4}],snapshots:{}}));
  const store=history.createTrainerHistoryStore({storage,identity});
  const first=store.read(),persisted=storage.getItem(store.key);
  assert.equal(first.version,3);
  assert.equal(JSON.stringify(first.favorites.map(item=>item.displayName)),JSON.stringify(['Alpha','zeta']));
  assert.equal(first.syncState,'local-only');
  store.read();
  assert.equal(storage.getItem(store.key),persisted);
});

test('empty, absent, and interrupted local migrations are safe and repeatable',()=>{
  const storage=memoryStorage(),identity={uid:'uid-a',username:'Alice'},store=history.createTrainerHistoryStore({storage,identity});
  assert.equal(store.read().favorites.length,0);
  storage.setItem(store.key,JSON.stringify({version:1,owner:identity,favorites:[],recent:[]}));
  assert.equal(store.read().version,3);assert.equal(store.read().favorites.length,0);
  const snapshot={seenAt:12,snapshot:{lists:{wishlist:{Pikachu:'H'}}}};
  storage.setItem(store.key,JSON.stringify({
    version:2,schemaVersion:2,migrationVersion:1,owner:identity,
    favorites:[{trainerName:'Alpha',tagIds:['tag_raid'],note:'obsolete private note'}],
    recent:[{trainerName:'Alpha',openedAt:12}],snapshots:{alpha:snapshot},
    tags:{tag_raid:{label:'Raid',createdAt:4,updatedAt:5}}
  }));
  const completed=store.read(),persisted=JSON.parse(storage.getItem(store.key));
  assert.equal(completed.favorites[0].displayName,'Alpha');assert.equal(JSON.stringify(completed.favorites[0].tagIds),JSON.stringify(['tag_raid']));assert.equal('note' in completed.favorites[0],false);
  assert.equal(completed.tags.tag_raid.label,'Raid');assert.equal(completed.recent[0].displayName,'Alpha');assert.equal(JSON.stringify(completed.snapshots.alpha),JSON.stringify(snapshot));assert.equal(persisted.migrationVersion,3);
  const once=storage.getItem(store.key);store.read();assert.equal(storage.getItem(store.key),once);
});

test('partially malformed and duplicate legacy records retain valid favorites and recents',()=>{
  const storage=memoryStorage(),identity={uid:'uid-a',username:'Alice'},store=history.createTrainerHistoryStore({storage,identity});
  storage.setItem(store.key,JSON.stringify({version:1,owner:identity,favorites:[null,{trainerName:''},{trainerName:'TrainerOne'},{trainerName:'trainerone'},{trainerName:'TrainerTwo'}],recent:[null,{trainerName:'TrainerOne',openedAt:'bad'},{trainerName:'TrainerOne',openedAt:4},{trainerName:'trainerone',openedAt:3}],snapshots:{}}));
  const state=store.read();
  assert.equal(JSON.stringify(state.favorites.map(item=>item.displayName)),JSON.stringify(['TrainerOne','TrainerTwo']));
  assert.equal(state.recent.length,1);assert.equal(state.recent[0].displayName,'TrainerOne');
  assert.equal(state.migration.skippedFavorites,3);assert.equal(state.migration.skippedRecents,3);
  assert.equal(store.updateCanonicalName('TRAINERONE'),true);assert.equal(store.favoriteFor('trainerone').displayName,'TRAINERONE');
});

test('migration persistence failure leaves valid local records usable',()=>{
  const backing=memoryStorage(),identity={uid:'uid-a',username:'Alice'};
  const key=`${history.PREFIX}uid-a`;backing.setItem(key,JSON.stringify({version:1,owner:identity,favorites:[{trainerName:'TrainerOne'}],recent:[]}));
  const storage={getItem:backing.getItem,setItem(){throw new Error('quota');},removeItem:backing.removeItem};
  const state=history.createTrainerHistoryStore({storage,identity}).read();
  assert.equal(state.favorites[0].displayName,'TrainerOne');assert.equal(state.version,3);
});

test('signed-out and other-account local records are never adopted during sign-in',()=>{
  const storage=memoryStorage();
  storage.setItem(`${history.PREFIX}signed-out`,JSON.stringify({version:1,favorites:[{trainerName:'PrivateTrainer'}]}));
  const alice=history.createTrainerHistoryStore({storage,identity:{uid:'uid-a',username:'Alice'}}),bob=history.createTrainerHistoryStore({storage,identity:{uid:'uid-b',username:'Bob'}});
  alice.toggleFavorite('AliceFavorite');
  assert.equal(JSON.stringify(alice.read().favorites.map(item=>item.displayName)),JSON.stringify(['AliceFavorite']));
  assert.equal(bob.read().favorites.length,0);
  assert.ok(storage.getItem(`${history.PREFIX}signed-out`));
});

test('private tags remain bounded, searchable, and account isolated',()=>{
  const storage=memoryStorage(),alice=history.createTrainerHistoryStore({storage,identity:{uid:'uid-a',username:'Alice'},now:()=>100});
  alice.toggleFavorite('ScoopskiPotat0');
  const travel=alice.createTag(' Travel '),duplicate=alice.createTag('ＴＲＡＶＥＬ');
  assert.equal(travel.ok,true);assert.equal(duplicate.code,'tag-duplicate');
  assert.equal(alice.setFavoriteTags('scoopskipotat0',[travel.id]).ok,true);
  assert.equal(alice.filterFavorites({query:'travel',tagIds:[travel.id]}).length,1);
  const bob=history.createTrainerHistoryStore({storage,identity:{uid:'uid-b',username:'Bob'}});
  assert.equal(bob.read().favorites.length,0);assert.equal(Object.keys(bob.read().tags).length,0);
});

test('favorite organization saves tags immediately',()=>{
  const storage=memoryStorage(),store=history.createTrainerHistoryStore({storage,identity:{uid:'uid-a',username:'Alice'},now:()=>200});
  store.toggleFavorite('TrainerOne');const tag=store.createTag('Raid');
  assert.equal(store.updateFavoriteOrganization('TrainerOne',{tagIds:[tag.id]}).ok,true);
  assert.deepEqual(Array.from(store.favoriteFor('TrainerOne').tagIds),[tag.id]);
});

test('deleting a stable tag removes it from every assigned favorite without removing favorites',()=>{
  const storage=memoryStorage(),store=history.createTrainerHistoryStore({storage,identity:{uid:'uid-a',username:'Alice'},now:()=>300});
  store.toggleFavorite('TrainerOne');store.toggleFavorite('TrainerTwo');const tag=store.createTag('レイド候補');
  store.setFavoriteTags('TrainerOne',[tag.id]);store.setFavoriteTags('TrainerTwo',[tag.id]);
  assert.equal(store.deleteTag(tag.id).ok,true);
  const state=store.read();assert.equal(state.favorites.length,2);assert.equal(state.favorites.every(item=>item.tagIds.length===0),true);assert.equal(Object.keys(state.tags).length,0);
});

test('event presentation hides expired events and groups/filter types deterministically',()=>{
  const now=Date.parse('2026-08-04T12:00:00Z');
  const source=[
    {name:'Raid Hour',eventType:'raid',start:'2026-08-04T11:00:00Z',end:'2026-08-04T13:00:00Z'},
    {name:'Max Battle Day',start:'2026-08-05T12:00:00Z',end:'2026-08-05T14:00:00Z'},
    {name:'Old Research',start:'2026-08-01T12:00:00Z',end:'2026-08-02T12:00:00Z'}
  ];
  const grouped=events.prepareEvents(source,{now});
  assert.equal(JSON.stringify(grouped.map(section=>section.group)),JSON.stringify(['now','soon']));
  assert.equal(events.prepareEvents(source,{now,filter:'max'})[0].events[0].uiType,'max');
});

test('event presentation handles all-day dates, viewer timezones, and safe source links',()=>{
  const allDay={name:'Community Day',start:'2026-08-04',end:'2026-08-04',allDay:true};
  assert.match(events.eventTimeLabel(allDay,{locale:'en-US'}),/Aug/);
  assert.doesNotMatch(events.eventTimeLabel(allDay,{locale:'en-US'}),/:\d{2}/);
  const timed={start:'2026-08-04T18:00:00Z',end:'2026-08-04T19:30:00Z'};
  assert.match(events.eventTimeLabel(timed,{locale:'en-US',timeZone:'America/New_York'}),/2:00/);
  assert.notEqual(events.eventTimeLabel(timed,{locale:'en-US',timeZone:'America/New_York'}),events.eventTimeLabel(timed,{locale:'en-US',timeZone:'Asia/Tokyo'}));
  assert.equal(events.safeHttpsUrl('javascript:alert(1)'),'');
  assert.equal(events.safeHttpsUrl('http://example.com'),'');
  assert.equal(events.safeHttpsUrl('https://example.com/event'),'https://example.com/event');
});
