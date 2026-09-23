const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);

test('safe-transfer ships as one literal enabled implementation with no runtime bypass',()=>{
  assert.match(source,/const SAFE_TRANSFER_GENERATION_ENABLED=true/);
  assert.doesNotMatch(source,/SAFE_TRANSFER_GENERATION_ENABLED\s*=\s*(?:false|window|localStorage|location)/);
  assert.equal((source.match(/function openSafeTransferModal\(/g)||[]).length,1);
  assert.equal((source.match(/function copySafeTransferString\(/g)||[]).length,1);
});

test('safe-transfer copy begins disabled and becomes available only through the qualified controller',()=>{
  const html=readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/id="stb-copy-btn"[^>]*disabled/);
  assert.match(source,/revalidateBeforeCopy:true/);
  assert.match(source,/managedPublicShareRepository\.readFresh\(/);
  assert.match(source,/const result=await _ensureSafeTransferController\(\)\.copyPart\(Number\(index\)\|\|0\)/);
});
