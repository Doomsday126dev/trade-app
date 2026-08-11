(function(global){
  const root=global.PogoServices=global.PogoServices||{};
  const initializedApps=new WeakMap();
  const SITE_KEY=/^[A-Za-z0-9_-]{20,256}$/;

  function unavailable(code){
    return Object.freeze({ok:false,code:String(code||'app-check/unavailable')});
  }

  function validSiteKey(siteKey){
    return typeof siteKey==='string'&&SITE_KEY.test(siteKey);
  }

  function initializeAppCheckOnce({app,siteKey,initializeAppCheck,ReCaptchaEnterpriseProvider}={}){
    if(!app||typeof app!=='object')return unavailable('app-check/app-required');
    if(initializedApps.has(app))return initializedApps.get(app);
    if(!validSiteKey(siteKey))return unavailable('app-check/not-configured');
    if(typeof initializeAppCheck!=='function'||typeof ReCaptchaEnterpriseProvider!=='function'){
      return unavailable('app-check/sdk-unavailable');
    }
    let result;
    try{
      const provider=new ReCaptchaEnterpriseProvider(siteKey);
      const instance=initializeAppCheck(app,{provider,isTokenAutoRefreshEnabled:true});
      result=Object.freeze({ok:true,code:'app-check/initialized',instance});
    }catch{
      result=unavailable('app-check/initialization-failed');
    }
    initializedApps.set(app,result);
    return result;
  }

  root.firebaseAppCheck=Object.freeze({initializeAppCheckOnce,unavailable,validSiteKey});
})(window);
