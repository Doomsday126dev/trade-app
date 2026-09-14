'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const {createServer}=require('../tests/support/favoriteResolverEmulator.cjs');
async function command(args,env){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,...env}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Candidate qualification failed: '+code)));});}
(async()=>{
 if(process.env.GCLOUD_PROJECT!=='demo-pogo-saving-incident')throw new Error('Exact demo project is required');
 await command(['--test','tests/favorite-resolver-emulator.test.cjs'],{POGO_FAVORITES_EMULATORS:'1'});
 const handler=await createServer({port:4198});
 const server=spawn('python3',['-m','http.server','4188','--bind','127.0.0.1'],{stdio:'ignore'});
 try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4188/index.html')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  const specs=['tests/favorite-addition-emulator.spec.js',...(require('node:fs').existsSync('tests/favorite-picker-emulator.spec.js')?['tests/favorite-picker-emulator.spec.js']:[])];
  await command([path.join(require.resolve('@playwright/test/package.json'),'../cli.js'),'test',...specs,'--project=desktop','--workers=1'],{POGO_SAVING_EMULATORS:'1',PLAYWRIGHT_BASE_URL:'http://localhost:4188'});
 }finally{server.kill('SIGTERM');await handler.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
