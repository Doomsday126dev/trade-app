'use strict';
// Local qualification only. This file is excluded from the deployable package.
// Firebase Auth/RTDB are real emulators. App Check uses signed, expiring one-use
// local test tokens; it is not production attestation. GCS uses a CAS test store.
const http=require('node:http');
const {randomBytes,createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const backendRequire=require('node:module').createRequire(require('node:path').join(__dirname,'../../functions/favorite-resolver/package.json'));
const {initializeApp,deleteApp}=backendRequire('firebase-admin/app');
const {getAuth}=backendRequire('firebase-admin/auth');
const {getDatabase}=backendRequire('firebase-admin/database');
const {createHandler}=require('../../functions/favorite-resolver/handler');
const {createIdentityReader,createIdentityResolver}=require('../../functions/favorite-resolver/identity');
const {createQuota}=require('../../functions/favorite-resolver/quota');
const PROJECT='demo-pogo-saving-incident';
function casStore(){const entries=new Map();return{entries,async read(id){const entry=entries.get(id);return entry?structuredClone(entry):{generation:0,value:null};},async compareAndSwap(id,generation,value){const old=entries.get(id);if((old?.generation||0)!==generation)throw Object.assign(new Error('CAS conflict'),{code:412});entries.set(id,{generation:generation+1,value:structuredClone(value)});}};}
async function createServer({port=0,origins=['http://localhost:4188'],identityReader:override}={}){
 if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9599'||process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9500')throw new Error('Exact isolated emulator hosts are required');
 const app=initializeApp({projectId:PROJECT,databaseURL:`http://127.0.0.1:9500?ns=${PROJECT}-default-rtdb`},`favorite-test-${randomUUID()}`),auth=getAuth(app),database=getDatabase(app),store=casStore(),secret=randomBytes(32),used=new Set();
 const token=()=>{const body=Buffer.from(JSON.stringify({project:PROJECT,jti:randomUUID(),exp:Date.now()+60000})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
 const verify=async value=>{
  const parts=value.split('.');if(parts.length!==2)return false;const hash=createHmac('sha256',secret).update(parts[0]).digest(),provided=Buffer.from(parts[1],'base64url');
  if(hash.length!==provided.length||!timingSafeEqual(hash,provided))return false;let body;try{body=JSON.parse(Buffer.from(parts[0],'base64url'));}catch{return false;}
  if(body.project!==PROJECT||body.exp<Date.now()||used.has(body.jti))return false;used.add(body.jti);return true;
 };
 const handler=createHandler({enabled:()=>true,origins,verifyAuth:value=>auth.verifyIdToken(value,true),verifyAppCheck:verify,quota:createQuota(store),resolve:createIdentityResolver(override||createIdentityReader(database))});
 const server=http.createServer(async(req,res)=>{
  res.set=(name,value)=>{res.setHeader(name,value);return res;};res.status=status=>{res.statusCode=status;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res;};res.send=value=>{res.end(value);return res;};
  if(req.url==='/__test/token'){res.setHeader('Access-Control-Allow-Origin',origins[0]);res.setHeader('Cache-Control','no-store');return res.json({token:token()});}
  if(req.url==='/__test/reset-quota'&&req.method==='POST'){store.entries.clear();return res.json({ok:true});}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768){res.statusCode=413;return res.end('{}');}chunks.push(chunk);}
  req.rawBody=Buffer.concat(chunks);try{req.body=JSON.parse(req.rawBody.toString()||'null');}catch{req.body=null;}
  try{await handler(req,res);}catch{if(!res.writableEnded)res.status(500).json({code:'test/handler-error'});}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return{url:`http://127.0.0.1:${server.address().port}`,auth,database,store,token,async close(){await new Promise(resolve=>server.close(resolve));await deleteApp(app);}};
}
if(require.main===module)createServer({port:4198}).then(service=>{process.on('SIGINT',()=>service.close().then(()=>process.exit()));process.on('SIGTERM',()=>service.close().then(()=>process.exit()));console.log('Local Favorite candidate handler ready on 127.0.0.1:4198; simulated App Check and quota storage.');}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={PROJECT,casStore,createServer};
