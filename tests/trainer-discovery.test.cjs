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
