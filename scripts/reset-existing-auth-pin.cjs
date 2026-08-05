#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const PRIVATE_ROOT=path.resolve(__dirname,'../.local/uid-handle-audits');
const PIN_SALT='pogo_salt_nyc';
const AUTH_VERSION_SCAN_LIMIT=12;

function resetError(code,message,details){
  const error=new Error(message);error.code=code;
  if(details)error.details=details;
  return error;
}
function sha256(value){return crypto.createHash('sha256').update(String(value)).digest('hex')}
function hashPin(pin){return sha256(`${pin}${PIN_SALT}`)}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function fingerprint(value){return sha256(JSON.stringify(stable(value??null)))}
function isPlainObject(value){return!!value&&typeof value==='object'&&!Array.isArray(value)}
function syntheticAuthEmail(username,version=1){
  const base=String(username).toLowerCase().replace(/[^a-z0-9]/g,'_');
  const parsed=parseInt(version,10);
  const safeVersion=Number.isFinite(parsed)&&parsed>0?parsed:1;
  return`${base}${safeVersion>1?`_v${safeVersion}`:''}@pogotrades.nyc`;
}
function profileBaseline(user,share){
  const privateProfile={};
  for(const field of ['friendCode','bio','discord','discordId','avatarPokemon','wallpaper']){
    if(Object.prototype.hasOwnProperty.call(user||{},field))privateProfile[field]=user[field];
  }
  return{privateProfile,publicProfile:share?.profile||null};
}
function parseArgs(argv){
  const options={apply:false};
  const values=new Set(['username','projectId','databaseId','databaseUrl','confirmProject','confirmDatabase','pinEnv','identityReport']);
  for(let index=0;index<argv.length;index++){
    const arg=argv[index];
    if(arg==='--apply'){if(options.apply)throw resetError('reset/repeated-apply','Apply flag may be provided only once');options.apply=true;continue;}
    if(!arg.startsWith('--'))throw resetError('reset/unexpected-argument','Unexpected CLI argument');
    const key=arg.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(!values.has(key)||Object.hasOwn(options,key))throw resetError('reset/unsupported-option','Unsupported or repeated CLI option');
    const value=argv[++index];
    if(value==null||value.startsWith('--'))throw resetError('reset/missing-option-value','Missing CLI option value');
    options[key]=value;
  }
  return options;
}
function validateOptions(options,env=process.env){
  for(const key of ['username','projectId','databaseId','databaseUrl','confirmProject','confirmDatabase','identityReport']){
    if(!String(options[key]||'').trim())throw resetError('reset/missing-required-option',`Missing required option: ${key}`);
  }
  if(options.projectId!==options.confirmProject||options.databaseId!==options.confirmDatabase){
    throw resetError('reset/target-mismatch','Production target confirmation does not match');
  }
  if(/[\s,.#$\[\]\/\u0000-\u001f\u007f]/.test(options.username))throw resetError('reset/invalid-username','Exactly one canonical Firebase-key-safe username is required');
  let url;
  try{url=new URL(options.databaseUrl)}catch{throw resetError('reset/invalid-database-url','Database URL is invalid')}
  const exactLegacyHost=url.hostname===`${options.databaseId}.firebaseio.com`;
  const exactRegionalHost=url.hostname.startsWith(`${options.databaseId}.`)&&url.hostname.endsWith('.firebasedatabase.app');
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||(!exactLegacyHost&&!exactRegionalHost)){
    throw resetError('reset/database-target-mismatch','Database URL does not match the confirmed database');
  }
  const reportPath=path.resolve(options.identityReport);
  const relative=path.relative(PRIVATE_ROOT,reportPath);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw resetError('reset/report-outside-private-root','Identity report must stay under the private audit directory');
  const pinEnv=options.pinEnv||'POGO_RESET_PIN';
  const pin=String(env[pinEnv]||'');
  if(options.apply&&!/^\d{6}$/.test(pin))throw resetError('reset/invalid-pin','Apply mode requires a secure PIN environment variable containing exactly six digits');
  if(!options.apply&&pin&&!/^\d{6}$/.test(pin))throw resetError('reset/invalid-pin','When supplied, the secure PIN environment variable must contain exactly six digits');
  return{...options,reportPath,pinEnv,pin:options.apply?pin:''};
}
function readIdentityGate(reportPath,username,uid){
  const stat=fs.lstatSync(reportPath);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw resetError('reset/insecure-identity-report','Private identity report must be a regular mode-0600 file');
  const actualPath=fs.realpathSync(reportPath);
  const actualRelative=path.relative(fs.realpathSync(PRIVATE_ROOT),actualPath);
  if(actualRelative.startsWith('..')||path.isAbsolute(actualRelative))throw resetError('reset/report-outside-private-root','Identity report resolves outside the private audit directory');
  const text=fs.readFileSync(reportPath,'utf8');
  const report=JSON.parse(text);
  const records=(report.records||[]).filter(record=>record.trainerName===username);
  if(records.length!==1)throw resetError('reset/identity-report-ambiguous','Private identity report does not contain exactly one canonical trainer record');
  const record=records[0];
  if(record.uid!==uid)throw resetError('reset/identity-report-uid-mismatch','Private identity report UID does not match');
  if(record.classification==='duplicate_or_conflicting'||record.reasonCodes?.some(code=>/duplicate|multiple|conflict/.test(code))){
    throw resetError('reset/duplicate-identity','Private identity evidence reports a duplicate or conflict');
  }
  return{reportHash:sha256(text),classification:record.classification};
}
function approvedUserDelta(before,after,expectedPinHash){
  const beforeCopy={...(before||{})};
  const afterCopy={...(after||{})};
  const approvedPinFields=afterCopy.pinHashed===true&&afterCopy.pin===expectedPinHash;
  delete beforeCopy.pin;delete beforeCopy.pinHashed;
  delete afterCopy.pin;delete afterCopy.pinHashed;
  return fingerprint(beforeCopy)===fingerprint(afterCopy)&&approvedPinFields;
}
async function collectBaseline(adapter,username){
  const user=await adapter.read(`users/${username}`);
  if(!user||!user.authUid||!user.authEmail)throw resetError('reset/missing-user-binding','Required user identity binding is missing');
  const uid=user.authUid;
  const authEmails=[user.authEmail,...Array.from({length:AUTH_VERSION_SCAN_LIMIT},(_,index)=>syntheticAuthEmail(username,index+1))];
  const [index,directory,wishlist,share,reverse,authByUid,authMatches]=await Promise.all([
    adapter.read(`authIndex/${uid}`),adapter.read(`loginDirectory/${username}`),adapter.read(`wishlist/${username}`),
    adapter.read(`publicShares/${username}`),adapter.read(`userCommunities/${uid}`),adapter.getAuthUser(uid),adapter.findAuthUsersByEmails([...new Set(authEmails)])
  ]);
  const authByEmail=authMatches.find(candidate=>candidate.email===user.authEmail);
  if(index?.username!==username)throw resetError('reset/auth-index-mismatch','Auth index username does not match the canonical username');
  if(new Set(authMatches.map(candidate=>candidate.uid)).size!==1)throw resetError('reset/duplicate-identity','Multiple Firebase Auth identities exist for the canonical trainer login');
  if(authByUid?.uid!==uid||authByEmail?.uid!==uid)throw resetError('reset/auth-uid-mismatch','Firebase Auth UID does not match every exact lookup');
  if(authByUid.email!==user.authEmail||authByEmail.email!==user.authEmail)throw resetError('reset/auth-email-mismatch','Firebase Auth email does not match the established user binding');
  if(authByUid.disabled||authByEmail.disabled)throw resetError('reset/auth-disabled','Firebase Auth account is disabled');
  if(!directory||directory.authReady!==true)throw resetError('reset/directory-not-ready','Login directory is not ready');
  if(!isPlainObject(wishlist))throw resetError('reset/wishlist-baseline-missing','Wishlist baseline is missing or malformed');
  if(!isPlainObject(share))throw resetError('reset/public-share-baseline-missing','Public-share baseline is missing or malformed');
  if(!isPlainObject(reverse))throw resetError('reset/membership-baseline-missing','Membership reverse-index baseline is missing or malformed');
  const memberships={};
  for(const communityId of Object.keys(reverse||{}).sort()){
    memberships[communityId]={
      reverse:reverse[communityId],
      username:await adapter.read(`communities/${communityId}/memberUsernames/${username}`),
      uid:await adapter.read(`communities/${communityId}/members/${uid}`),
      admin:await adapter.read(`communities/${communityId}/admins/${uid}`)
    };
    if(memberships[communityId].username==null||memberships[communityId].uid==null){
      throw resetError('reset/membership-index-mismatch','Community membership indexes are incomplete');
    }
  }
  return{
    private:{username,uid,email:user.authEmail,user,index,directory,wishlist,share,reverse,memberships,auth:{uid:authByUid.uid,email:authByUid.email,disabled:!!authByUid.disabled}},
    redacted:{wishlistCount:Object.keys(wishlist||{}).length,communityCount:Object.keys(reverse||{}).length,loginDirectoryReady:true,authDisabled:false,
      hashes:{user:fingerprint(user),authIndex:fingerprint(index),memberships:fingerprint({reverse,memberships}),wishlist:fingerprint(wishlist),profile:fingerprint(profileBaseline(user,share)),publicShare:fingerprint(share),directory:fingerprint(directory)}}
  };
}
function unchangedProtectedBaselines(before,after){
  const keys=['authIndex','memberships','wishlist','profile','publicShare','directory'];
  return keys.every(key=>before.hashes[key]===after.hashes[key]);
}
async function executeReset({adapter,options,env=process.env,emit=()=>{}}){
  const validated=validateOptions(options,env);
  const before=await collectBaseline(adapter,validated.username);
  const identityGate=readIdentityGate(validated.reportPath,validated.username,before.private.uid);
  const summary={
    mode:validated.apply?'apply':'dry-run',target:'[redacted]',identity:'verified',authIdentityMatches:1,
    authEnabled:true,directoryReady:true,authIndexReadable:true,profileReadable:true,membershipsReadable:true,
    reverseIndexesReadable:true,publicShareReadable:true,duplicateIdentityDetected:false,
    wishlistCount:before.redacted.wishlistCount,communityCount:before.redacted.communityCount,
    privateReportVerified:!!identityGate.reportHash,rollback:'previous-password-unrecoverable'
  };
  if(!validated.apply){emit({...summary,status:'dry-run-ready',writes:0});return{ok:true,status:'dry-run-ready',writes:0,before:before.redacted};}
  let authUpdated=false;
  try{
    await adapter.updateAuthPassword(before.private.uid,validated.pin);
    authUpdated=true;
    await adapter.updateAppPin(validated.username,hashPin(validated.pin));
  }catch(error){
    const code=authUpdated?'reset/partial-auth-updated-app-pin-failed':'reset/auth-password-update-failed';
    emit({...summary,status:'failed',code,writes:authUpdated?1:0});
    throw resetError(code,authUpdated?'Auth password changed, but app PIN metadata did not; manual review is required':'Auth password was not changed',null);
  }
  const after=await collectBaseline(adapter,validated.username);
  const expectedPinHash=hashPin(validated.pin);
  const postflight={
    uidPreserved:before.private.uid===after.private.uid,
    emailPreserved:before.private.email===after.private.email,
    authVersionPreserved:before.private.user.authVersion===after.private.user.authVersion,
    userDeltaApproved:approvedUserDelta(before.private.user,after.private.user,expectedPinHash),
    protectedBaselinesPreserved:unchangedProtectedBaselines(before.redacted,after.redacted)
  };
  if(Object.values(postflight).some(value=>value!==true)){
    const error=resetError('reset/postflight-mismatch','Postflight verification found an unapproved data change',postflight);
    emit({...summary,status:'failed',code:error.code,writes:2});throw error;
  }
  emit({...summary,status:'applied-and-verified',writes:2});
  return{ok:true,status:'applied-and-verified',writes:2,before:before.redacted,after:after.redacted};
}
async function createAdminAdapter(options){
  let appModule,authModule,databaseModule;
  try{
    appModule=require('firebase-admin/app');authModule=require('firebase-admin/auth');databaseModule=require('firebase-admin/database');
  }catch{throw resetError('reset/admin-sdk-missing','firebase-admin is required in the trusted local tool environment')}
  const app=appModule.initializeApp({credential:appModule.applicationDefault(),projectId:options.projectId,databaseURL:options.databaseUrl},`pin-reset-${Date.now()}`);
  const auth=authModule.getAuth(app);const database=databaseModule.getDatabase(app);
  return{
    read:async target=>(await database.ref(target).get()).val(),
    getAuthUser:uid=>auth.getUser(uid),
    findAuthUsersByEmails:async emails=>{
      const matches=[];
      for(const email of emails){
        try{matches.push(await auth.getUserByEmail(email));}
        catch(error){if(error?.code!=='auth/user-not-found')throw error;}
      }
      return matches;
    },
    updateAuthPassword:(uid,password)=>auth.updateUser(uid,{password}),
    updateAppPin:(username,pin)=>database.ref(`users/${username}`).update({pin,pinHashed:true}),
    close:()=>appModule.deleteApp(app)
  };
}
function redactedLine(value){return JSON.stringify(value)}
async function main(argv=process.argv.slice(2),env=process.env){
  const rawOptions=parseArgs(argv);const options=validateOptions(rawOptions,env);const adapter=await createAdminAdapter(options);
  try{return await executeReset({adapter,options,env,emit:value=>console.log(redactedLine(value))});}
  finally{await adapter.close();}
}

module.exports={PIN_SALT,AUTH_VERSION_SCAN_LIMIT,hashPin,syntheticAuthEmail,parseArgs,validateOptions,readIdentityGate,approvedUserDelta,collectBaseline,executeReset,createAdminAdapter};
if(require.main===module)main().catch(error=>{console.error(redactedLine({status:'failed',code:error.code||'reset/unexpected',message:'Identity-preserving PIN reset did not complete',identifiers:'[redacted]',secret:'[redacted]'}));process.exitCode=1;});
