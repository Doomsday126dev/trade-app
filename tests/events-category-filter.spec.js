const {test,expect}=require('@playwright/test');const {fixture}=require('./helpers/usability-fixture.cjs');const events=require('./fixtures/events-source/events-2026-10-25.json');
test('visible selected day stays selected when filtering; all upcoming remains available',async({page})=>{
 await fixture(page);await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});await page.evaluate(events=>{_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventCalendarDate='2026-10-25';eventAllSchedule=false;switchTab('schedule');renderEventsOnly();},events);
 await page.locator('.event-filter[data-type="spotlight"]').click();expect(await page.evaluate(()=>eventCalendarDate)).toBe('2026-10-25');await expect(page.locator('.event-agenda-title')).toContainText('October 25');await expect(page.locator('.event-card')).toHaveCount(0);
 await page.locator('[data-event-action="all-schedule"]').first().click();await expect(page.locator('.event-card[data-event-id="pokemonspotlighthour2026-10-29"]')).toBeVisible();
 await page.locator('.event-filter[data-type="max"]').click();await expect(page.locator('.event-card[data-event-id="max-mondays-2026-10-26"]')).toBeVisible();await expect(page.locator('.event-card[data-event-id="max-mondays-2026-11-16"]')).toBeVisible();
 await page.evaluate(()=>setEventCalendarDate('2026-11-16'));await expect(page.locator('.event-agenda-title')).toContainText('November 16');await expect(page.locator('.event-card[data-event-id="max-mondays-2026-11-16"]')).toBeVisible();await expect(page.locator('.event-card[data-event-id="max-mondays-2026-10-26"]')).toHaveCount(0);
 await expect(page.locator('.event-card[data-event-id="max-mondays-2026-11-16"]')).not.toContainText('Sableye');
 await page.locator('[data-event-action="all-schedule"]').first().click();await expect(page.locator('.event-card[data-event-id="max-mondays-2026-10-26"]')).toBeVisible();
});
