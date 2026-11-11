// Synthetic background transport only. The protocol, journal, transitions and editor
// are the real app implementations; no Firebase or user account is accessed.
async function enableLocalBackgrounds(page,saved=null){
 await page.evaluate(async saved=>{
  BACKGROUND_ROLLOUT.enabled=true;
  await loadReviewedBackgroundCatalogue();
  const token='bgs_'+'a'.repeat(32),root='backgroundStores/'+token;
  const store=saved||{};
  const transport=window.__localBackgroundTransport={writes:[],failWrites:false,loseAcknowledgement:false,holdWrites:false,waiters:[]};
  const read=p=>p.split('/').reduce((v,k)=>v?.[k],store)??null;
  const put=(p,v)=>{const a=p.split('/'),k=a.pop();let o=store;for(const x of a)o=o[x]??={};if(v==null)delete o[k];else o[k]=structuredClone(v)};
  const db=async(method,path,value)=>{
   if(method==='GET')return{status:200,value:structuredClone(read(path))};
   if(transport.holdWrites)await new Promise(resolve=>transport.waiters.push(resolve));
   if(transport.failWrites)throw Error('Synthetic transport offline');
   if(method==='PATCH'){for(const [k,v]of Object.entries(value))put(path+'/'+k,v)}else put(path,method==='DELETE'?null:value);
   transport.writes.push({method,path,value:structuredClone(value)});
   if(transport.loseAcknowledgement){transport.loseAcknowledgement=false;throw Error('Synthetic lost acknowledgement');}
   return{status:200};
  };
  // Public-share publication reads the same synthetic background store as the
  // protocol. Keep publicShares itself on the normal account fixture transport.
  const backgroundPath=p=>typeof p==='string'&&/^(backgroundStores|backgroundOwnerIndex)\//.test(p);
  const originalGet=get,originalSet=set;
  get=async p=>backgroundPath(p)?{val:()=>structuredClone(read(p)),exists:()=>read(p)!==null}:originalGet(p);
  set=async(p,v)=>backgroundPath(p)?db('PUT',p,v):originalSet(p,v);
  const protocol=BackgroundProtocol.createProtocol({token,db,isEligible:backgroundEligible,bounded:true});
  const repository=BackgroundRepository.createRepository({uid:auth.currentUser.uid,token,protocol,storage:localStorage,currentSession:backgroundSession,readHead:async()=>read(root+'/head')||0});
  await repository.hydrate();
  const adapter=BackgroundEditorAdapter.createEditorAdapter({repository,uid:auth.currentUser.uid,currentUid:()=>auth.currentUser.uid,catalogForId:accountSyncCatalogEntryForId});
  backgroundOwnerRuntime={...backgroundSession(),token,protocol,repository,adapter,active:true,paused:false,remoteUnavailable:false};backgroundV2PrototypeAdapter=adapter;
  window.__localBackgroundStore=store;
  renderMyList();
 },saved);
}
module.exports={enableLocalBackgrounds};
