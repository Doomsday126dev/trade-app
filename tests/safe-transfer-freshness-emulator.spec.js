const {test,expect}=require('@playwright/test');

const project='demo-pogo-safe-transfer-freshness';
const namespace=`${project}-default-rtdb`;
const database='http://127.0.0.1:9600';
const trainer='WarmCacheTrainer';
test.use({serviceWorkers:'block'});
test.skip(process.env.POGO_SAFE_TRANSFER_EMULATOR!=='1','Run with the isolated Safe-transfer RTDB emulator.');

function declaration(name){return{intent:'lf',category:'wishlist',name,p:'',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false};}
function projection(names,updatedAt){return{version:2,username:trainer,profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:0},publishedListTypes:['wishlist','dynamax','gmax','costumes'],lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},updatedAt,declarations:names.map(declaration),declarationCount:names.length};}
function url(){return`${database}/publicShares/${trainer}.json?ns=${encodeURIComponent(namespace)}`;}
async function write(value){const response=await fetch(url(),{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer owner'},body:JSON.stringify(value)});expect(response.status).toBe(200);}

test('actual SDK warm cache cannot qualify initial generation or copy-time revalidation',async({page})=>{
  await page.context().grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4190'}).catch(()=>{});
  let blockFresh=false;
  await page.route(`${database}/publicShares/**`,route=>blockFresh?route.abort('internetdisconnected'):route.continue());
  await write(projection(['Pikachu'],1));
  await page.goto('./?safe-transfer-warm-cache');
  for(const file of ['js/domain/pokemonGoSearchSyntax.js','js/domain/safeTransferRestoration.js','js/domain/publicSharePublication.js','js/services/firebaseClient.js','js/data/publicShareRepository.js'])await page.addScriptTag({url:`/${file}`});
  await page.evaluate(async({project,namespace,database,trainer})=>{
    const appSdk=await import('https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js');
    const dbSdk=await import('https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js');
    const app=appSdk.initializeApp({projectId:project,databaseURL:`${database}?ns=${namespace}`},'safe-transfer-freshness');
    const db=dbSdk.getDatabase(app);dbSdk.connectDatabaseEmulator(db,'127.0.0.1',9600);
    const serverReader=PogoServices.firebaseClient.createServerConfirmedReader({
      databaseUrl:`${database}?ns=${namespace}`,fetchImpl:window.fetch.bind(window),
      appCheckReady:async()=>({ok:true,instance:{emulator:true}}),loadAppCheckSdk:async()=>({getToken:async()=>({token:'synthetic-emulator-app-check'})}),sessionCurrent:()=>true
    });
    const client=PogoServices.firebaseClient.createFirebaseClient({database:db,ref:dbSdk.ref,get:dbSdk.get,onValue:dbSdk.onValue,serverReader});
    const repo=PogoData.publicShareRepository.createPublicShareRepository(client),safe=PogoDomain.safeTransferRestoration,publish=PogoDomain.publicSharePublication,syntax=PogoDomain.pokemonGoSearchSyntax;
    const catalog=safe.createCatalog([{no:1,name:'Bulbasaur'},{no:4,name:'Charmander'},{no:25,name:'Pikachu'},{no:133,name:'Eevee'}]);
    const account={id:'owner',version:'session-1'},scope={id:'favorites',version:'scope-1',displayedSelectionVersion:'scope-1',kind:'trainers',selected:[{id:'trainer-warm',label:trainer}]},universe={version:'catalog-1',policy:'fixture',species:[1,4,25,133],excludedSpecies:[]};
    const live={account,scope:{id:scope.id,version:scope.version,kind:scope.kind,selectedIds:['trainer-warm']},universeVersion:universe.version,sourceVersions:{},gameLocale:'en'};
    const loadSnapshot=async(_request,context)=>{
      const result=await repo.readFresh(trainer,{operationId:`${context.generation}:0`,signal:context.signal,isCurrent:context.isCurrent});
      const source=safe.sourceFromRepositoryResult({trainerId:'trainer-warm',label:trainer,result},{validateProjection:publish.publicShareProjectionStatus,intentEntries:publish.intentEntries});
      window.__lastWarmSource=source;
      if(source.state==='complete')live.sourceVersions={'trainer-warm':source.sourceVersion};
      return{contractVersion:1,account,scope,universe,sources:[source]};
    };
    const controller=safe.createController({loadSnapshot,plan:snapshot=>safe.commandPlan(safe.evaluate(snapshot,{catalog}),{syntax,locale:'en'}),currentBinding:()=>structuredClone(live),copy:async value=>window.__copied.push(value),revalidateBeforeCopy:true});
    window.__warm={db,dbSdk,repo,controller,request:{account,scope,universe,selection:[{id:'trainer-warm',displayName:trainer}],gameLocale:'en'},live};window.__copied=[];
  },{project,namespace,database,trainer});

  const cachedFirst=await page.evaluate(async()=>{const result=await __warm.repo.read('WarmCacheTrainer');return result.value;});
  expect(cachedFirst.declarations.map(item=>item.name)).toEqual(['Pikachu']);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const listening=__warm.repo.listen('WarmCacheTrainer',{onData:value=>{window.__warmListenerValue=value;if(!window.__warmUnsubscribe){window.__warmUnsubscribe=listening.unsubscribe;resolve();}},onError:reject});}));
  await page.evaluate(()=>__warm.dbSdk.goOffline(__warm.db));
  await write(projection(['Pikachu','Eevee'],2));
  blockFresh=true;
  const staleCache=await page.evaluate(async()=>{const result=await __warm.repo.read('WarmCacheTrainer');return{ok:result.ok,names:result.value.declarations.map(item=>item.name)};});
  expect(staleCache).toEqual({ok:true,names:['Pikachu']});
  const blockedInitial=await page.evaluate(async()=>{await __warm.controller.start(__warm.request);const state=__warm.controller.snapshot();return{phase:state.phase,code:state.error.code,copies:__copied.length};});
  expect(blockedInitial.phase).toBe('blocked');expect(blockedInitial.copies).toBe(0);

  blockFresh=false;await page.evaluate(()=>__warm.dbSdk.goOnline(__warm.db));
  const refreshed=await page.evaluate(async()=>{await __warm.controller.start(__warm.request);const state=__warm.controller.snapshot();return{phase:state.phase,protectedSpecies:state.plan.protectedSpecies,evidence:__lastWarmSource.readEvidence.transport};});
  expect(refreshed).toEqual({phase:'ready',protectedSpecies:[25,133],evidence:'rtdb-rest'});

  await page.evaluate(()=>__warm.dbSdk.goOffline(__warm.db));await write(projection(['Bulbasaur','Pikachu','Eevee'],3));blockFresh=true;
  const staleBeforeCopy=await page.evaluate(async()=>{const result=await __warm.repo.read('WarmCacheTrainer');return result.value.declarations.map(item=>item.name);});
  expect(staleBeforeCopy).toEqual(['Pikachu','Eevee']);
  const blockedCopy=await page.evaluate(async()=>{const result=await __warm.controller.copyPart(0);return{status:result.status,phase:__warm.controller.snapshot().phase,copies:__copied.length,manual:__warm.controller.snapshot().manualCommand};});
  expect(blockedCopy).toEqual({status:'stale',phase:'invalidated',copies:0,manual:''});

  blockFresh=false;await page.evaluate(()=>__warm.dbSdk.goOnline(__warm.db));
  const recovered=await page.evaluate(async()=>{await __warm.controller.start(__warm.request);const before=__warm.controller.snapshot().plan.protectedSpecies;const copied=await __warm.controller.copyPart(0);return{before,status:copied.status,copies:__copied.length};});
  expect(recovered).toEqual({before:[1,25,133],status:'copied',copies:1});
});
