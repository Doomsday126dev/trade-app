const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname,'..');
const auditCli = require('../scripts/audit-trainer-names.js');

function loadDomain(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot,'js/domain/trainerNames.js'),'utf8'),
    context
  );
  return context.window.PogoDomain.trainerNames;
}

const domain=loadDomain();

test('normalization trims, applies NFKC, lowercases, and preserves display values',()=>{
  assert.deepEqual(
    {...domain.trainerNameParts('  ＴｒＡｉｎｅｒ42  ')},
    {
      originalValue:'  ＴｒＡｉｎｅｒ42  ',
      trainerName:'ＴｒＡｉｎｅｒ42',
      nfkcTrainerName:'TrAiner42',
      normalizedTrainerName:'trainer42',
      changedByTrimming:true,
      changedByNfkc:true,
      valid:true
    }
  );
});

test('capitalization differences normalize to the same handle',()=>{
  assert.equal(domain.normalizeTrainerName('PogoTrainer'),domain.normalizeTrainerName('POGOTRAINER'));
  assert.equal(domain.normalizeTrainerName('I'),'i');
  assert.equal(domain.normalizeTrainerName('İ'),'i\u0307');
  assert.notEqual(domain.normalizeTrainerName('Straße'),domain.normalizeTrainerName('STRASSE'));
});

test('visually similar characters from different scripts remain distinct',()=>{
  assert.notEqual(domain.normalizeTrainerName('Ace'),domain.normalizeTrainerName('Аce'));
});

test('punctuation, digits, and internal spacing are preserved',()=>{
  assert.equal(domain.normalizeTrainerName('Ace-007!'), 'ace-007!');
  assert.equal(domain.normalizeTrainerName('Ace  007'), 'ace  007');
});

test('empty and whitespace-only values are invalid',()=>{
  assert.equal(domain.normalizeTrainerName('   '),'');
  assert.equal(domain.trainerNameParts(null).valid,false);
  assert.equal(domain.trainerNameParts(undefined).valid,false);
});

test('audit groups duplicate normalized handles and reports transformations',()=>{
  const result=domain.auditTrainerNames(['Ace',' ace ','ＡＣＥ','Solo','   ']);
  assert.deepEqual({...result.summary},{
    totalNames:5,
    uniqueNormalizedNames:2,
    collisionGroups:1,
    collidingNames:3,
    changedByTrimming:2,
    changedByNfkc:1,
    invalidOrEmpty:1
  });
  assert.equal(result.collisions[0].normalizedTrainerName,'ace');
  assert.deepEqual(Array.from(result.collisions[0].entries,entry=>entry.originalValue),['Ace',' ace ','ＡＣＥ']);
});

test('report includes private detail and aggregate machine-readable fields',()=>{
  const report=auditCli.buildReport(['Ace',' ACE '],{kind:'fixture',input:'synthetic.json'},'2026-08-03T00:00:00.000Z');
  assert.equal(report.schemaVersion,1);
  assert.equal(report.summary.collisionGroups,1);
  assert.match(report.collisions[0].id,/^collision-[a-f0-9]{12}$/);
  assert.equal(report.entries[1].originalValue,' ACE ');
  assert.deepEqual(report.normalization.order,['trim','NFKC','toLowerCase']);
});

test('fixture extraction accepts names arrays and loginDirectory objects',()=>{
  assert.deepEqual(auditCli.extractTrainerNames({names:['One','Two']}),['One','Two']);
  assert.deepEqual(auditCli.extractTrainerNames({loginDirectory:{One:{},Two:{}}}),['One','Two']);
});

test('production mode fails closed without explicit confirmations and token',()=>{
  const base={
    source:'production',
    databaseUrl:'https://example-default-rtdb.firebaseio.com',
    projectId:'example',
    databaseId:'example-default-rtdb'
  };
  assert.throws(()=>auditCli.verifiedDatabaseTarget(base),/allow-production-read/);
  assert.throws(
    ()=>auditCli.verifiedDatabaseTarget({...base,allowProductionRead:true}),
    /confirm-project/
  );
  assert.throws(
    ()=>auditCli.verifiedDatabaseTarget({...base,allowProductionRead:true,confirmProject:'wrong',confirmDatabase:'example-default-rtdb',authTokenEnv:'AUDIT_TOKEN'}),
    /does not match/
  );
  assert.throws(
    ()=>auditCli.verifiedDatabaseTarget({...base,allowProductionRead:true,confirmProject:'example',confirmDatabase:'example-default-rtdb',authTokenEnv:'MISSING_TRAINER_AUDIT_TOKEN'}),
    /environment variable is empty/
  );
  assert.throws(
    ()=>auditCli.verifiedDatabaseTarget({...base,allowProductionRead:true,databaseUrl:'https://other-default-rtdb.firebaseio.com',confirmProject:'example',confirmDatabase:'example-default-rtdb',authTokenEnv:'MISSING_TRAINER_AUDIT_TOKEN'}),
    /does not match --database-id/
  );
});

test('name-bearing reports cannot be written outside the ignored private directory',()=>{
  assert.throws(()=>auditCli.privateOutputPath('docs/trainer-names.json'),/must stay under/);
  assert.match(
    auditCli.privateOutputPath('.local/trainer-name-audits/explicit.json'),
    /\.local\/trainer-name-audits\/explicit\.json$/
  );
});

test('emulator mode rejects non-loopback hosts',()=>{
  assert.throws(
    ()=>auditCli.verifiedDatabaseTarget({source:'emulator',databaseUrl:'https://example.com',projectId:'demo'}),
    /loopback/
  );
});

test('remote audit performs a GET-only directory read',async()=>{
  let request=null;
  const fetchImpl=async(url,options)=>{
    request={url:String(url),options};
    return{ok:true,status:200,json:async()=>({TrainerOne:{},TrainerTwo:{}})};
  };
  const result=await auditCli.readTrainerNames({
    source:'emulator',
    databaseUrl:'http://127.0.0.1:9000',
    projectId:'demo-trainer-audit'
  },{fetchImpl});
  assert.equal(request.options.method,'GET');
  assert.match(request.url,/\/loginDirectory\.json\?ns=demo-trainer-audit$/);
  assert.deepEqual(result.names,['TrainerOne','TrainerTwo']);
});

test('production audit performs one verified GET without exposing its token in report metadata',async()=>{
  const tokenEnv='TRAINER_AUDIT_TEST_TOKEN';
  process.env[tokenEnv]='test-token-not-a-credential';
  let request=null;
  try{
    const result=await auditCli.readTrainerNames({
      source:'production',
      allowProductionRead:true,
      databaseUrl:'https://example-default-rtdb.firebaseio.com',
      projectId:'example',
      databaseId:'example-default-rtdb',
      confirmProject:'example',
      confirmDatabase:'example-default-rtdb',
      authTokenEnv:tokenEnv
    },{
      fetchImpl:async(url,options)=>{
        request={url:String(url),options};
        return{ok:true,status:200,json:async()=>({TrainerOne:{}})};
      }
    });
    assert.equal(request.options.method,'GET');
    assert.match(request.url,/\/loginDirectory\.json\?auth=test-token-not-a-credential$/);
    assert.equal(JSON.stringify(result.source).includes('test-token-not-a-credential'),false);
    assert.deepEqual(result.names,['TrainerOne']);
  }finally{
    delete process.env[tokenEnv];
  }
});
