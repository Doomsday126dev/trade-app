const {test,expect}=require('@playwright/test');

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
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
    document.getElementById('tab-mylist').classList.add('active');
    const start=performance.now();renderMyList();const renderMs=performance.now()-start;
    const out=document.getElementById('mylist-out');
    return{
      count,renderMs,rows:out.querySelectorAll('.myrow').length,nodes:out.querySelectorAll('*').length,
      controls:out.querySelectorAll('button,input,summary,details').length,
      hydratedEditors:out.querySelectorAll('.myrow-editor-popover').length,htmlBytes:new Blob([out.innerHTML]).size
    };
  },count);
}

test.describe('isolated My List scale profile',()=>{
  test('correctness and structural bounds remain stable through 1,000 entries',async({page},testInfo)=>{
    test.skip(testInfo.project.name!=='desktop','Isolated desktop benchmark avoids duplicate noisy timing runs.');
    await page.route(url=>url.hostname.endsWith('.firebaseio.com')||url.hostname.endsWith('.firebasedatabase.app')||url.hostname.endsWith('googleapis.com'),route=>route.abort());
    await page.goto(`./?my-list-performance=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof renderMyList==='function'&&typeof _authStateKnown==='boolean'&&_authStateKnown&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
    const measurements=[];
    for(const count of [100,250,500,1000]){
      const measurement=await installListFixture(page,count);
      expect(measurement.rows).toBe(count);
      expect(measurement.hydratedEditors).toBe(0);
      expect(measurement.nodes).toBeLessThanOrEqual(count*19+1000);
      expect(measurement.renderMs).toBeLessThan(5000);
      const filter=await page.evaluate(()=>{
        const start=performance.now();renderMyList('Synthetic Pokemon 0999');
        return{ms:performance.now()-start,rows:document.querySelectorAll('#mylist-out .myrow').length};
      });
      expect(filter.ms).toBeLessThan(2000);
      expect(filter.rows).toBe(count===1000?1:0);
      const update=await page.evaluate(()=>{
        renderMyList();const first=document.querySelector('#mylist-out .myrow');
        const name=first.dataset.name;allData.wishlist[cur][name]='M';
        const start=performance.now();renderMyList();
        return{ms:performance.now()-start,rows:document.querySelectorAll('#mylist-out .myrow').length};
      });
      expect(update.rows).toBe(count);expect(update.ms).toBeLessThan(5000);
      await page.locator('#mylist-out .myrow-editor summary').first().click();
      await expect(page.locator('#mylist-out .myrow-editor-popover')).toHaveCount(1);
      await expect(page.locator('#mylist-out .myrow-editor-popover .priority-choice')).toHaveCount(3);
      await expect(page.locator('#mylist-out .myrow-editor-popover .flag-btn')).toHaveCount(4);
      await expect(page.locator('#mylist-out .myrow-editor-popover .rm')).toHaveCount(1);
      measurements.push({...measurement,filterMs:filter.ms,rowUpdateMs:update.ms});
    }
    console.log(`MY_LIST_PERF ${JSON.stringify(measurements)}`);
  });
});
