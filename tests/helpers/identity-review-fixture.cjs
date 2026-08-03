const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {hash}=require('../../scripts/lib/uid-handle-source-reader.cjs');
const {buildPrivateReport}=require('../../scripts/lib/private-identity-report.cjs');

const root=path.resolve(__dirname,'../..');

function sources(){
  return{
    loginDirectory:{
      DuplicateTrainer:{authReady:true,authVersion:1},
      MismatchTrainer:{authReady:true,authVersion:1},
      ProtectedTrainer:{authReady:true,authVersion:1},
      PassiveTrainer:{authReady:true,authVersion:1},
      ReadyTrainer:{authReady:true,authVersion:1}
    },
    users:{
      DuplicateTrainer:{authUid:'uid-duplicate-current',joined:1,lastSeen:2,lastUpdated:3},
      MismatchTrainer:{authUid:'uid-mismatch-current'},
      ProtectedTrainer:{authUid:'uid-protected',isOwner:true},
      PassiveTrainer:{authUid:'uid-passive'},
      LegacyTrainer:{authUid:'uid-legacy'},
      ReadyTrainer:{authUid:'uid-ready'}
    },
    authIndex:{
      'uid-duplicate-current':{username:'DuplicateTrainer',lastSeen:10},
      'uid-duplicate-other':{username:'DuplicateTrainer',lastSeen:5},
      'uid-mismatch-other':{username:'MismatchTrainer',lastSeen:4},
      'uid-protected':{username:'ProtectedTrainer'},
      'uid-legacy':{username:'LegacyTrainer'},
      'uid-ready':{username:'ReadyTrainer'}
    },
    admins:{'uid-protected':true},
    authInput:{
      schemaVersion:1,
      identities:[
        {uid:'uid-duplicate-current',disabled:false,emailVerified:true,providers:['password'],expectedSyntheticEmailMatches:true},
        {uid:'uid-duplicate-other',disabled:true,emailVerified:false,providers:['password'],expectedSyntheticEmailMatches:false},
        {uid:'uid-mismatch-current',disabled:false,emailVerified:true,providers:['google.com'],expectedSyntheticEmailMatches:true},
        {uid:'uid-mismatch-other',disabled:false,emailVerified:false,providers:['password'],expectedSyntheticEmailMatches:false},
        {uid:'uid-protected',disabled:false,emailVerified:true,providers:['password'],expectedSyntheticEmailMatches:true},
        {uid:'uid-passive',disabled:false,emailVerified:false,providers:['password'],expectedSyntheticEmailMatches:true},
        {uid:'uid-legacy',disabled:false,emailVerified:false,providers:['password'],expectedSyntheticEmailMatches:true},
        {uid:'uid-ready',disabled:false,emailVerified:true,providers:['google.com'],expectedSyntheticEmailMatches:true},
        {uid:'uid-unassociated',disabled:false,emailVerified:false,providers:['password'],expectedSyntheticEmailMatches:false}
      ]
    }
  };
}

function reconciliationDomain(){
  const context={window:{}};
  vm.createContext(context);
  for(const file of ['js/domain/trainerNames.js','js/domain/identityReconciliation.js']){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  return context.window.PogoDomain.identityReconciliation;
}

function fixture(){
  const input=sources();
  const result=reconciliationDomain().reconcileIdentitySources(input);
  if(!result.ok)throw new Error(result.error.code);
  const snapshotHashes={
    loginDirectory:hash(input.loginDirectory),
    users:hash(input.users),
    authIndex:hash(input.authIndex),
    admins:hash(input.admins),
    authInput:hash(input.authInput)
  };
  const report=buildPrivateReport(result.value,{
    source:'fixture',
    targetVerified:false,
    sourceCounts:result.value.sourceCounts,
    sourceSnapshotHashes:snapshotHashes
  },{generatedAt:'2026-08-03T00:00:00.000Z',secret:Buffer.from('identity-review-test-secret')});
  return{sources:input,report,snapshotHashes};
}

function writeFixtureFiles(directory){
  const value=fixture();
  const report=path.join(directory,'report.json');
  const rtdb=path.join(directory,'rtdb.json');
  const auth=path.join(directory,'auth.json');
  fs.writeFileSync(report,`${JSON.stringify(value.report,null,2)}\n`);
  fs.writeFileSync(rtdb,`${JSON.stringify({
    loginDirectory:value.sources.loginDirectory,
    users:value.sources.users,
    authIndex:value.sources.authIndex,
    admins:value.sources.admins
  },null,2)}\n`);
  fs.writeFileSync(auth,`${JSON.stringify(value.sources.authInput,null,2)}\n`);
  return{...value,files:{report,rtdb,auth}};
}

module.exports={root,sources,fixture,writeFixtureFiles};
