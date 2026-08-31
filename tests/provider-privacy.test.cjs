const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

test('provider privacy notice is public, standalone, and skips authentication startup',()=>{
  assert.match(html,/window\.__pogoPrivacyRequest=parsePogoPrivacyRequest\(\)/);
  assert.match(html,/if\(!window\.__pogoPublicShareRequest&&!window\.__pogoPrivacyRequest\)/);
  assert.match(html,/id="privacy-pg"[^>]+hidden/);
  assert.match(html,/if\(window\.__pogoPrivacyRequest\)[\s\S]+revealPrivacyNotice/);
  assert.match(html,/href="\?legal=privacy">Privacy<\/a>/);
});

test('privacy notice states the exact Google identity and token boundaries',()=>{
  for(const disclosure of[
    'does not use an email address, display name, photo, or name similarity',
    'requests no additional Google API scopes',
    'does not separately copy, log, or store Google OAuth access or refresh tokens',
    'does not sell personal information'
  ])assert.match(html,new RegExp(disclosure));
});
