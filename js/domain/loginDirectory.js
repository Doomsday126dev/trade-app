(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const STATES=Object.freeze({IDLE:'idle',LOADING:'loading',LOADED:'loaded',ERROR:'error'});

  function plainObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
  function cloneDirectory(value){return JSON.parse(JSON.stringify(plainObject(value)))}
  function fold(value){return String(value||'').trim().toLocaleLowerCase('en-US')}
  function discoverableRecord(value){return value===true||!!(value&&typeof value==='object'&&!Array.isArray(value))}
  function readyRecord(value){
    return value===true||!!(value&&typeof value==='object'&&!Array.isArray(value)&&(value.authReady===true||value.approved===true||value.ready===true));
  }
  function usernames(value){
    return Object.entries(plainObject(value))
      .filter(([,record])=>discoverableRecord(record))
      .map(([username])=>username)
      .filter(Boolean);
  }
  function rankSuggestions(directory,query,{limit=12,compare=(a,b)=>a.localeCompare(b)}={}){
    const q=fold(query);
    return usernames(directory).map(name=>{
      const normalized=fold(name);
      let score=-1;
      if(!q)score=5;
      else if(normalized===q)score=0;
      else if(normalized.startsWith(q))score=1;
      else if(normalized.includes(q))score=2;
      return{name,score,ready:readyRecord(directory[name])};
    }).filter(item=>item.score>=0)
      .sort((a,b)=>a.score-b.score||compare(a.name,b.name))
      .slice(0,limit);
  }
  function createLoginDirectoryState(){
    let generation=0;
    let state={status:STATES.IDLE,directory:{},errorCode:null,generation};
    function snapshot(){return Object.freeze({...state,directory:cloneDirectory(state.directory)})}
    function begin(){
      generation++;
      state={status:STATES.LOADING,directory:{},errorCode:null,generation};
      return Object.freeze({generation});
    }
    function succeed(token,value){
      if(token?.generation!==generation)return{ok:false,status:'stale'};
      state={status:STATES.LOADED,directory:cloneDirectory(value),errorCode:null,generation};
      return{ok:true,status:STATES.LOADED,count:usernames(state.directory).length};
    }
    function fail(token,error){
      if(token?.generation!==generation)return{ok:false,status:'stale'};
      state={status:STATES.ERROR,directory:{},errorCode:String(error?.code||'login-directory/read-failed'),generation};
      return{ok:true,status:STATES.ERROR,errorCode:state.errorCode};
    }
    return Object.freeze({begin,succeed,fail,snapshot,suggestions:(query,options)=>rankSuggestions(state.directory,query,options)});
  }

  root.loginDirectory=Object.freeze({STATES,discoverableRecord,readyRecord,usernames,rankSuggestions,createLoginDirectoryState});
})(window);
