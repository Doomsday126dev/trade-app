// PoGo Trades — Service Worker
// Strategy:
//   - App shell (HTML/CSS/JS/manifest): network-first, fall back to cache
//   - Sprite images (Pokémon sprites from any CDN): cache-first, network fallback,
//     trimmed by max entry count to keep storage bounded
//   - Firebase realtime endpoints: never cached (always network)

const RELEASE='2026-09-04.87';
const VERSION=`pogo-trades-${RELEASE}`;
const SHELL_CACHE=`shell-${VERSION}`;
const SPRITE_CACHE=`sprites-${VERSION}`;
const INSTALL_FETCH_CONCURRENCY=8;
const CURRENT_CACHE_NAMES=new Set([SHELL_CACHE,SPRITE_CACHE]);
const OWNED_CACHE_PATTERNS=[
  /^shell-pogo-trades-(?:v\d+|\d{4}-\d{2}-\d{2}\.\d+)(?:-installing)?$/,
  /^sprites-pogo-trades-(?:v\d+|\d{4}-\d{2}-\d{2}\.\d+)$/
];

// Files we explicitly precache on install. The actual HTML/JS bytes vary by
// commit, so we revalidate them with a network-first fetch — but we still want
// them in the cache before the user first goes offline.
const RELEASE_ASSETS=[
  'css/app.css',
  'data.js',
  'js/domain/productLimits.js',
  'js/domain/priorities.js',
  'js/ui/badges.js',
  'js/domain/username.js',
  'js/domain/requestAccess.js',
  'js/domain/backgroundCatalog.js',
  'js/domain/backgroundVisual.js',
  'js/domain/pokemonPrimaryTypes.js',
  'js/domain/priorityValues.js',
  'js/domain/scheduleDates.js',
  'js/domain/pokemonSearchTerms.js',
  'js/domain/pokemonEntryRules.js',
  'js/domain/pokemonGoSearchSyntax.js',
  'js/domain/searchStrings.js',
  'js/ui/stringHtml.js',
  'js/domain/scheduleEventRules.js',
  'js/domain/scheduleTradeRules.js',
  'js/domain/pokemonKeys.js',
  'js/domain/publicPokemonDex.js',
  'js/domain/spriteSlugs.js',
  'js/domain/costumeSpriteCatalog.js',
  'js/domain/fuzzyText.js',
  'js/domain/autocompleteText.js',
  'js/domain/autocompleteMatching.js',
  'js/domain/autocompleteRanking.js',
  'js/domain/relativeTime.js',
  'js/domain/clientRelease.js',
  'js/domain/favoriteCardInteractions.js',
  'js/domain/favoritePokemonBrowse.js',
  'js/domain/trainerDiscovery.js',
  'js/domain/tradeListComparison.js',
  'js/domain/eventPresentation.js',
  'js/domain/publicSharePublication.js',
  'js/domain/providerPublicProjection.js',
  'js/domain/accountSyncModel.js',
  'js/domain/accountSyncMerge.js',
  'js/domain/accountSyncMigration.js',
  'js/domain/accountSyncProduct.js',
  'js/domain/trainerPreferences.js',
  'js/domain/trainerPreferenceSync.js',
  'js/domain/authenticationReadiness.js',
  'js/domain/loginDirectory.js',
  'js/utils/textSafety.js',
  'js/ui/stringPanels.js',
  'js/ui/emptyState.js',
  'js/i18n/locales/en.js',
  'js/i18n/locales/ja.js',
  'js/i18n/locales/es.js',
  'js/i18n/locales/de.js',
  'js/i18n/pokemonNames/catalog.js',
  'js/i18n/pokemonNames/variants.js',
  'js/i18n/pokemonNames/structuredForms.js',
  'js/i18n/pokemonNames/core.js',
  'js/i18n/eventLabels/currentTitles.js',
  'js/i18n/eventLabels/core.js',
  'js/i18n/core.js',
  'js/services/firebaseClient.js',
  'js/services/firebaseAppCheck.js',
  'js/services/providerPublicShareGateway.js',
  'js/services/e1ClientFoundationCanary.js',
  'js/data/subscriptionManager.js',
  'js/data/listenerLifecycle.js',
  'js/data/sessionCacheBoundary.js',
  'js/data/firebaseReadRegistry.js',
  'js/data/currentUserRepository.js',
  'js/data/ownedDataCoordinator.js',
  'js/data/publicShareRepository.js',
  'js/data/trainerHistoryStore.js',
  'js/data/favoriteShareSessionCache.js',
  'js/data/trainerPreferencesRepository.js',
  'js/data/trainerPreferenceSyncQueue.js',
  'js/data/accountSyncJournal.js',
  'js/data/accountSyncRepository.js',
  'js/data/accountSyncController.js',
  'js/data/accountSyncRuntime.js',
  'js/domain/cacheAdapters.js',
  'js/ui/trainerTagPanel.js',
  'js/app/publicShareApp.js',
  'js/app/application.js'
];
// Required for complete offline feature support, but intentionally omitted
// from the startup script graph and loaded only when its feature is used.
const LAZY_RELEASE_ASSETS=[
  'js/domain/specialTradeBoardExport.js'
];
const REQUIRED_SHELL_URLS=[
  `./index.html?v=${RELEASE}`,
  ...RELEASE_ASSETS.map(path=>`./${path}?v=${RELEASE}`),
  ...LAZY_RELEASE_ASSETS.map(path=>`./${path}?v=${RELEASE}`)
];
const OPTIONAL_SHELL_URLS=[
  `./?v=${RELEASE}`,
  './manifest.json',
  './assets/tradeloop-icon.svg',
  './assets/tradeloop-icon-96.png',
  './assets/tradeloop-icon-180.png',
  './assets/tradeloop-icon-192.png',
  './assets/tradeloop-icon-512.png',
  './assets/max-cloud.svg'
];
const OPTIONAL_RUNTIME_PATHS=new Set(OPTIONAL_SHELL_URLS.filter(path=>!path.startsWith('./?')).map(path=>new URL(path,self.location.href).pathname));

const SPRITE_CACHE_LIMIT=400;
const SPRITE_HOSTS=[
  'raw.githubusercontent.com',
  'images.weserv.nl',
  'img.pokemondb.net'
];

async function runBounded(items,limit,work){
  let nextIndex=0;
  let firstFailure=null;
  async function worker(){
    while(!firstFailure&&nextIndex<items.length){
      const index=nextIndex++;
      try{await work(items[index],index);}catch(error){firstFailure||=error;}
    }
  }
  const workerCount=Math.min(Math.max(1,limit),items.length);
  await Promise.all(Array.from({length:workerCount},worker));
  if(firstFailure)throw firstFailure;
}

async function cacheRequiredShell(){
  const existing=await caches.open(SHELL_CACHE);
  const existingRequired=await Promise.all(REQUIRED_SHELL_URLS.map(url=>existing.match(url)));
  const hadCompleteShell=existingRequired.every(Boolean);
  if(hadCompleteShell)return;
  await caches.delete(SHELL_CACHE);
  const candidate=await caches.open(SHELL_CACHE);
  try{
    await runBounded(REQUIRED_SHELL_URLS,INSTALL_FETCH_CONCURRENCY,async url=>{
      const response=await fetch(url,{cache:'reload'});
      if(!response?.ok)throw new Error(`Required shell asset failed: ${url} (${response?.status||'network'})`);
      await candidate.put(url,response);
    });
    const complete=await Promise.all(REQUIRED_SHELL_URLS.map(url=>candidate.match(url)));
    if(complete.some(response=>!response))throw new Error('Required shell cache is incomplete');
  }catch(error){
    await caches.delete(SHELL_CACHE);
    throw error;
  }
}

self.addEventListener('install',ev=>{
  ev.waitUntil((async()=>{
    await cacheRequiredShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',ev=>{
  ev.waitUntil((async()=>{
    const shell=await caches.open(SHELL_CACHE);
    const complete=await Promise.all(REQUIRED_SHELL_URLS.map(url=>shell.match(url)));
    if(complete.some(response=>!response)){
      await caches.delete(SHELL_CACHE);
      throw new Error('Refusing to activate without a complete required shell');
    }
    const names=await caches.keys();
    await Promise.all(names.filter(isObsoleteTradeAppCache).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',ev=>{
  if(ev.data!=='SKIP_WAITING')return;
  ev.waitUntil((async()=>{
    const shell=await caches.open(SHELL_CACHE);
    const complete=await Promise.all(REQUIRED_SHELL_URLS.map(url=>shell.match(url)));
    if(complete.every(Boolean))await self.skipWaiting();
    else await caches.delete(SHELL_CACHE);
  })());
});

function isSpriteRequest(url){
  if(url.origin===self.location.origin&&/\/assets\/sprites\/go\/[a-z0-9-]+\.png$/i.test(url.pathname))return true;
  if(!SPRITE_HOSTS.includes(url.hostname))return false;
  // Restrict to image-like requests
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(url.pathname)||url.pathname.includes('/sprites/')||url.searchParams.has('url');
}

function isFirebase(url){
  return url.hostname.endsWith('.firebaseio.com')||
    url.hostname.endsWith('.firebasedatabase.app')||
    url.hostname.includes('googleapis.com')||
    url.hostname.includes('firebaseinstallations')||
    url.hostname.includes('googleusercontent.com');
}

function isTradeAppCacheName(name){
  return OWNED_CACHE_PATTERNS.some(pattern=>pattern.test(name));
}

function isObsoleteTradeAppCache(name){
  return isTradeAppCacheName(name)&&!CURRENT_CACHE_NAMES.has(name);
}

function keepCacheWorkAlive(event,work){
  const handled=Promise.resolve(work).catch(error=>{
    console.warn('Service-worker cache maintenance failed',error);
  });
  event.waitUntil(handled);
  return handled;
}

async function trimCache(cacheName,limit){
  const cache=await caches.open(cacheName);
  const keys=await cache.keys();
  if(keys.length<=limit)return;
  // Drop the oldest entries first (insertion order)
  const drop=keys.length-limit;
  for(let i=0;i<drop;i++)await cache.delete(keys[i]);
}

function networkFirst(req,event){
  const cachePromise=caches.open(SHELL_CACHE);
  const freshPromise=fetch(req);
  const cacheKey=runtimeShellCacheKey(req);
  if(cacheKey)keepCacheWorkAlive(event,Promise.all([cachePromise,freshPromise]).then(async([cache,fresh])=>{
    if(fresh&&fresh.ok&&cacheKey)await cache.put(cacheKey,fresh.clone());
  }));
  return freshPromise.catch(async e=>{
    const cache=await cachePromise;
    const cached=await cache.match(req);
    if(cached)return cached;
    // Last resort: serve cached index.html for navigations
    if(req.mode==='navigate'){
      const root=await cache.match(`./index.html?v=${RELEASE}`)||await cache.match(`./?v=${RELEASE}`);
      if(root)return root;
    }
    throw e;
  });
}

function runtimeShellCacheKey(req){
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||req.mode==='navigate')return null;
  if(!OPTIONAL_RUNTIME_PATHS.has(url.pathname))return null;
  url.search='';url.hash='';
  return url.href;
}

function releaseAsset(req,event){
  const result=caches.open(SHELL_CACHE).then(async cache=>{
    const hit=await cache.match(req);
    if(hit)return{cache,response:hit,cacheable:false};
    const fresh=await fetch(req,{cache:'reload'});
    return{cache,response:fresh,cacheable:Boolean(fresh&&fresh.ok)};
  });
  keepCacheWorkAlive(event,result.then(async({cache,response,cacheable})=>{
    if(cacheable)await cache.put(req,response.clone());
  }));
  return result.then(({response})=>response);
}

let spriteCacheMutation=Promise.resolve();
function queueSpriteCacheMutation(task){
  const run=spriteCacheMutation.then(task,task);
  spriteCacheMutation=run.catch(()=>{});
  return run;
}

function cacheFirst(req,event){
  const result=caches.open(SPRITE_CACHE).then(async cache=>{
    const hit=await cache.match(req);
    if(hit)return{cache,response:hit,cacheable:false};
    const fresh=await fetch(req);
    return{cache,response:fresh,cacheable:Boolean(fresh&&fresh.ok)};
  });
  keepCacheWorkAlive(event,result.then(({cache,response,cacheable})=>{
    if(!cacheable)return;
    return queueSpriteCacheMutation(async()=>{
      await cache.put(req,response.clone());
      await trimCache(SPRITE_CACHE,SPRITE_CACHE_LIMIT);
    });
  }));
  // Propagate failures so the element's bounded onerror fallback chain runs.
  // A successful transparent placeholder would suppress that fallback.
  return result.then(({response})=>response);
}

self.addEventListener('fetch',ev=>{
  const req=ev.request;
  if(req.method!=='GET')return;
  let url;
  try{url=new URL(req.url);}catch{return;}
  // Never cache Firebase calls
  if(isFirebase(url))return;
  // Sprites
  if(isSpriteRequest(url)){
    ev.respondWith(cacheFirst(req,ev));
    return;
  }
  // Same-origin app shell
  if(url.origin===self.location.origin){
    ev.respondWith(url.searchParams.get('v')===RELEASE?releaseAsset(req,ev):networkFirst(req,ev));
    return;
  }
});
