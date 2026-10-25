const {test,expect}=require('@playwright/test');
const {fixture}=require('./helpers/usability-fixture.cjs');
const events=require('./fixtures/events-source/events-2026-10-25.json');
for(const locale of ['en','ja'])test(`current public event source snapshot shows useful bonuses (${locale})`,async({page})=>{
 await fixture(page);await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});
 await page.evaluate(async({events,locale})=>{await changeInterfaceLocale(locale);_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventCalendarDate='';switchTab('schedule');renderEventsOnly();},{events,locale});
 const season=page.locator('.event-card[data-event-id="season-24-twilight-trails"]');
 await expect(season).toContainText('GO Pass Rank 1');await expect(season).toContainText('31+');
 await expect(season.locator('.event-bonus-source a')).toHaveAttribute('href','https://pokemongo.com/seasons/twilight-trails');
 await expect(page.locator('.event-card[data-event-id="pokemonspotlighthour2026-10-29"]')).toContainText('2× Evolution XP');
 await expect(page.locator('.event-card[data-event-id="palkia-in-5-star-raid-battles-october-2026"]')).toContainText('Palkia');
 await expect(page.locator('.event-card .event-unknown')).toHaveCount(0);
 const pawniard=page.locator('.event-card[data-event-id="november-communityday2026"]');
 await expect(pawniard).toContainText('3-hour Incense');await expect(pawniard).toContainText('excludes Daily Adventure Incense');
 await expect(pawniard).toContainText('excludes Golden Lure Modules');
 if(locale==='ja')await expect(season).toContainText('情報元の詳細は英語です');
 await season.locator('[data-event-action="details"]').first().click();await expect(page.locator('#event-detail-body')).toContainText('Rank 75');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
test('cold start source outage keeps dated bundled facts and a stale status',async({page})=>{
 await fixture(page);await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});
 await page.evaluate(()=>{localStorage.removeItem('pogoEventCache_v1');_eventData=null;_eventLoadState='idle';eventLastAttemptAt=0;switchTab('schedule');});
 await expect(page.locator('.event-card[data-event-id="season-24-twilight-trails"]')).toContainText('GO Pass Rank 1');
 await expect(page.locator('.events-source')).toHaveClass(/is-stale/);
 await expect.poll(()=>page.evaluate(()=>_eventData?.sourceFallback)).toBe(true);
});
