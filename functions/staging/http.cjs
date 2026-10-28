'use strict';
const {stableError}=require('../src/domain/errors');
const ACTIONS=new Set(['begin','complete','confirm','register','cancelRegistration','readAccount','unlink','googleRead','googleCreate']);
function reply(res,status,payload,headers={}){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(payload));}
async function body(req){if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')throw Error('content-type');let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)throw Error('size');}const value=JSON.parse(text);if(!value||Object.keys(value).sort().join(',')!=='action,input'||!ACTIONS.has(value.action))throw Error('schema');return value;}
function createPrivateHandler({invoke,legacyHandler,authorize=async()=>{}}){return async(req,res)=>{if(req.url!=='/v1/discord-oauth')return legacyHandler(req,res);if(req.method!=='POST')return reply(res,405,{ok:false});try{const value=await body(req),context={origin:req.headers['x-discord-origin'],appCheckToken:req.headers['x-firebase-appcheck'],idToken:req.headers['x-firebase-id-token']};await authorize(context);return reply(res,200,await invoke(value.action,value.input,context));}catch(error){return reply(res,400,{ok:false,error:stableError(error)});}};}
function createPublicHandler({allowedOrigin,invokePrivate,staticHandler=(_req,res)=>reply(res,404,{ok:false})}){return async(req,res)=>{
 if(req.url!=='/v1/discord-oauth')return staticHandler(req,res);
 const headers={'access-control-allow-origin':allowedOrigin,'vary':'Origin','access-control-allow-headers':'Authorization,Content-Type,X-Firebase-AppCheck','access-control-allow-methods':'POST,OPTIONS'};
 if(req.headers.origin!==allowedOrigin)return reply(res,403,{ok:false});if(req.method==='OPTIONS')return reply(res,204,null,headers);if(req.method!=='POST')return reply(res,405,{ok:false},headers);
 try{const value=await body(req),authorization=String(req.headers.authorization||'');if(authorization&&!/^Bearer [^\s]{1,16384}$/.test(authorization))throw Error('auth');const result=await invokePrivate(value,{origin:allowedOrigin,appCheckToken:req.headers['x-firebase-appcheck']||'',idToken:authorization.slice(7)});reply(res,200,result,headers);}catch{reply(res,503,{ok:false,error:{code:'unavailable',reason:'discord/gateway_unavailable'}},headers);}
};}
module.exports={createPrivateHandler,createPublicHandler,reply};
