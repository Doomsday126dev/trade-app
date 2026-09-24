const {test,expect}=require('@playwright/test');

test.use({serviceWorkers:'block'});

test('Groups reports a partial removal among same-identity notes',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    const store=ensureTrainerHistoryStore();store.saveFavoriteOrganization('AuditFriend');
    window.__shareIntegrityEntries=[
      {intent:'lf',category:'wishlist',name:'Pikachu',p:'H',note:'Saturday'},
      {intent:'lf',category:'wishlist',name:'Pikachu',p:'H',note:'Sunday'}
    ];
    const cache=favoriteShareSessionCacheData.createFavoriteShareSessionCache({repository:{read:async name=>{
      const declarations=publicSharePublicationDomain.publicDeclarations(window.__shareIntegrityEntries);
      return{ok:true,value:{version:2,username:name,profile:{friendCode:'',lastUpdated:Date.now()},lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],declarations,declarationCount:declarations.length,updatedAt:Date.now()}};
    }},validateProjection:publicSharePublicationDomain.publicShareProjectionStatus,projectSnapshot:favoritePokemonBrowseDomain.projectSnapshot});
    cache.activate({uid:'local-share-integrity',username:cur});ensureFavoriteShareSessionCache=()=>cache;
    switchTab('find',{render:false});setTrainerDiscoveryMode('favorites');document.querySelector('.favorite-groups-disclosure').open=true;renderTrainerQuickLists();
  });
  await page.evaluate(()=>openTrainerGroup('favorites'));
  await expect(page.locator('.group-want')).toHaveCount(2);
  await page.evaluate(()=>markTrainerWantsChecked());
  await page.evaluate(()=>{window.__shareIntegrityEntries=window.__shareIntegrityEntries.slice(0,1);});
  await page.evaluate(()=>openTrainerGroup('favorites'));
  await expect(page.locator('.group-want')).toHaveCount(1);
  const changes=await page.evaluate(()=>trainerGroupModel().members[0].changes);
  expect(changes.updated).toBe(true);expect(changes.removed).toBe(1);
  await expect(page.locator('.group-availability')).not.toContainText('No changes');
});

test('Share publishes a multiline note and copied text distinguishes Max categories once',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    const note='Saturday\nAfter 3 pm';
    allData=normalizeData({users:{AuditViewer:{authUid:'local-share-integrity',intentDeclarations:[{entityId:'audit-note-entry',name:'Pikachu',side:'lf',p:'H',note}]}}});
    publishPublicShareNow=async()=>{window.__publishedDeclarations=publicSharePublicationDomain.publicDeclarations(productDeclarations().entries);return{ok:true,status:'published'};};
    activePublicShareHydrationToken=managedPublicSharePublication.activate({uid:auth.currentUser.uid,username:cur}).token;
    for(const surface of ['profile','wishlist','dynamax','gmax','costumes'])managedPublicSharePublication.markLoaded(activePublicShareHydrationToken,surface);
    openProductShare('link');
  });
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopied');
  const publication=await page.evaluate(()=>({note:window.__publishedDeclarations[0].note,copied:window.__copied}));
  expect(publication.note).toBe('Saturday\u2028After 3 pm');
  expect(publication.copied).toContain('?view=AuditViewer&list=wishlist');

  await page.evaluate(()=>{
    allData=normalizeData({users:{AuditViewer:{authUid:'local-share-integrity'}},wishlist:{AuditViewer:{Bulbasaur:'H'}},dynamax:{AuditViewer:{Bulbasaur:'H'}},gmax:{AuditViewer:{'Gigantamax Charizard':'M'}},costumes:{}});
    openProductShare('text');
  });
  await page.locator('#product-share-primary').click();
  const copied=await page.evaluate(()=>window.__copied);
  expect(copied).toContain('- Bulbasaur · High');
  expect(copied).toContain('- Bulbasaur · Dynamax · High');
  expect(copied).toContain('- Gigantamax Charizard · Medium');
  expect(copied).not.toContain('Gigantamax Charizard · Gigantamax');
});

async function fixture(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174').origin;
  await page.route('**/*',route=>{
    let sameOrigin=false;try{sameOrigin=new URL(route.request().url()).origin===origin;}catch{}
    return sameOrigin?route.continue():route.abort();
  });
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}}));
  await page.goto('./?share-integrity-browser');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');await page.evaluate(()=>__pogoEnsureFullApp('share-integrity-browser'));
  await page.waitForFunction(()=>typeof renderProductShareImage==='function'&&window.__pogoStartup?.firebaseStartupSettledAt>0);
  await page.evaluate(()=>{
    managedListenerLifecycle?.deactivateSession?.('share_integrity_browser');managedListenerLifecycle?.clearSelectedTrainer?.('share_integrity_browser');managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='AuditViewer';auth={currentUser:{uid:'local-share-integrity'}};allData=normalizeData({users:{AuditViewer:{authUid:'local-share-integrity'}}});
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
  });
  expect(errors).toEqual([]);
}
