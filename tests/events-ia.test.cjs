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
  assert.match(active.dateLabel,/2026/);assert.ok(active.timeLabel);assert.equal(active.dayOffset,0);
  const tomorrow=events.eventTiming({start:'2026-08-10T15:00:00Z',end:'2026-08-10T18:00:00Z'},{now,locale:'de-DE',timeZone:'UTC'});
  assert.equal(tomorrow.relative.kind,'starts');assert.equal(tomorrow.dayOffset,1);
  const multi=events.eventTiming({start:'2026-08-10T22:00:00Z',end:'2026-08-12T02:00:00Z'},{now,locale:'ja-JP',timeZone:'UTC'});
  assert.equal(multi.multiDay,true);assert.ok(multi.dateLabel);assert.ok(multi.timeLabel);
  const allDay=events.eventTiming({start:'2026-08-11',end:'2026-08-11',allDay:true},{now,locale:'es-ES',timeZone:'UTC'});
  assert.equal(allDay.timeLabel,'');assert.match(allDay.dateLabel,/2026/);
  const crossYear=events.eventTiming({start:'2026-12-31',end:'2027-01-02',allDay:true},{now,locale:'en-US',timeZone:'UTC'});
  assert.equal(crossYear.multiDay,true);assert.match(crossYear.dateLabel,/2026/);assert.match(crossYear.dateLabel,/2027/);
});

test('relative precision is low cost and appropriate to the remaining interval',()=>{
  const events=loadDomain();
  assert.deepEqual({...events.relativeDuration(48*60000)},{value:48,unit:'minute'});
  assert.deepEqual({...events.relativeDuration(3*3600000)},{value:3,unit:'hour'});
  assert.deepEqual({...events.relativeDuration(4*86400000)},{value:4,unit:'day'});
  assert.doesNotMatch(html,/setInterval\([^)]*event|requestAnimationFrame\([^)]*event/i);
});

test('timeline keeps one chronological column beside the calendar and Up next overview',()=>{
  const render=html.slice(html.indexOf('function setEventTypeFilter'),html.indexOf('function renderSchedule'));
  assert.match(render,/class="events-layout"/);
  assert.match(render,/class="events-timeline"/);
  assert.match(render,/class="events-context-rail"/);
  assert.match(render,/class="event-rail-module event-calendar"/);
  assert.match(render,/class="event-rail-module event-up-next"/);
  assert.match(render,/const tag=link\?'a':'article'/);
  assert.match(render,/class="event-card card-row/);
  assert.match(render,/target="_blank" rel="noopener noreferrer" aria-label=/);
  assert.match(render,/link\?`<span class="event-card-cue"/);
  assert.match(render,/uiIconMarkup\('chevron-right'/);
  assert.doesNotMatch(render,/event-card-bonuses|event-card-details btn/);
  assert.match(html,/\.event-card-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html,/\.event-card\{[^}]*display:grid[^}]*grid-template-columns:minmax\(0,1fr\) 86px/);
  assert.match(html,/\.event-card-cue\{[^}]*width:86px/);
  assert.match(html,/\.event-card\{[^}]*min-height:92px/);
  assert.match(html,/\.events-layout\{display:grid;grid-template-columns:minmax\(0,860px\) minmax\(270px,320px\)/);
  assert.match(html,/@media\(max-width:1080px\)\{\.events-layout\{grid-template-columns:minmax\(0,1fr\)/);
});

test('Up next selects the first non-expired event in each supported category',()=>{
  const events=loadDomain(),now=Date.parse('2026-08-09T12:00:00Z');
  const fixture=[
    {id:'spot-late',eventType:'pokemon-spotlight-hour',start:'2026-08-18T18:00:00Z',end:'2026-08-18T19:00:00Z'},
    {id:'max',eventType:'max-mondays',start:'2026-08-10T18:00:00Z',end:'2026-08-10T19:00:00Z'},
    {id:'raid',eventType:'raid-day',start:'2026-08-11T10:00:00Z',end:'2026-08-11T17:00:00Z'},
    {id:'community',eventType:'community-day',start:'2026-08-12T14:00:00Z',end:'2026-08-12T17:00:00Z'},
    {id:'spot-first',eventType:'pokemon-spotlight-hour',start:'2026-08-11T18:00:00Z',end:'2026-08-11T19:00:00Z'},
    {id:'expired',eventType:'raid-day',start:'2026-08-08T10:00:00Z',end:'2026-08-08T17:00:00Z'},
    {id:'other',eventType:'event',start:'2026-08-10T10:00:00Z',end:'2026-08-10T12:00:00Z'}
  ];
  assert.deepEqual(Array.from(events.upNextEvents(fixture,{now}),event=>[event.upNextCategory,event.id]),[
    ['spotlight_hour','spot-first'],['max_monday','max'],['raid_day','raid'],['community_day','community']
  ]);
  assert.deepEqual(Array.from(events.UP_NEXT_CATEGORIES),['spotlight_hour','max_monday','raid_day','community_day']);
});

test('calendar marks meaningful starts while selected-date filtering retains multi-day occupancy',()=>{
  const events=loadDomain(),now=Date.parse('2026-08-09T12:00:00Z');
  const fixture=[
    {id:'multi',name:'Multi',start:'2026-08-10T10:00:00Z',end:'2026-08-12T18:00:00Z'},
    {id:'single',name:'Single',start:'2026-08-12T08:00:00Z',end:'2026-08-12T09:00:00Z'}
  ];
  const calendar=events.calendarMonth(fixture,{year:2026,month:7,now,timeZone:'UTC'});
  assert.equal(calendar.cells.length,42);
  assert.equal(calendar.cells.find(cell=>cell.key==='2026-08-10').markerCount,1);
  assert.equal(calendar.cells.find(cell=>cell.key==='2026-08-11').markerCount,0);
  assert.equal(calendar.cells.find(cell=>cell.key==='2026-08-12').markerCount,1);
  assert.equal(events.eventMarksDate(fixture[0],'2026-08-10',{timeZone:'UTC'}),true);
  assert.equal(events.eventMarksDate(fixture[0],'2026-08-11',{timeZone:'UTC'}),false);
  assert.equal(calendar.cells.find(cell=>cell.key==='2026-08-09').today,true);
  const filtered=events.prepareEvents(fixture,{now,date:'2026-08-11',timeZone:'UTC'}).flatMap(section=>section.events);
  assert.deepEqual(Array.from(filtered,event=>event.id),['multi']);
});

test('filters and loading empty filtered error offline states remain distinct',()=>{
  const render=html.slice(html.indexOf('function setEventTypeFilter'),html.indexOf('function renderSchedule'));
  assert.match(render,/role="group"[^>]+events\.filtersLabel/);
  assert.match(render,/\['spotlight','events\.filterSpotlight'\]/);
  assert.match(render,/aria-pressed="\$\{eventTypeFilter===type\}"/);
  for(const value of ['events.loading','events.emptyTitle','events.filteredEmptyTitle','events.errorTitle','events.offlineTitle','events.clearFilters','events.retry'])assert.match(render,new RegExp(value.replace('.','\\.')));
  assert.match(render,/out\.setAttribute\('aria-busy'/);
  assert.match(render,/setEventTypeFilter\('all'\)/);
  assert.match(render,/eventCalendarDate/);
  assert.match(render,/events\.clearDate/);
});

test('calendar and overview interactions are keyboard reachable without count or sprite clutter',()=>{
  const render=html.slice(html.indexOf('function setEventTypeFilter'),html.indexOf('function renderSchedule'));
  assert.match(render,/eventCalendarKeydown\(event,'\$\{cell\.key\}'\)/);
  assert.match(render,/\['Home','End'\]/);
  assert.match(render,/ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7/);
  assert.match(render,/pokemonNamesI18n\.speciesName\(\{no\},locale\)/);
  assert.match(render,/new Intl\.ListFormat\(locale,\{style:'short',type:'conjunction'\}\)/);
  assert.doesNotMatch(render,/event-up-next-sprite|spriteImg\(no,32/);
  assert.match(render,/cell\.markerCount\?'<i aria-hidden="true"><\/i>'/);
  assert.match(render,/renderEventSelectedDay\(events\)/);
  assert.match(render,/events\.onDate/);
  assert.match(render,/events\.noneOnDate/);
  assert.match(render,/timing\.timeLabel/);
  assert.match(render,/jumpToEvent\(this\.dataset\.eventId\)/);
  assert.match(render,/card\.scrollIntoView/);
  assert.match(render,/card\.focus\(\{preventScroll:true\}\)/);
});

test('event source and localization remain unchanged while Spotlight uses structured identity only',()=>{
  assert.match(html,/const SCRAPEDDUCK_BASE='https:\/\/raw\.githubusercontent\.com\/bigfoott\/ScrapedDuck\/data\/'/);
  assert.match(html,/eventLabelsI18n\.localizeEvent\(event,locale\)/);
  const events=loadDomain();
  assert.deepEqual(Array.from(events.TYPES),['all','spotlight','raids','max','gbl','research','general']);
  assert.equal(events.eventType({eventType:'pokemon-spotlight-hour',name:'Any stable title'}),'spotlight');
  assert.equal(events.eventType({eventType:'event',name:'A title containing Spotlight Hour'}),'general');
  assert.equal(events.safeHttpsUrl('https://example.com/event'),'https://example.com/event');
  assert.equal(events.safeHttpsUrl('https://sub.example.com/?q=x'),'https://sub.example.com/?q=x');
  for(const unsafe of ['javascript:alert(1)','data:text/html,x','vbscript:msgbox(1)','http://example.com','//example.com/event','/event',' javascript:alert(1)','https://example.com/event ','https://user@example.com/event','https:\\example.com','https://example.com/\njavascript:alert(1)','https://example.com/\u0000x','not a url'])assert.equal(events.safeHttpsUrl(unsafe),'',unsafe);
});

test('SEC-04 every active Events destination uses the canonical HTTPS-only policy',()=>{
  const banner=html.slice(html.indexOf('function renderEventBanner()'),html.indexOf('// Stable loading skeletons'));
  const timeline=html.slice(html.indexOf('function openEventDetails('),html.indexOf('function renderSchedule'));
  const schedule=html.slice(html.indexOf('const eventsHtml=evt.events.length'),html.indexOf('// Manual override row'));
  for(const source of [banner,timeline,schedule])assert.match(source,/eventPresentationDomain\.safeHttpsUrl/);
  assert.doesNotMatch(banner,/href="\$\{featured\.link\}/);
  assert.doesNotMatch(schedule,/href="\$\{ev\.link\}/);
  assert.match(timeline,/link=eventPresentationDomain\.safeHttpsUrl\(event\.link\)/);
});

test('Now and event type chrome uses localized text without decorative glyph duplication',()=>{
  const render=html.slice(html.indexOf('function setEventTypeFilter'),html.indexOf('function renderSchedule'));
  assert.match(render,/class="event-current-badge">\$\{escHtml\(i18nCore\.t\('events\.nowBadge'\)\)\}/);
  assert.doesNotMatch(render,/event-current-badge[^`]+●/);
  assert.doesNotMatch(render,/eventTypeIcon/);
  assert.match(html,/\.event-current-badge\{[^}]*text-transform:none/);
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
