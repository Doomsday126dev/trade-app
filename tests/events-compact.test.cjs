const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(require('node:path').join(__dirname,'..'));
const groups=vm.runInNewContext('('+source.slice(source.indexOf('function eventBonusGroups('),source.indexOf('function eventBonusesHtml(')).trim()+')');
test('benefit grouping preserves exact scope and keeps free, Deluxe and rank groups separate',()=>{
 const result=groups(['Rank 10 — 2× Candy','Rank 10 — 2× Stardust','Deluxe Rank 10 — 3× Candy','Current ticket holders: half trade cost']);
 assert.equal(result.length,3);assert.equal(result[0].items.length,2);assert.equal(result[1].scope,'Deluxe Rank 10');assert.equal(result[2].scope,'Current ticket holders');assert.equal(result[2].items[0],'half trade cost');
});
test('plain bonuses and their inline time restrictions remain intact',()=>{
 const text='Remote Raid limit 20, Oct 30 5 p.m.–Oct 31 8 p.m. PDT';const result=groups([text]);assert.equal(result[0].scope,'');assert.equal(result[0].items[0],text);
});
test('rank and Deluxe scopes stay inline with every associated benefit in the same list item',()=>{
 const ctx={eventPresentationDomain:{eventFacts:()=>({bonuses:['GO Pass Rank 1: +1 Candy','GO Pass Rank 1: Guaranteed Candy XL','Deluxe Rank 10 — 3× Candy'],bonusSource:null,bosses:[],encounters:[],caveats:['Ticket required.']}),safeHttpsUrl:()=>''},i18nCore:{getLocale:()=> 'en',t:key=>key},escHtml:s=>s,escAttr:s=>s,Intl,eventStableId:()=> 'fixture'};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function eventBonusText('),source.indexOf('function eventsSourceHtml(')),ctx);
 const html=ctx.eventBonusesHtml({},{full:true});
 assert.match(html,/<li><span class="event-benefit-scope">GO Pass Rank 1:<\/span> <span class="event-benefit-text">\+1 Candy; Guaranteed Candy XL<\/span><\/li>/);
 assert.match(html,/<li><span class="event-benefit-scope">Deluxe Rank 10:<\/span> <span class="event-benefit-text"><strong class="event-benefit-value">3×<\/strong> Candy<\/span><\/li>/);
 assert.doesNotMatch(html,/<p class="event-benefit-scope"/);assert.match(html,/Ticket required/);
});
test('compact timing keeps local, fixed and unconfirmed venue semantics distinct',()=>{
 const ctx={eventPresentationDomain:{timingBasis:e=>e.basis},i18nCore:{t:key=>key},Intl};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function eventTimeBasisLabel('),source.indexOf('function eventBonusText(')),ctx);
 assert.equal(ctx.eventTimeBasisLabel({basis:'local'},{compact:true}),'events.localTimeShort');assert.equal(ctx.eventTimeBasisLabel({basis:'fixed'},{compact:true}),'events.yourTimeShort');assert.equal(ctx.eventTimeBasisLabel({basis:'venue-unknown'},{compact:true}),'events.venueTimeShort');assert.equal(ctx.eventTimeBasisLabel({basis:'fixed'}),'events.fixedTime');
});
