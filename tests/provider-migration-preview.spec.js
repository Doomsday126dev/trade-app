const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8886/')?route.continue():route.abort());
  await page.goto('/tests/fixtures/provider-migration-preview.html');
});
test('notice is nonmodal, keyboard accessible, and dismisses across reload',async({page})=>{
  const notice=page.getByRole('region',{name:'Keep access to this trainer account'});
  await expect(notice).toBeVisible();
  await page.screenshot({path:`.local/provider-migration/${test.info().project.name}-reminder.png`,fullPage:true});await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Review Google sign-in'})).toBeVisible();
  await page.getByRole('button',{name:'Remind me in 30 days'}).focus();await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0);await page.reload();await expect(notice).toHaveCount(0);
  expect(await page.evaluate(()=>preview.confirms)).toBe(0);
});
test('Discord review can cancel a wrong identity before any linking',async({page})=>{
  await page.getByRole('button',{name:'Review Discord sign-in'}).click();
  await expect(page.getByRole('heading',{name:'Confirm your Discord account'})).toBeFocused();
  await expect(page.getByText('SyntheticDiscordUser',{exact:true})).toBeVisible();
  await page.screenshot({path:`.local/provider-migration/${test.info().project.name}-discord-review.png`,fullPage:true});
  expect(await page.evaluate(()=>preview.confirms)).toBe(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByText('Canceled. No provider linked; PIN still works.')).toBeVisible();
  expect(await page.evaluate(()=>preview.confirms)).toBe(0);
  await expect(page.getByRole('heading',{name:'My List',exact:true})).toBeFocused();
});
test('confirmation is explicit, does not overflow, and keeps synthetic list intact',async({page})=>{
  await page.getByRole('button',{name:'Review Discord sign-in'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Connect this Discord account'}).click();
  await expect(page.getByText('Simulation complete. Same trainer account; all data preserved.')).toBeVisible();
  await expect(page.getByText('Pikachu · shiny · high priority')).toBeVisible();
  expect(await page.evaluate(()=>preview.confirms)).toBe(1);
});
test('account switch removes reminder and provider text is never interpreted as HTML',async({page})=>{
  await page.evaluate(()=>preview.switchAccount());await expect(page.getByRole('button',{name:'Review Discord sign-in'})).toHaveCount(0);
  await page.evaluate(()=>preview.renderMaliciousLabel());await expect(page.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();
  await expect(page.locator('#security img')).toHaveCount(0);
});
