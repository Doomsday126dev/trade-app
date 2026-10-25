const {test,expect}=require('@playwright/test');
const {fixture}=require('./helpers/usability-fixture.cjs');
const events=require('./fixtures/events-source/events-2026-10-25.json');
for(const width of [390,1440])for(const locale of ['en','ja'])test(`GO Pass ranks share benefit rows at ${width}px (${locale})`,async({page})=>{
 await page.setViewportSize({width,height:900});await fixture(page);await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});
 await page.evaluate(async({events,locale})=>{await changeInterfaceLocale(locale);_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';switchTab('schedule');renderEventsOnly();},{events,locale});
 const card=page.locator('.event-card[data-event-id="season-24-twilight-trails"]');
 await expect(card.locator('.event-benefit-list>li')).toHaveCount(3);
 for(const rank of ['1','25','50']){
  const row=card.locator('.event-benefit-list>li').filter({has:page.locator('.event-benefit-scope',{hasText:new RegExp(`Rank ${rank}:$`)})});
  await expect(row).toHaveCount(1);await expect(row.locator('.event-benefit-text')).not.toBeEmpty();
  expect(await row.evaluate(el=>{const a=el.querySelector('.event-benefit-scope').getClientRects()[0],b=el.querySelector('.event-benefit-text').getClientRects()[0];return Math.abs(a.top-b.top)})).toBeLessThan(3);
 }
 await card.locator('[data-event-action="details"]').first().click();const detail=page.locator('#event-detail-body');await expect(detail).toContainText('Rank 75');await expect(detail.locator('.event-benefit-list>li')).toHaveCount(4);await expect(detail).toContainText('not unconditional');await page.keyboard.press('Escape');
 const october=page.locator('.event-card[data-event-id="go-pass-october-2026"]');await october.locator('[data-event-action="details"]').first().click();await expect(detail).toContainText('Deluxe');await expect(detail).toContainText('Trainers level 31');
 await expect(detail.locator('p.event-benefit-scope')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
