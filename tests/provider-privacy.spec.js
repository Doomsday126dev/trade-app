const {test,expect}=require('@playwright/test');

test('privacy notice is standalone, responsive, and skips Firebase startup',async({page})=>{
  const firebaseRequests=[];
  page.on('request',request=>{
    if(request.url().includes('firebasejs'))firebaseRequests.push(request.url());
  });

  await page.goto(`./?legal=privacy&check=${Date.now()}`,{waitUntil:'domcontentloaded'});

  await expect(page).toHaveTitle('Privacy notice - PoGo Trades');
  await expect(page.locator('#privacy-pg')).toBeVisible();
  await expect(page.locator('#privacy-title')).toHaveText('Privacy notice');
  await expect(page.locator('#login-pg')).toBeHidden();
  await expect(page.locator('#config-pg')).toBeHidden();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.getByRole('link',{name:'Back to app'})).toBeVisible();

  const geometry=await page.evaluate(()=>({
    viewport:innerWidth,
    documentWidth:document.documentElement.scrollWidth,
    article:document.getElementById('privacy-pg').getBoundingClientRect().toJSON(),
    shellReady:window.__pogoShellReady,
    firebaseStarted:Boolean(window.__pogoEarlyAuth?.sdkPromise)
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.article.left).toBeGreaterThanOrEqual(0);
  expect(geometry.article.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.shellReady).toBe(true);
  expect(geometry.firebaseStarted).toBe(false);
  expect(firebaseRequests).toEqual([]);
});
