(function(global){
  const root=global.PogoTesting=global.PogoTesting||{};
  const TEST_NAMESPACE='pogo-sync-ux-test-v1';
  const FIXTURES=Object.freeze({
    'note-edit':Object.freeze({source:'deterministic-mock',kind:'note-edit',localValue:'Meet after raid hour',remoteValue:'Available Saturday'}),
    'tag-rename':Object.freeze({source:'deterministic-mock',kind:'tag-rename',localValue:'Next meetup',remoteValue:'Weekend group'}),
    'favorite-stale':Object.freeze({source:'deterministic-mock',kind:'favorite-stale',localValue:true,remoteValue:false}),
    'offline-newer-remote':Object.freeze({source:'deterministic-mock',kind:'offline-newer-remote',localValue:'Offline device edit',remoteValue:'Newer cloud edit'}),
    'stale-schema':Object.freeze({source:'deterministic-mock',kind:'stale-schema',localValue:'Older app format',remoteValue:'Current app format'})
  });

  function clone(value){return JSON.parse(JSON.stringify(value));}
  function createTrainerPreferenceSyncMockAdapter({testMode=false,environment='production'}={}){
    if(testMode!==true||!['test','development'].includes(environment))throw new Error('Trainer preference sync mock adapter is test-only');
    function fixture(kind){return FIXTURES[kind]?Object.freeze(clone(FIXTURES[kind])):null;}
    function migrationPreview({localCounts={},cloudCounts={},conflictCount=0}={}){
      return Object.freeze({source:'deterministic-mock',localCounts:Object.freeze(clone(localCounts)),cloudCounts:Object.freeze(clone(cloudCounts)),conflictCount:Math.max(0,Number(conflictCount)||0),executable:false,localDeletionAllowed:false});
    }
    function resolveFixture(kind,choice){
      const value=fixture(kind);if(!value)return Object.freeze({ok:false,code:'fixture-unavailable'});
      const allowed={
        'note-edit':['keep-both','use-device','use-cloud'],'tag-rename':['keep-both','use-device','use-cloud'],
        'favorite-stale':['keep-current','try-again'],'offline-newer-remote':['keep-both','use-device','use-cloud'],'stale-schema':['refresh']
      }[kind]||[];
      if(!allowed.includes(choice))return Object.freeze({ok:false,code:'choice-unavailable'});
      if(choice==='keep-both')return Object.freeze({ok:true,choice,preserved:Object.freeze({device:value.localValue,cloud:value.remoteValue}),discarded:Object.freeze([])});
      if(choice==='use-device'||choice==='try-again')return Object.freeze({ok:true,choice,preserved:value.localValue,discarded:Object.freeze(['cloud-fixture'])});
      if(choice==='use-cloud'||choice==='keep-current')return Object.freeze({ok:true,choice,preserved:value.remoteValue,discarded:Object.freeze(['device-fixture'])});
      return Object.freeze({ok:true,choice,preserved:Object.freeze({device:value.localValue,cloud:value.remoteValue}),discarded:Object.freeze([]),reloadRequired:true});
    }
    function snapshot(){return Object.freeze({adapter:'deterministic-local-mock',namespace:TEST_NAMESPACE,fixtureCount:Object.keys(FIXTURES).length,networkRequests:0,browserStorageWrites:0,remoteSdkImports:0,productionAvailable:false});}
    return Object.freeze({fixture,migrationPreview,resolveFixture,snapshot});
  }

  root.trainerPreferenceSyncMockAdapter=Object.freeze({TEST_NAMESPACE,FIXTURES,createTrainerPreferenceSyncMockAdapter});
})(window);
