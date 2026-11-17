const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
test('public sign-in help and request flow work with keyboard at phone width',async({page,baseURL})=>{
  await page.setViewportSize({width:390,height:844});
  // Synthetic, fully isolated browser: the app can read only this local checkout.
  const origin=new URL(baseURL).origin;
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto('./',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('public-help-test'));
  await page.waitForFunction(()=>window.__pogoStartup?.firebaseStartupSettledAt!=null);
  const request=page.getByRole('button',{name:'Request access to join'}),help=page.getByRole('button',{name:'Having trouble signing in?'});
  await expect(page.getByRole('heading',{name:'PoGo Trades',exact:true})).toBeVisible();
  await request.focus();await request.press('Enter');await expect(page.locator('#request-heading')).toBeFocused();
  await page.locator('.req-back').click();await expect(request).toBeFocused();
  await help.press('Enter');await expect(page.getByRole('dialog',{name:'Sign-in help'})).toBeVisible();await expect(page.locator('#signin-guide-title')).toBeFocused();
  await expect(page.getByText('Forgot your PIN?',{exact:true})).toBeVisible();await expect(page.locator('#login-health-modal')).toBeHidden();
  if(process.env.SIGNIN_REVIEW_DIR)await page.screenshot({path:process.env.SIGNIN_REVIEW_DIR+'/phone-help.png'});
  await page.getByRole('button',{name:'Technical details'}).click();await expect(page.locator('#login-health-title')).toBeFocused();
  await page.keyboard.press('Escape');await expect(help).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  if(process.env.SIGNIN_REVIEW_DIR)await page.screenshot({path:process.env.SIGNIN_REVIEW_DIR+'/phone-entry.png'});
});

test('setup heading, URL input and skip stay inside the setup card after HTML parsing',async({page})=>{
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  const config=source.slice(source.indexOf('<!-- CONFIG -->'),source.indexOf('<!-- LOGIN -->'));
  await page.setContent(config);
  const card=page.locator('#config-pg > .lcard');
  await expect(card).toHaveCount(1);
  await expect(card.locator('h1.llogo')).toHaveCount(1);
  await expect(card.locator('#fb-url')).toHaveCount(1);
  await expect(card.locator('.skip')).toHaveCount(1);
  await expect(card.locator('h2[data-i18n="setup.title"]')).toHaveCount(1);
});
