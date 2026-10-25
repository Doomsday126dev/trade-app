const {test,expect}=require('@playwright/test');
const {fixture}=require('./helpers/usability-fixture.cjs');
const events=require('./fixtures/events-source/events-2026-10-25.json');
for(const width of [390,1440])for(const locale of ['en','ja'])test(`Details stays aligned and returns focus at ${width}px (${locale})`,async({page})=>{
 await page.setViewportSize({width,height:900});await fixture(page);await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});
 await page.evaluate(async({events,locale})=>{await changeInterfaceLocale(locale);applyTheme(locale==='en'?'dark':'light');_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';switchTab('schedule');renderEventsOnly();},{events,locale});
 const card=page.locator('.event-card[data-event-id="season-24-twilight-trails"]'),button=card.locator('.event-card-cue');await expect(button).toHaveAccessibleName(/Twilight|トワイライト/);
 const metrics=await button.evaluate(el=>{const b=el.getBoundingClientRect(),icon=el.querySelector('svg').getBoundingClientRect(),label=el.querySelector('span').getBoundingClientRect();return{height:b.height,iconWidth:icon.width,centerDelta:Math.abs(icon.y+icon.height/2-label.y-label.height/2),background:getComputedStyle(el).backgroundColor}});
 expect(metrics.height).toBeGreaterThanOrEqual(44);expect(metrics.iconWidth).toBe(16);expect(metrics.centerDelta).toBeLessThan(2);
 await button.focus();await page.keyboard.press('Enter');await expect(page.locator('#event-detail-modal')).toBeVisible();await expect(page.locator('#event-detail-body')).toContainText('Rank 75');await page.keyboard.press('Escape');await expect(button).toBeFocused();await expect(page.locator('#event-detail-modal')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
