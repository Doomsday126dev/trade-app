const {test,expect}=require('@playwright/test');
// Trace DOM snapshots run on the throttled page and contaminate product timings.
test.use({trace:'off'});

async function installListFixture(page,count){
  return page.evaluate(count=>{
    managedSubscriptions?.unsubscribeAll?.();
    managedListenerLifecycle?.deactivateSession?.('performance_fixture');
    db=null;fbOn=false;managedFirebaseClient=null;
    cur='PerformanceFixture';auth={currentUser:{uid:'uid-performance-fixture'}};
    const list={};
    for(let index=0;index<count;index++){
      const name=`Synthetic Pokemon ${String(index).padStart(4,'0')}`;
      const priority=index%3===0?'H':index%3===1?'M':'L';
      list[name]=`${priority}${index%17===0?'[lucky]':''}${index%29===0?'(Long localized variant フォルム 🌟)':''}`;
    }
    allData=normalizeData({users:{PerformanceFixture:{}},wishlist:{PerformanceFixture:list}});
    myListType='wishlist';bulkMode=false;bulkSelected.clear();
    resetMyListPerformanceState();
    document.getElementById('combined-list').replaceChildren();
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
    document.getElementById('tab-mylist').classList.add('active');
    document.getElementById('combined-filter').value='';
    document.getElementById('combined-search').replaceChildren();
    const start=performance.now();renderMyList();const renderMs=performance.now()-start;
    const out=document.getElementById('combined-list');
    return{
      count,renderMs,rows:out.querySelectorAll('.myrow').length,nodes:out.querySelectorAll('*').length,
      controls:out.querySelectorAll('button,input,summary,details').length,
      hydratedEditors:out.querySelectorAll('.myrow-editor-popover').length,htmlBytes:new Blob([out.innerHTML]).size,
      paginated:window.__pogoMyListRenderState.hasMore
    };
  },count);
}

test.describe('isolated My List scale profile',()=>{
  test('correctness and structural bounds remain stable through 1,000 entries',async({page},testInfo)=>{
    test.skip(testInfo.project.name!=='desktop','Isolated desktop benchmark avoids duplicate noisy timing runs.');
    await page.route(url=>url.hostname.endsWith('.firebaseio.com')||url.hostname.endsWith('.firebasedatabase.app')||url.hostname.endsWith('googleapis.com'),route=>route.abort());
    await page.goto(`./?my-list-performance=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
    await page.evaluate(()=>window.__pogoEnsureFullApp('my-list-performance-test'));
    await page.waitForFunction(()=>typeof renderMyList==='function'&&typeof resetMyListPerformanceState==='function'&&_authStateKnown===true&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
    const measurements=[];
    for(const count of [100,250,500,1000]){
      const measurement=await installListFixture(page,count);
      expect(measurement.rows).toBe(Math.min(count,120));
      expect(measurement.hydratedEditors).toBe(0);
      expect(measurement.nodes).toBeLessThanOrEqual(2500);
      expect(measurement.controls).toBeLessThanOrEqual(1000);
      expect(measurement.htmlBytes).toBeLessThanOrEqual(350*1024);
      expect(measurement.renderMs).toBeLessThan(200);
      expect(measurement.paginated).toBe(count>120);
      await page.evaluate(()=>waitForMyListRender());
      expect(await page.locator('#combined-list .myrow').count()).toBe(Math.min(count,120));
      // Explicit pagination must make every entry reachable, without idle DOM expansion.
      while(await page.locator('#combined-list > button').count())await page.locator('#combined-list > button').click();
      expect(await page.locator('#combined-list .myrow').count()).toBe(count);
      await page.evaluate(()=>{combinedLimit=120;renderMyList();});
      const filter=await page.evaluate(()=>{
        const start=performance.now();renderMyList('Synthetic Pokemon 0999',{reason:'filter'});
        return{ms:performance.now()-start,rows:[...document.querySelectorAll('#combined-list .myrow')].filter(row=>!row.hidden).length};
      });
      expect(filter.ms).toBeLessThan(count===1000?100:75);
      expect(filter.rows).toBe(count===1000?1:0);
      const update=await page.evaluate(()=>{
        renderMyList('');const first=document.querySelector('#combined-list .myrow');
        const name=first.dataset.name;allData.wishlist[cur][name]='M';
        const start=performance.now();renderMyList();
        return{ms:performance.now()-start,rows:document.querySelectorAll('#combined-list .myrow').length};
      });
      expect(update.rows).toBeLessThanOrEqual(count);expect(update.ms).toBeLessThan(100);
      await page.evaluate(()=>waitForMyListRender());
      await page.locator('#combined-list .myrow-edit').first().click();
      await expect(page.locator('#combined-editor-modal')).toBeVisible();
      if(await page.locator('#combined-editor-modal details').getAttribute('open')===null)await page.locator('#combined-editor-modal details > summary').click();
      await expect(page.locator('#combined-priority')).toBeVisible();
      await expect(page.locator('#combined-list .myrow-remove')).toHaveCount(Math.min(count,120));
      await page.evaluate(()=>closeModal('combined-editor-modal'));
      measurements.push({...measurement,filterMs:filter.ms,rowUpdateMs:update.ms});
    }
    console.log(`MY_LIST_PERF ${JSON.stringify(measurements)}`);
  });

  test('120-row filtering and row edits stay within 4x CPU product budgets',async({page},testInfo)=>{
    test.skip(testInfo.project.name!=='desktop','One deterministic Chromium profile owns performance thresholds.');
    await page.route(url=>url.hostname.endsWith('.firebaseio.com')||url.hostname.endsWith('.firebasedatabase.app')||url.hostname.endsWith('googleapis.com'),route=>route.abort());
    await page.addInitScript(()=>{
      window.__myListLongTasks=[];
      window.__myListLongTaskWindowStart=Infinity;
      try{new PerformanceObserver(list=>window.__myListLongTasks.push(...list.getEntries().filter(entry=>entry.startTime>=window.__myListLongTaskWindowStart).map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask',buffered:true});}catch{}
    });
    await page.goto(`./?my-list-budget=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
    await page.evaluate(()=>window.__pogoEnsureFullApp('my-list-budget-test'));
    await page.waitForFunction(()=>typeof renderMyList==='function'&&_authStateKnown===true&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
    const client=await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate',{rate:4});
    await installListFixture(page,120);
    // Finish fixture work before measuring interactions, including late observer delivery.
    await page.evaluate(async()=>{await waitForMyListRender();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    await page.evaluate(()=>{
      window.__myListLongTasks=[];
      window.__myListLongTaskWindowStart=performance.now();
      window.__myListSearchBuildCalls=0;
      const original=refreshCombinedSearch;
      refreshCombinedSearch=(...args)=>{window.__myListSearchBuildCalls++;return original(...args);};
      window.__declarationBuildCalls=0;
      const originalDeclarations=productDeclarations;
      productDeclarations=(...args)=>{window.__declarationBuildCalls++;return originalDeclarations(...args);};
    });
    const result=await page.evaluate(async()=>{
      const phases={interactionStart:performance.now()};
      const stable=document.querySelectorAll('#combined-list .myrow')[1];
      const filterStart=performance.now();renderMyList('Synthetic Pokemon 0119',{reason:'filter'});const filterMs=performance.now()-filterStart;
      phases.filterEnd=performance.now();
      const filterDeclarationBuilds=window.__declarationBuildCalls;
      const matched=[...document.querySelectorAll('#combined-list .myrow')].filter(row=>!row.hidden).length;
      const clearStart=performance.now();renderMyList('',{reason:'filter'});const clearMs=performance.now()-clearStart;
      phases.clearEnd=performance.now();
      const first=document.querySelector('#combined-list .myrow'),firstBefore=first;
      allData.wishlist[cur][first.dataset.name]='M[shiny]';
      const editStart=performance.now();renderMyList();const editMs=performance.now()-editStart;
      phases.editEnd=performance.now();
      const searchBuildsImmediatelyAfterEdit=window.__myListSearchBuildCalls;
      const firstAfter=[...document.querySelectorAll('#combined-list .myrow')].find(row=>row.dataset.name===firstBefore.dataset.name);
      const stableRowPreserved=stable===[...document.querySelectorAll('#combined-list .myrow')].find(row=>row.dataset.name===stable.dataset.name);
      const input=document.getElementById('combined-filter');
      for(const value of['S','Sy','Synthetic Pokemon 0007']){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
      phases.inputEnd=performance.now();
      await new Promise(resolve=>setTimeout(resolve,MY_LIST_FILTER_DELAY_MS+40));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await waitForMyListRender();
      return{
        filterMs,clearMs,editMs,matched,filterDeclarationBuilds,
        stableRowPreserved,
        changedRowReplaced:firstBefore!==firstAfter,
        searchBuildsImmediatelyAfterEdit,
        searchBuildsAfterSettle:window.__myListSearchBuildCalls,
        latestQuery:window.__pogoMyListRenderState?.query,
        visible:[...document.querySelectorAll('#combined-list .myrow')].filter(row=>!row.hidden).length,
        maxLongTask:Math.max(0,...window.__myListLongTasks.map(entry=>entry.duration)),
        longTasks:window.__myListLongTasks,phases:{...phases,settled:performance.now()},
        measurementStart:window.__myListLongTaskWindowStart
      };
    });
    await client.send('Emulation.setCPUThrottlingRate',{rate:1});
    console.log(`MY_LIST_4X_BUDGET ${JSON.stringify(result)}`);
    expect(result).toMatchObject({matched:1,stableRowPreserved:true,changedRowReplaced:true,searchBuildsImmediatelyAfterEdit:3,latestQuery:'synthetic pokemon 0007',visible:1});
    expect(result.searchBuildsAfterSettle).toBe(4);
    expect(result.filterDeclarationBuilds).toBe(1);
    expect(result.filterMs).toBeLessThan(50);
    expect(result.clearMs).toBeLessThan(50);
    expect(result.editMs).toBeLessThan(100);
    expect(Math.max(result.filterMs,result.clearMs,result.editMs)).toBeLessThan(200);
    expect(result.maxLongTask).toBeLessThanOrEqual(200);
  });
});
