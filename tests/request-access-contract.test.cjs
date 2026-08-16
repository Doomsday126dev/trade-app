const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const packageJson=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
const context=vm.createContext({window:{}});
vm.runInContext(readFileSync(path.join(root,'js/domain/requestAccess.js'),'utf8'),context);
const contract=context.window.PogoDomain.requestAccess;
const plain=value=>JSON.parse(JSON.stringify(value));

test('active Request Access writer uses one canonical builder and one existing Firebase path',()=>{
  assert.match(html,/requestAccess\.build\(\{rawUsername,rawNote,canonicalize:canonicalUsernameInput\}\)/);
  assert.equal((html.match(/set\(ref\(db,`requests\/\$\{reqId\}`\),reqData\)/g)||[]).length,1);
  for(const key of ['request.nameTooLong','request.noteTooLong'])assert.match(html,new RegExp(key.replace('.','\\.'),'u'));
  assert.doesNotMatch(html,/const reqData=\{username,note:/);
  assert.doesNotMatch(html,/requests\/\$\{reqId\}.*(?:admin|isAdmin)/);
});

test('candidate Rules remain emulator-only and cannot replace an active Rules source accidentally',()=>{
  const activeConfigs=['tests/firebase/firebase.json','tests/firebase/firebase.narrow-read.json'];
  for(const file of activeConfigs)assert.doesNotMatch(readFileSync(path.join(root,file),'utf8'),/request-access-candidate/);
  assert.equal(packageJson.scripts['check:request-access-candidate-rules'],'bash scripts/check-request-access-candidate-rules.sh');
  assert.doesNotMatch(readFileSync(path.join(root,'scripts/check-request-access-candidate-rules.sh'),'utf8'),/deploy|use\s+--add|projects:update/);
});

test('canonical builder preserves trim, bounds, optional-note, timestamp and pending semantics',()=>{
  const result=contract.build({
    rawUsername:'  Trainer Name  ',rawNote:'  local group  ',now:1700000000000,randomValue:0.5,
    canonicalize:value=>value==='Trainer Name'?'TrainerName':value
  });
  assert.equal(result.ok,true);
  assert.match(result.id,contract.REQUEST_ID_PATTERN);
  assert.deepEqual(plain(result.payload),{
    username:'TrainerName',note:'local group',requestedAt:1700000000000,status:'pending'
  });
  assert.deepEqual(plain(contract.build({rawUsername:'AB',now:1,randomValue:0}).payload),{
    username:'AB',note:'',requestedAt:1,status:'pending'
  });
});

test('username validation accepts Unicode and internal spaces but rejects missing short wrong-type and control values',()=>{
  for(const username of ['AB','ポケモン','Ä Trainer','A B','U'.repeat(32),'😀'.repeat(16)])assert.equal(contract.build({rawUsername:username,now:1,randomValue:0.1}).ok,true,username);
  assert.equal(contract.build({rawUsername:'   ',now:1,randomValue:0.1}).code,'username-required');
  assert.equal(contract.build({rawUsername:' A ',now:1,randomValue:0.1}).code,'username-too-short');
  assert.equal(contract.build({rawUsername:'U'.repeat(33),now:1,randomValue:0.1}).code,'username-too-long');
  assert.equal(contract.build({rawUsername:'😀'.repeat(17),now:1,randomValue:0.1}).code,'username-too-long');
  assert.equal(contract.build({rawUsername:42,now:1,randomValue:0.1}).code,'invalid-type');
  for(const username of ['AB\nCD','AB\u0000CD','AB\u007fCD'])assert.equal(contract.build({rawUsername:username,now:1,randomValue:0.1}).code,'invalid-characters');
});

test('note remains optional through canonical empty string and enforces the final 280-character ceiling',()=>{
  assert.equal(contract.build({rawUsername:'AB',rawNote:undefined,now:1,randomValue:0.1}).payload.note,'');
  assert.equal(contract.build({rawUsername:'AB',rawNote:'   ',now:1,randomValue:0.1}).payload.note,'');
  assert.equal(contract.build({rawUsername:'AB',rawNote:'日本語 notes',now:1,randomValue:0.1}).payload.note,'日本語 notes');
  assert.equal(contract.build({rawUsername:'AB',rawNote:'line one\nline two',now:1,randomValue:0.1}).code,'invalid-characters');
  assert.equal(contract.build({rawUsername:'AB',rawNote:{nested:true},now:1,randomValue:0.1}).code,'invalid-type');
  assert.equal(contract.build({rawUsername:'AB',rawNote:'x'.repeat(280),now:1,randomValue:0.1}).ok,true);
  assert.equal(contract.build({rawUsername:'AB',rawNote:'x'.repeat(281),now:1,randomValue:0.1}).code,'note-too-long');
  assert.equal(contract.build({rawUsername:'AB',rawNote:'😀'.repeat(140),now:1,randomValue:0.1}).ok,true);
  assert.equal(contract.build({rawUsername:'AB',rawNote:'😀'.repeat(141),now:1,randomValue:0.1}).code,'note-too-long');
});

test('final bounds are exported and no current-time skew policy is introduced',()=>{
  const source=readFileSync(path.join(root,'js/domain/requestAccess.js'),'utf8');
  assert.equal(contract.USERNAME_MIN_LENGTH,2);
  assert.equal(contract.USERNAME_MAX_LENGTH,32);
  assert.equal(contract.NOTE_MAX_LENGTH,280);
  assert.doesNotMatch(source,/serverTimestamp|\.sv|requestedAt.*Date\.now\(\).*[+-]/s);
});

test('builder captures the client clock once and shares it between key and payload',()=>{
  let calls=0;
  const built=contract.build({rawUsername:'AB',now:()=>{calls++;return 1700000000123;},randomValue:0.1});
  assert.equal(calls,1);
  assert.equal(built.payload.requestedAt,1700000000123);
  assert.match(built.id,/^req_1700000000123_/u);
});

test('request keys match the currently supported timestamp and lowercase base36 suffix contract',()=>{
  for(const randomValue of [0,0.1,0.999999])assert.match(contract.requestKey(1700000000000,randomValue),/^req_1700000000000_[a-z0-9]{1,5}$/);
  for(const key of ['other_1_a','req_1_','req_1_abcdef','req_1_A','req_1_a-','req_1_a/b','random'])assert.equal(contract.REQUEST_ID_PATTERN.test(key),false,key);
  assert.equal(contract.requestKey(-1,0.1),'');
  assert.equal(contract.requestKey(1.5,0.1),'');
  assert.equal(contract.requestKey(1,1),'');
});

test('hostile markup remains data and the builder never adds authorization fields',()=>{
  for(const hostile of ['<img src=x onerror=alert(1)>','<script>alert(1)</script>','"><svg onload=alert(1)>']){
    const built=contract.build({rawUsername:hostile,rawNote:hostile,now:1,randomValue:0.1});
    assert.equal(built.ok,true);
    assert.deepEqual(Object.keys(built.payload),['username','note','requestedAt','status']);
    assert.equal(built.payload.username,hostile);
    assert.equal(built.payload.note,hostile);
  }
});
