const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
function between(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1);assert.notEqual(to,-1);
  return html.slice(from,to);
}
test('ADMIN-01 retires community product controls while retaining dormant compatibility code',()=>{
  assert.match(html,/const MULTI_COMMUNITY_ENABLED=false/);
  assert.match(html,/const MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=false/);
  const render=between('function renderAdmin','async function repairAccount');
  assert.doesNotMatch(render,/renderCommunityMigrationPanel/);
  const pending=between('function renderPendingRequests','async function approveRequest');
  assert.doesNotMatch(pending,/approve-community|preparedNonDefaultCommunities|enrollInto/);
  const approve=between('async function approveRequest','async function copyApprovedLogin');
  assert.match(approve,/createMemberNow\(username,pin,false,reqId\)/);
  assert.doesNotMatch(approve,/communityIds|approve-community/);
  assert.doesNotMatch(html,/id="community-migration-panel"/);
  assert.match(html,/function renderCommunityMigrationPanel/);
});
