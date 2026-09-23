'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
async function run(command,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:options.stdio||'inherit',env:{...process.env,...options.env}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} exited ${code}`)));});}
(async()=>{
  const server=spawn('python3',['-m','http.server','4190','--bind','127.0.0.1'],{stdio:'ignore'});
  try{
    for(let attempt=0;attempt<50;attempt++){try{if((await fetch('http://127.0.0.1:4190/index.html')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    await run(process.execPath,[path.join(require.resolve('@playwright/test/package.json'),'../cli.js'),'test','tests/safe-transfer-freshness-emulator.spec.js','--project=desktop','--workers=1','--reporter=line'],{env:{POGO_SAFE_TRANSFER_EMULATOR:'1',PLAYWRIGHT_BASE_URL:'http://127.0.0.1:4190'}});
  }finally{server.kill('SIGTERM');}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
