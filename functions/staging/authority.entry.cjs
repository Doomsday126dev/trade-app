'use strict';
const http=require('node:http'),fs=require('node:fs'),crypto=require('node:crypto');
const PROJECT='trainer-hub-staging-37ib4wct';
const SECRET_PATHS=Object.freeze({'client-secret':'/var/run/discord/client/value','state-key':'/var/run/discord/state/value','subject-key':'/var/run/discord/subject/value'});
function build(env=process.env,deps={}){
 const project=env.FIREBASE_PROJECT_ID,emulator=env.APP_ENVIRONMENT==='emulator'&&project==='demo-pogo-discord';
 if(!emulator&&(env.APP_ENVIRONMENT!=='staging'||project!==PROJECT))throw Error('staging target required');
 const legacy=deps.legacy||require('../e1-authority-service/server'),configuration=legacy.loadConfiguration(env),legacyHandler=legacy.createHandler(configuration);
 if(env.DISCORD_ENABLED!=='true')return legacyHandler;
 const origin=new URL(env.DISCORD_ALLOWED_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.DISCORD_ALLOWED_ORIGIN||origin.hostname==='doomsday126dev.github.io')throw Error('dedicated staging origin required');
 const subjects=new Set(String(env.DISCORD_CANARY_SUBJECTS||'').split(',').filter(x=>/^\d{5,32}$/.test(x))),uids=new Set(String(env.DISCORD_CANARY_UIDS||'').split(',').filter(Boolean));if(!subjects.size||!uids.size||!env.DISCORD_APPCHECK_APP_ID)throw Error('named canary and App Check configuration required');
 const apps=require('firebase-admin/app'),authApi=require('firebase-admin/auth'),{getAppCheck}=require('firebase-admin/app-check'),{Firestore}=require('@google-cloud/firestore');
 const app=deps.firebaseAuth?.app||apps.initializeApp({projectId:project}),auth=deps.firebaseAuth||authApi.getAuth(app),firestore=deps.firestore||new Firestore({projectId:project,databaseId:'phase-e-identity'});
 const secret=deps.readSecret||(name=>fs.readFileSync(SECRET_PATHS[name],'utf8').trim()),subjectPepper=secret('subject-key');
 const subjectKeys=new Set([...subjects].map(id=>'v1_discord_'+crypto.createHmac('sha256',subjectPepper).update('discord-provider-subject\0'+id).digest('hex')));
 const discord=deps.discord||require('../src/prototype/discordHttpAdapter').createDiscordHttpAdapter(),getUser=discord.getCurrentUser;
 const adapter={...discord,getCurrentUser:async input=>{const user=await getUser(input);if(!subjects.has(user.subject))throw Error('canary identity required');return user;}};
 const reader=deps.legacyReader||require('../e1-authority-service/rtdbVerifiedLegacyMappingReader').createVerifiedLegacyMappingReader({environment:'staging',projectId:PROJECT,databaseUrl:require('../e1-authority-service/e1TargetContracts').STAGING.rtdbDatabaseUrl});
 const check=async(context,consume=false)=>{const proof=await (deps.verifyAppCheck||((token,options)=>getAppCheck(app).verifyToken(token,options)))(context.appCheckToken,{consume});if(proof.alreadyConsumed||proof.appId!==env.DISCORD_APPCHECK_APP_ID)throw Error('App Check required');};
 const candidate=require('../src/prototype/discordCandidateComposition').createDiscordCandidateComposition({enabled:true,registrationEnabled:env.DISCORD_REGISTRATION_ENABLED==='true',firestore,firebaseAuth:auth,discord:adapter,projectId:project,allowedOrigin:origin.origin,
 config:{clientId:'1564289039526268938',clientSecret:secret('client-secret'),statePepper:secret('state-key'),subjectPepper,redirectUri:origin.origin+'/auth/discord.html'},
 verifyAppCheck:async token=>{const proof=await (deps.verifyAppCheck||((value)=>getAppCheck(app).verifyToken(value)))(token);return proof.appId===env.DISCORD_APPCHECK_APP_ID;},
 verifyLegacyBinding:async({uid,expectedUsername,idToken})=>{if(!uids.has(uid))throw Error('canary UID required');const value=await reader.readVerifiedLegacyMapping({verifiedUid:uid,firebaseIdToken:idToken});return{uid,username:value.username,active:value.status==='ready'&&value.username===expectedUsername};}});
 return require('./http.cjs').createPrivateHandler({invoke:async(action,input,context)=>{if(!['googleRead','googleCreate'].includes(action))return candidate.invoke(action,input,context);await check(context,action==='googleCreate');return new Promise((resolve,reject)=>{const {Readable}=require('node:stream'),request=Readable.from([JSON.stringify(input)]);request.method='POST';request.url=action==='googleRead'?'/v1/read-account-foundation':'/v1/create-provider-account-foundation';request.headers={'content-length':String(Buffer.byteLength(JSON.stringify(input))),'x-firebase-id-token':context.idToken,'content-type':'application/json','x-e1-rate-limit-policy':'firestore-rolling-v1'};const response={writeHead(status){this.status=status;},end(raw){try{resolve(JSON.parse(raw));}catch(error){reject(error);}}};Promise.resolve(legacyHandler(request,response)).catch(reject);});},legacyHandler,authorize:async context=>{if(!context.idToken)return;const claims=await auth.verifyIdToken(context.idToken,true);if(uids.has(claims.uid))return;const row=await firestore.doc(`discordRegistrationClaims/${claims.uid}`).get();if(!row.exists||!subjectKeys.has(row.data().providerSubjectKey))throw Error('canary UID required');}});
}
if(require.main===module)http.createServer(build()).listen(Number(process.env.PORT||8080),'0.0.0.0');
module.exports={build,SECRET_PATHS};
