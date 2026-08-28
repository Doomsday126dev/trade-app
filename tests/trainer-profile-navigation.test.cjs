const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
function block(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1);assert.notEqual(to,-1);
  return html.slice(from,to);
}

test('new trainer navigation owns one top reset while profile rerenders preserve context',()=>{
  const source=block('function resetNewTrainerProfileScroll','const PUBLIC_SHARE_LIST_KEYS');
  assert.match(source,/if\(previousUsername===username\)return false/);
  assert.match(source,/requestAnimationFrame\(\(\)=>requestAnimationFrame/);
  assert.match(source,/window\.scrollTo\(\{top:0,left:0,behavior:'auto'\}\)/);
  assert.match(source,/resetNewTrainerProfileScroll\(previousUsername,username\)/);
  assert.equal((source.match(/resetNewTrainerProfileScroll\(/g)||[]).length,3);
  assert.match(source,/_shareReturnScroll=\{x:window\.scrollX,y:window\.scrollY\}/);
  assert.match(source,/window\.scrollTo\(\{left:restore\.x,top:restore\.y,behavior:'auto'\}\)/);
});

test('trainer navigation renders a measurable shell before awaiting public data',()=>{
  const open=block('async function openTrainerPublicShare','function renderSettings');
  const shell=block('function enterShareLoadingShell','function enterShareView');
  assert.ok(open.indexOf('enterShareLoadingShell(req.username,req.type)')<open.indexOf('await loadPublicShareData'));
  assert.match(shell,/document\.getElementById\('share-view'\)\.classList\.add\('active'\)/);
  assert.match(shell,/trainer\.profileLoading/);
  assert.match(shell,/window\.__pogoTrainerProfileShellAt=performance\.now\(\)/);
  assert.match(shell,/performance\.measure\('pogo:trainer-profile-shell'/);
  assert.match(shell,/return window\.__pogoTrainerProfileShellAt-startedAt/);
});

test('shared-list mobile language control has text, accessible purpose, and touch target',()=>{
  assert.match(html,/id="share-language-trigger"[^>]+data-i18n-aria-label="account\.languageSettings"/);
  assert.match(html,/id="share-language-trigger"[\s\S]*?<span data-i18n="account\.language">Language<\/span>/);
  assert.match(html,/#share-language-trigger span\{display:inline\}/);
  assert.match(html,/#share-language-trigger\{min-height:44px/);
});
