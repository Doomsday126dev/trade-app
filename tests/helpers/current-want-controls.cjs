const {expect}=require('@playwright/test');
async function priority(page,value){const select=page.locator('#combined-priority');if(await select.isVisible())await select.selectOption(value);else {const choice=page.locator('#combined-priorities input[value="'+value+'"]');await choice.focus();if(!await choice.isChecked())await choice.press('Space');}await expect(select).toHaveValue(value);}
async function genderDetails(page){if(await page.locator('#combined-gender').isVisible())return;const details=page.locator('#combined-editor-modal details').filter({has:page.locator('#combined-gender')});if(!await details.evaluate(e=>e.open))await details.locator('summary').click();}
async function close(page){const close=page.locator('#combined-close');if(await close.count())await close.click();else await page.locator('#combined-editor-modal button').filter({hasText:'Close'}).click();}
module.exports={priority,genderDetails,close};
