(function(global){
  'use strict';

  const root=global.PogoUi=global.PogoUi||{};
  const CACHE_KEY='pogoPublicSpriteOptical_v1';
  const TARGET_FILL=0.78;
  const MAX_SCALE=2.8;
  const MAX_CACHE_ENTRIES=500;
  const CONCURRENCY=2;
  const queue=[];
  const inflight=new Map();
  let active=0,cache={};
  try{cache=JSON.parse(global.localStorage?.getItem(CACHE_KEY)||'{}')||{};}catch{}

  function fallbackScale(url){
    if(String(url).includes('/assets/sprites/go/'))return 1.05;
    if(String(url).includes('pokemondb.net'))return 1.1;
    return 1.2;
  }
  function save(){
    try{
      const keys=Object.keys(cache);
      if(keys.length>MAX_CACHE_ENTRIES){
        keys.sort((a,b)=>(cache[a]?.t||0)-(cache[b]?.t||0));
        for(const key of keys.slice(0,keys.length-MAX_CACHE_ENTRIES))delete cache[key];
      }
      global.localStorage?.setItem(CACHE_KEY,JSON.stringify(cache));
    }catch{}
  }
  function apply(img,entry){
    if(!img||!entry)return;
    const scale=Math.max(1,Math.min(MAX_SCALE,Number(entry.scale)||1));
    img.style.transform=`scale(${scale})`;
    img.style.transformOrigin=`${Math.round((entry.cx??0.5)*1000)/10}% ${Math.round((entry.cy??0.5)*1000)/10}%`;
    img.dataset.opticalReady='true';
  }
  function detectionUrl(value){
    return new URL(value,document.baseURI).href;
  }
  function analyze(url){
    return new Promise(resolve=>{
      const image=new Image();
      image.crossOrigin='anonymous';
      const timeout=setTimeout(()=>resolve({scale:fallbackScale(url),cx:0.5,cy:0.5,t:Date.now()}),5000);
      image.onerror=()=>{clearTimeout(timeout);resolve({scale:fallbackScale(url),cx:0.5,cy:0.5,t:Date.now()});};
      image.onload=()=>{
        clearTimeout(timeout);
        let scale=fallbackScale(url),cx=0.5,cy=0.5;
        try{
          const width=image.naturalWidth||1,height=image.naturalHeight||1;
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
          const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
          const pixels=context.getImageData(0,0,width,height).data;
          let top=height,bottom=-1,left=width,right=-1;
          for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]>60){
            if(y<top)top=y;if(y>bottom)bottom=y;if(x<left)left=x;if(x>right)right=x;
          }
          if(right>=left&&bottom>=top){
            const fill=Math.max(right-left+1,bottom-top+1)/Math.max(width,height);
            scale=fill>0.08?Math.min(MAX_SCALE,Math.max(1,TARGET_FILL/fill)):fallbackScale(url);
            cx=((left+right+1)/2)/width;cy=((top+bottom+1)/2)/height;
          }
        }catch{}
        resolve({scale:Math.round(scale*100)/100,cx:Math.round(cx*1000)/1000,cy:Math.round(cy*1000)/1000,t:Date.now()});
      };
      image.src=detectionUrl(url);
    });
  }
  function drain(){
    while(active<CONCURRENCY&&queue.length){
      const task=queue.shift();active++;
      analyze(task.url).then(entry=>{cache[task.url]=entry;save();task.resolve(entry);})
        .finally(()=>{active--;inflight.delete(task.url);drain();});
    }
  }
  function detect(url){
    if(cache[url])return Promise.resolve(cache[url]);
    if(inflight.has(url))return inflight.get(url);
    let resolveTask;
    const promise=new Promise(resolve=>{resolveTask=resolve;});
    inflight.set(url,promise);queue.push({url,resolve:resolveTask});drain();
    return promise;
  }
  function normalizeImage(img){
    const url=img?.dataset?.srcKey||img?.getAttribute?.('src')||'';
    if(!url)return Promise.resolve(null);
    if(cache[url]){apply(img,cache[url]);return Promise.resolve(cache[url]);}
    return detect(url).then(entry=>{if((img.dataset.srcKey||img.getAttribute('src'))===url)apply(img,entry);return entry;});
  }
  function observe(container=document){
    if(!container)return;
    container.querySelectorAll?.('img[data-optical-sprite]').forEach(img=>{if(img.complete&&img.naturalWidth>1)normalizeImage(img);});
    if(document.documentElement.dataset.spriteOpticalObserved)return;
    document.documentElement.dataset.spriteOpticalObserved='true';
    document.addEventListener('load',event=>{if(event.target?.matches?.('img[data-optical-sprite]'))normalizeImage(event.target);},true);
  }

  root.spriteOptical=Object.freeze({TARGET_FILL,MAX_SCALE,CONCURRENCY,detect,normalizeImage,observe});
})(window);
