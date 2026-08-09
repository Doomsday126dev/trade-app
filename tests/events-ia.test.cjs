const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

const root=join(__dirname,'..');
const html=readFileSync(join(root,'index.html'),'utf8');
const domainSource=readFileSync(join(root,'js/domain/eventPresentation.js'),'utf8');

function loadDomain(){
  const window={PogoDomain:{},Intl,Date,URL};
  vm.runInNewContext(domainSource,{window,Intl,Date,URL});
  return window.PogoDomain.eventPresentation;
}

test('Now Soon Later keeps the established deterministic three-day boundary',()=>{
  const events=loadDomain(),now=Date.parse('2026-08-09T12:00:00Z');
  assert.equal(events.eventGroup({start:'2026-08-09T11:00:00Z',end:'2026-08-09T13:00:00Z'},now),'now');
  assert.equal(events.eventGroup({start:'2026-08-12T12:00:00Z',end:'2026-08-12T13:00:00Z'},now),'soon');
  assert.equal(events.eventGroup({start:'2026-08-12T12:00:01Z',end:'2026-08-12T13:00:00Z'},now),'later');
  assert.equal(events.eventGroup({start:'2026-08-08T11:00:00Z',end:'2026-08-08T13:00:00Z'},now),'expired');
});

test('event timing separates scannable dates, times, relative state, and multi-day windows',()=>{
  const events=loadDomain(),now=Date.parse('2026-08-09T12:00:00Z');
  const active=events.eventTiming({start:'2026-08-09T11:00:00Z',end:'2026-08-09T13:10:00Z'},{now,locale:'en-US',timeZone:'UTC'});
  assert.equal(active.relative.kind,'ends');assert.equal(active.relative.unit,'minute');assert.equal(active.relative.value,70);
  assert.ok(active.dateLabel);assert.ok(active.timeLabel);assert.equal(active.dayOffset,0);
  const tomorrow=events.eventTiming({start:'2026-08-10T15:00:00Z',end:'2026-08-10T18:00:00Z'},{now,locale:'de-DE',timeZone:'UTC'});
  assert.equal(tomorrow.relative.kind,'starts');assert.equal(tomorrow.dayOffset,1);
  const multi=events.eventTiming({start:'2026-08-10T22:00:00Z',end:'2026-08-12T02:00:00Z'},{now,locale:'ja-JP',timeZone:'UTC'});
  assert.equal(multi.multiDay,true);assert.ok(multi.dateLabel);assert.ok(multi.timeLabel);
  const allDay=events.eventTiming({start:'2026-08-11',end:'2026-08-11',allDay:true},{now,locale:'es-ES',timeZone:'UTC'});
  assert.equal(allDay.timeLabel,'');
});

test('relative precision is low cost and appropriate to the remaining interval',()=>{
  const events=loadDomain();
  assert.deepEqual({...events.relativeDuration(48*60000)},{value:48,unit:'minute'});
  assert.deepEqual({...events.relativeDuration(3*3600000)},{value:3,unit:'hour'});
  assert.deepEqual({...events.relativeDuration(4*86400000)},{value:4,unit:'day'});
  assert.doesNotMatch(html,/setInterval\([^)]*event|requestAnimationFrame\([^)]*event/i);
});

test('timeline uses one chronological column, native source rows, and shared primitives',()=>{
  const render=html.slice(html.indexOf('function setEventTypeFilter'),html.indexOf('function renderSchedule'));
  assert.match(render,/class="events-timeline"/);
  assert.match(render,/const tag=link\?'a':'article'/);
  assert.match(render,/class="event-card card-row/);
  assert.match(render,/target="_blank" rel="noopener" aria-label=/);
  assert.doesNotMatch(render,/event-card-bonuses|event-card-details btn/);
  assert.match(html,/\.event-card-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html,/\.event-card\{[^}]*min-height:92px/);
});

test('filters and loading empty filtered error offline states remain distinct',()=>{
  const render=html.slice(html.indexOf('function setEventTypeFilter'),html.indexOf('function renderSchedule'));
  assert.match(render,/role="group"[^>]+events\.filtersLabel/);
  assert.match(render,/aria-pressed="\$\{eventTypeFilter===type\}"/);
  for(const value of ['events.loading','events.emptyTitle','events.filteredEmptyTitle','events.errorTitle','events.offlineTitle','events.clearFilters','events.retry'])assert.match(render,new RegExp(value.replace('.','\\.')));
  assert.match(render,/out\.setAttribute\('aria-busy'/);
  assert.match(render,/setEventTypeFilter\('all'\)/);
});

test('event source, type taxonomy, and localization pipeline remain unchanged',()=>{
  assert.match(html,/const SCRAPEDDUCK_BASE='https:\/\/raw\.githubusercontent\.com\/bigfoott\/ScrapedDuck\/data\/'/);
  assert.match(html,/eventLabelsI18n\.localizeEvent\(event,locale\)/);
  const events=loadDomain();
  assert.deepEqual(Array.from(events.TYPES),['all','raids','max','gbl','research','general']);
  assert.equal(events.safeHttpsUrl('https://example.com/event'),'https://example.com/event');
  assert.equal(events.safeHttpsUrl('javascript:alert(1)'),'');
});

test('zero one and event-heavy fixtures stay bounded and sorted without per-card listeners',()=>{
  const events=loadDomain(),now=Date.parse('2026-08-09T12:00:00Z');
  assert.equal(events.prepareEvents([],{now}).length,0);
  assert.equal(events.prepareEvents([{name:'One',start:'2026-08-09T11:00:00Z',end:'2026-08-09T13:00:00Z'}],{now})[0].events.length,1);
  const fixture=Array.from({length:30},(_,index)=>({name:`Event ${index}`,start:new Date(now+(index+1)*3600000).toISOString(),end:new Date(now+(index+2)*3600000).toISOString()}));
  const started=performance.now(),prepared=events.prepareEvents(fixture,{now}),elapsed=performance.now()-started;
  assert.equal(prepared.reduce((sum,section)=>sum+section.events.length,0),30);
  assert.ok(elapsed<100);
  assert.doesNotMatch(html,/event-card[^\n]+addEventListener/);
});
