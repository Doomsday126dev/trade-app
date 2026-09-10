const {test}=require('node:test'),assert=require('node:assert/strict');
const {createExactFavoriteResolver}=require('./exact-resolver.cjs');
function fixture(overrides={}){
  const reads=[],state={'authIndex/owner/username':'Owner','users/Owner/authUid':'owner','users/Other/authUid':'target','authIndex/target/username':'Other'};
  const resolve=createExactFavoriteResolver({verifyAuth:async()=>({uid:'owner'}),verifyAppCheck:async(_,{consume})=>consume,consumeQuota:async()=>true,readExact:async path=>{reads.push(path);return state[path];},...overrides});
  return{reads,state,resolve};
}
test('returns only exact reciprocal identity using four scalar reads',async()=>{
  const f=fixture();assert.deepEqual(await f.resolve({body:{handle:'Other'}}),{ok:true,targetUid:'target',canonicalHandle:'Other'});
  assert.deepEqual(f.reads,['authIndex/owner/username','users/Owner/authUid','users/Other/authUid','authIndex/target/username']);
});
test('authentication, consumed App Check and shared quota are mandatory before identity reads',async()=>{
  for(const overrides of [{verifyAuth:async()=>null},{verifyAppCheck:async()=>false},{consumeQuota:async()=>false},{verifyAuth:async()=>{throw Error('expired');}}]){const f=fixture(overrides);assert.equal((await f.resolve({body:{handle:'Other'}})).ok,false);assert.equal(f.reads.length,0);}
});
test('no case/name guessing, path injection, arbitrary UID, self-target or inconsistent pair',async()=>{
  for(const handle of ['other','Other/secret','Other.#',' Other','Owner','']){const f=fixture();assert.equal((await f.resolve({body:{handle}})).ok,false);}
  const f=fixture();assert.equal((await f.resolve({body:{handle:'Other',targetUid:'forged'}})).ok,false);assert.equal(f.reads.length,0);
  for(const path of ['users/Owner/authUid','authIndex/target/username']){const f=fixture();f.state[path]='mismatch';assert.equal((await f.resolve({body:{handle:'Other'}})).ok,false);}
});
test('missing target, reciprocal mismatch and transient read failure share the same public diagnostic',async()=>{
  const absent=fixture();delete absent.state['users/Other/authUid'];
  const mismatch=fixture();mismatch.state['authIndex/target/username']='Elsewhere';
  const failed=fixture({readExact:async()=>{throw Error('internal detail');}});
  const results=await Promise.all([absent,mismatch,failed].map(f=>f.resolve({body:{handle:'Other'}})));
  assert.ok(results.every(result=>JSON.stringify(result)===JSON.stringify({ok:false,code:'favorite/identity-unavailable'})));
});
