'use strict';
const {fail}=require('../domain/errors');
async function boundedDiscordJson(message,{maxBytes,reason,code='invalid_argument'}={}){
  const length=message.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))fail(code,reason);
  if(!message.body)fail(code,reason);
  const reader=message.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();fail(code,reason);}chunks.push(value);}
  }finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}catch{fail(code,reason);}
}
module.exports={boundedDiscordJson};
