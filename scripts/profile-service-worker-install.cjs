#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const {execFileSync}=require('node:child_process');

function wait(milliseconds){return new Promise(resolve=>setTimeout(resolve,milliseconds));}
function cacheKey(value){return typeof value==='string'?value:String(value?.url||value);}
function syntheticResponse(status=200,body='ok'){
  return{ok:status>=200&&status<300,status,body,clone(){return syntheticResponse(status,body);}};
}

class ProfileCache{
  constructor(metrics,putDelayMs){this.metrics=metrics;this.putDelayMs=putDelayMs;this.values=new Map();}
  async put(key,response){
    this.metrics.cacheWrites+=1;
    if(this.putDelayMs)await wait(this.putDelayMs);
    this.values.set(cacheKey(key),response.clone());
  }
  async match(key){this.metrics.cacheReads+=1;return this.values.get(cacheKey(key));}
  async keys(){return[...this.values.keys()].map(url=>({url}));}
  async delete(key){return this.values.delete(cacheKey(key));}
}

async function profileServiceWorkerInstall({
  source,
  fetchDelayMs=12,
  putDelayMs=2,
  concurrencyOverride=null,
  seedCurrent=false
}){
  if(concurrencyOverride!==null){
    source=source.replace(/const INSTALL_FETCH_CONCURRENCY=\d+;/,`const INSTALL_FETCH_CONCURRENCY=${concurrencyOverride};`);
  }
  const metrics={fetchCount:0,activeFetches:0,peakFetchConcurrency:0,cacheWrites:0,cacheReads:0,skipWaiting:0};
  const stores=new Map();
  const listeners=new Map();
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new ProfileCache(metrics,putDelayMs));
      return stores.get(name);
    },
    async delete(name){return stores.delete(name);},
    async keys(){return[...stores.keys()];}
  };
  const self={
    location:{origin:'https://profile.example',href:'https://profile.example/trade-app/sw.js'},
    clients:{async claim(){}},
    async skipWaiting(){metrics.skipWaiting+=1;},
    addEventListener(type,listener){listeners.set(type,listener);}
  };
  async function fetch(){
    metrics.fetchCount+=1;
    metrics.activeFetches+=1;
    metrics.peakFetchConcurrency=Math.max(metrics.peakFetchConcurrency,metrics.activeFetches);
    try{if(fetchDelayMs)await wait(fetchDelayMs);return syntheticResponse();}
    finally{metrics.activeFetches-=1;}
  }
  const context=vm.createContext({self,caches,fetch,URL,Promise,Map,Set,Error,Response:class{},Blob:class{},Uint8Array,atob:()=>'',console});
  vm.runInContext(source,context,{filename:'profiled-sw.js'});
  const required=vm.runInContext('REQUIRED_SHELL_URLS',context);
  const shellName=vm.runInContext('SHELL_CACHE',context);
  if(seedCurrent){
    const shell=await caches.open(shellName);
    for(const url of required)shell.values.set(url,syntheticResponse());
    metrics.cacheReads=0;
  }
  let installPromise;
  const started=performance.now();
  listeners.get('install')({waitUntil(value){installPromise=Promise.resolve(value);}});
  await installPromise;
  const durationMs=performance.now()-started;
  const shell=stores.get(shellName);
  return{
    requiredAssetCount:required.length,
    fetchCount:metrics.fetchCount,
    reusedAssetCount:required.length-metrics.fetchCount,
    peakFetchConcurrency:metrics.peakFetchConcurrency,
    cacheWrites:metrics.cacheWrites,
    cacheReads:metrics.cacheReads,
    duplicateCopyWrites:Math.max(0,metrics.cacheWrites-required.length),
    installDurationMs:Number(durationMs.toFixed(1)),
    complete:Boolean(shell&&required.every(url=>shell.values.has(url))),
    cacheNames:[...stores.keys()].sort(),
    skipWaiting:metrics.skipWaiting
  };
}

function argumentValue(name){
  const index=process.argv.indexOf(name);
  return index>=0?process.argv[index+1]:null;
}

async function main(){
  const gitRef=argumentValue('--git-ref');
  const sourcePath=path.resolve(argumentValue('--source')||path.join(__dirname,'..','sw.js'));
  const source=gitRef
    ?execFileSync('git',['show',`${gitRef}:sw.js`],{cwd:path.join(__dirname,'..'),encoding:'utf8'})
    :fs.readFileSync(sourcePath,'utf8');
  const concurrency=argumentValue('--concurrency');
  const result=await profileServiceWorkerInstall({
    source,
    fetchDelayMs:Number(argumentValue('--fetch-delay')||12),
    putDelayMs:Number(argumentValue('--put-delay')||2),
    concurrencyOverride:concurrency===null?null:Number(concurrency),
    seedCurrent:process.argv.includes('--seed-current')
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});

module.exports={profileServiceWorkerInstall,syntheticResponse};
