const {test,expect}=require('@playwright/test');

test.use({serviceWorkers:'block'});
test('Share publishes a multiline note through the real action',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    const note='Saturday\nAfter 3 pm';
    allData=normalizeData({users:{AuditViewer:{authUid:'local-share-integrity',intentDeclarations:[{entityId:'audit-note-entry',name:'Pikachu',side:'lf',p:'H',note}]}}});
    publishPublicShareNow=async()=>{window.__publishedDeclarations=publicSharePublicationDomain.publicDeclarations(productDeclarations().entries);return{status:'published'};};
    publicSharePublicationCurrent=()=>true;
    openProductShare('link');
  });
  await page.locator('#product-share-link button').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopied');
  const publication=await page.evaluate(()=>({note:window.__publishedDeclarations[0].note,copied:window.__copied}));
  expect(publication.note).toBe('Saturday\u2028After 3 pm');
  expect(publication.copied).toContain('?view=AuditViewer&list=wishlist');

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
