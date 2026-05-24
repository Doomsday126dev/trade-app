// PoGo Trades — Service Worker
// Strategy:
//   - App shell (HTML/CSS/JS/manifest): network-first, fall back to cache
//   - Sprite images (Pokémon sprites from any CDN): cache-first, network fallback,
//     trimmed by max entry count to keep storage bounded
//   - Firebase realtime endpoints: never cached (always network)

const VERSION='pogo-trades-v5';
const SHELL_CACHE=`shell-${VERSION}`;
const SPRITE_CACHE=`sprites-${VERSION}`;

// Files we explicitly precache on install. The actual HTML/JS bytes vary by
// commit, so we revalidate them with a network-first fetch — but we still want
// them in the cache before the user first goes offline.
const SHELL_URLS=[
  './',
  './index.html',
  './data.js',
  './manifest.json'
];

const SPRITE_CACHE_LIMIT=400;
const SPRITE_HOSTS=[
  'raw.githubusercontent.com',
  'images.weserv.nl',
  'www.serebii.net',
  'serebii.net',
  'img.pokemondb.net',
  'cdn08.pokemongohub.net',
  'static.pokemongohub.net'
];

self.addEventListener('install',ev=>{
  ev.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE);
    try{await cache.addAll(SHELL_URLS);}catch(e){/* offline at install time; ok */}
    self.skipWaiting();
  })());
});

self.addEventListener('activate',ev=>{
  ev.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n!==SHELL_CACHE&&n!==SPRITE_CACHE).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',ev=>{
  if(ev.data==='SKIP_WAITING')self.skipWaiting();
});

function isSpriteRequest(url){
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

async function trimCache(cacheName,limit){
  const cache=await caches.open(cacheName);
  const keys=await cache.keys();
  if(keys.length<=limit)return;
  // Drop the oldest entries first (insertion order)
  const drop=keys.length-limit;
  for(let i=0;i<drop;i++)await cache.delete(keys[i]);
}

async function networkFirst(req){
  const cache=await caches.open(SHELL_CACHE);
  try{
    const fresh=await fetch(req);
    if(fresh&&fresh.ok&&req.method==='GET')cache.put(req,fresh.clone());
    return fresh;
  }catch(e){
    const cached=await cache.match(req,{ignoreSearch:true});
    if(cached)return cached;
    // Last resort: serve cached index.html for navigations
    if(req.mode==='navigate'){
      const root=await cache.match('./index.html')||await cache.match('./');
      if(root)return root;
    }
    throw e;
  }
}

async function cacheFirst(req){
  const cache=await caches.open(SPRITE_CACHE);
  const hit=await cache.match(req);
  if(hit)return hit;
  try{
    const fresh=await fetch(req);
    if(fresh&&fresh.ok){
      cache.put(req,fresh.clone());
      trimCache(SPRITE_CACHE,SPRITE_CACHE_LIMIT);
    }
    return fresh;
  }catch(e){
    // Return a 1×1 transparent png so the UI doesn't break
    return new Response(new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}));
  }
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
    ev.respondWith(cacheFirst(req));
    return;
  }
  // Same-origin app shell
  if(url.origin===self.location.origin){
    ev.respondWith(networkFirst(req));
    return;
  }
});
