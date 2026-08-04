(function(global){
  const root=global.PogoServices=global.PogoServices||{};

  function errorResult(error,code='firebase/operation-failed'){
    return{
      ok:false,
      error:Object.freeze({
        code:String(error?.code||code),
        message:String(error?.message||'Firebase operation failed')
      })
    };
  }

  function createFirebaseClient({database,ref,get,onValue}){
    if(!database||typeof ref!=='function'||typeof get!=='function'||typeof onValue!=='function'){
      throw new TypeError('Firebase client requires database, ref, get, and onValue');
    }
    const databaseRef=path=>ref(database,String(path||''));
    async function read(path){
      try{
        const snapshot=await get(databaseRef(path));
        return{ok:true,value:snapshot?.exists?.()?snapshot.val():null,snapshot};
      }catch(error){
        return errorResult(error,'firebase/read-failed');
      }
    }
    function listen(path,{onData,onError}={}){
      if(typeof onData!=='function')return errorResult(new TypeError('onData must be a function'),'firebase/invalid-listener');
      try{
        const unsubscribe=onValue(
          databaseRef(path),
          snapshot=>onData(snapshot?.exists?.()?snapshot.val():null,snapshot),
          error=>onError?.(errorResult(error,'firebase/listener-failed').error)
        );
        if(typeof unsubscribe!=='function')return errorResult(new TypeError('Firebase listener did not return an unsubscribe function'),'firebase/invalid-unsubscribe');
        return{ok:true,unsubscribe};
      }catch(error){
        return errorResult(error,'firebase/listener-start-failed');
      }
    }
    return Object.freeze({databaseRef,read,listen});
  }

  root.firebaseClient=Object.freeze({createFirebaseClient,errorResult});
})(window);
