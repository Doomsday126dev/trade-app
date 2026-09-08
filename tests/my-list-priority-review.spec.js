const {test,expect}=require('@playwright/test');
const {mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const {installPriorityReviewFixture,settlePriorityReview}=require('./helpers/my-list-priority-fixture.cjs');

const output=process.env.MY_LIST_PRIORITY_REVIEW_DIR;
const baseline=process.env.BASELINE==='1';
const phase=baseline?'before':'after';
test.use({serviceWorkers:'block',trace:'off',actionTimeout:15000});

test('matched My List priority visual review',async({page})=>{
  test.skip(!output,'Explicit visual review artifact capture only.');
  test.setTimeout(240000);
  const directory=path.join(output,phase);mkdirSync(directory,{recursive:true});
  const records=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await installPriorityReviewFixture(page);
  const save=async(name,{fullPage=false,element=''}={})=>{
    await settlePriorityReview(page);
    const audit=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      rows:document.querySelectorAll('#combined-list .wants-row').length,
      sections:[...document.querySelectorAll('#combined-list > section')].map(section=>({key:section.dataset.wantsSection||section.dataset.wantsPriority,title:section.querySelector('h3')?.textContent})),
      brokenImages:[...document.querySelectorAll('#combined-list img')].filter(image=>!image.naturalWidth).map(image=>image.alt),
      rowHeight:document.querySelector('#combined-list .wants-row')?.getBoundingClientRect().height,
      declarations:productDeclarations().entries.length}));
    const imageOptions={path:path.join(directory,name+'.png'),animations:'disabled'};
    if(element)await page.locator(element).screenshot(imageOptions);else await page.screenshot({...imageOptions,fullPage});
    records.push({name,...audit});
    expect(audit.scrollWidth,`${name}: no horizontal page overflow`).toBeLessThanOrEqual(audit.width);
    expect(audit.brokenImages,`${name}: exact sprites loaded`).toEqual([]);
  };
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:740}]){
    await page.setViewportSize(viewport);await page.evaluate(()=>window.scrollTo(0,0));
    await save(`my-list-${viewport.width}-dark`);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#combined-list').evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+scrollY-130));
  await save('priority-and-special-sections',{element:'#combined-list'});
  await page.evaluate(()=>window.scrollTo(0,0));
  if(baseline)await page.evaluate(()=>{
    const groups=combinedGroups();
    for(const group of groups.slice(0,4))selectCombinedGroup(combinedKey(group[0]),true);
    renderCombinedList();window.scrollTo(0,0);
  });
  else{
    await page.locator('#wants-select-toggle').click();
    for(let index=0;index<4;index++)await page.locator('#combined-list .wants-select').nth(index).check();
    await page.evaluate(()=>window.scrollTo(0,0));
  }
  await save('selection-active');
  await page.evaluate(baseline=>{
    if(baseline){combinedSelection.clear();renderCombinedList();}else clearWantsSelection();
    const advanced=document.getElementById('legacy-list-tools');advanced.open=true;
    window.scrollTo(0,advanced.getBoundingClientRect().top+scrollY-130);
  },baseline);
  if(!baseline){
    await page.locator('[data-wants-scope="H"]').click();
    await page.locator('[data-wants-scope="M"]').click();
  }
  await save('advanced-custom-search');
  await page.evaluate(()=>{document.getElementById('legacy-list-tools').open=false;window.scrollTo(0,0);});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===1440?900:844});
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await save(`my-list-${width}-light`);
  }
  const image=await page.evaluate(async()=>{
    const blob=await renderProductShareImage(productDeclarations().entries,cur);
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
  });
  writeFileSync(path.join(directory,'generated-wants.png'),Buffer.from(image,'base64'));
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__priorityReviewData));
  writeFileSync(path.join(directory,'capture.json'),JSON.stringify({phase,baseCommit:'1d8f415',synthetic:true,records,errors},null,2));
});

test('large-list visual review stays bounded',async({page})=>{
  test.skip(!output||baseline,'Candidate large-list review capture only.');
  test.setTimeout(90000);
  await installPriorityReviewFixture(page,{large:true});
  const state=await page.evaluate(()=>({...window.__pogoMyListRenderState,declarations:productDeclarations().entries.length}));
  expect(state.declarations).toBeGreaterThanOrEqual(1000);expect(state.rendered).toBeLessThanOrEqual(120);
  expect(state.hasMore).toBe(true);
  writeFileSync(path.join(output,phase,'large-list.json'),JSON.stringify(state,null,2));
});
