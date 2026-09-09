const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const source=fs.readFileSync('js/app/application.js','utf8'),ast=acorn.parse(source,{ecmaVersion:'latest'});
function extract(name){const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(node.start,node.end);}
test('onboarding handoff fences a same-UID lifecycle change before any owned session activation',async()=>{
  for(const replace of [false,true]){
    let lifecycle='auth-1',activated=0;
    const nodes={'google-onboarding-handle':{value:'TrainerNew'},'google-onboarding-friend-code':{value:'0000 1111 2222'},'google-onboarding-status':{}};
    const context=vm.createContext({auth:{currentUser:{uid:'uid-new'}},document:{getElementById:id=>nodes[id]},
      providerAuthSnapshot:()=>({uid:'uid-new',lifecycleId:lifecycle}),ensureProviderAccountFoundationClient:()=>({pending:()=>null}),
      providerOnboardingController:{snapshot:()=>({status:'ready-to-create'}),confirmProfile:()=>{},create:async()=>{
        if(replace)lifecycle='auth-3';return{status:'account-ready',foundation:{canonicalTrainerName:'TrainerNew'},initialProfile:{friendCode:'0000 1111 2222'}};
      }},hideGoogleOnboarding:()=>{},syncGoogleOnboardingUi:()=>{},providerUiMessage:code=>code,
      providerFailure:(code,state)=>Object.assign(new Error(code),{code,state}),activateGoogleResolvedAccount:resolution=>{activated++;assert.equal(resolution.uid,'uid-new');assert.equal(resolution.lifecycleId,'auth-1');assert.equal(resolution.profile.friendCode,'0000 1111 2222');}});
    vm.runInContext(extract('checkGoogleOnboarding'),context);await context.checkGoogleOnboarding();
    assert.equal(activated,replace?0:1);
  }
});
test('provider creation sends the current product release as diagnostic metadata',()=>{
  let options;
  const context=vm.createContext({PROVIDER_CAPABILITIES:{providerAccountCompatibility:true},providerAccountFoundationClient:null,
    providerAccountFoundationService:{createProviderAccountClient:value=>{options=value;return{};}},fbApp:{},auth:{},
    firebaseAppCheckReady:()=>{},providerAuthSnapshot:()=>{},localStorage:{},clientReleaseDomain:{RELEASE_ID:'2026-09-08.103'}});
  vm.runInContext(extract('ensureProviderAccountFoundationClient'),context);context.ensureProviderAccountFoundationClient();
  assert.equal(options.clientRelease,'2026-09-08.103');
});
