const {execFileSync,spawnSync}=require('node:child_process');
const {existsSync,appendFileSync}=require('node:fs');

const PRODUCT=['tests/trade-list-comparison.test.cjs','tests/account-sync-product.test.cjs','tests/i18n.test.cjs','tests/public-share-localization.test.cjs','tests/pokemon-go-search-syntax.test.cjs'];
const SYNC=['tests/account-sync-domain.test.cjs','tests/account-sync-eligibility.test.cjs','tests/account-sync-product.test.cjs','tests/account-sync-repository.test.cjs','tests/account-sync-runtime.test.cjs','tests/account-sync-recovery.test.cjs','tests/my-list-sync-safety.test.cjs'];
const PRIVACY=['tests/public-share-publication.test.cjs','tests/provider-privacy.test.cjs','tests/share-visibility-client.test.cjs'];
const RELEASE=['tests/client-asset-versioning.test.cjs','tests/frontend-asset-extraction.test.cjs','tests/service-worker-release.test.cjs','tests/service-worker-atomic-install.test.cjs','tests/service-worker-cache-lifecycle.test.cjs','tests/service-worker-deployment-rollback.test.cjs','tests/service-worker-install-performance.test.cjs'];
const PUBLIC_BACKEND=['functions/test/e1-provider-public-share.test.cjs','functions/test/e1-provider-public-share-gateway.test.cjs'];
// Surviving companions are a routing floor, not proof that deleted assertions
// were redundant. Unmapped test retirement requires an explicit owner decision.
const OWNER_GROUPS=[PRODUCT,SYNC,PRIVACY,RELEASE,PUBLIC_BACKEND,
  ['functions/test/e1-rate-limit.test.cjs','functions/test/e1-reserve-trainer-handle.test.cjs']];
const BACKEND_TEST_SUPPORT={
  'functions/test/helpers.cjs':['approved-viewer','common-callable','favorites','handle','history','safety-contract','tags'],
  'functions/test/helpers/groupEFixture.cjs':['e1-gateway','e1-group-e-admission','e1-group-e-client-foundation','e1-group-e-control-store','e1-production-client-foundation-execution']
};
const LEGACY_RESET=['tests/legacy-identity-fences.test.cjs','tests/legacy-slot-reconciliation.test.cjs','tests/legacy-slot-reconciliation-evidence.test.cjs','tests/legacy-slot-reconciliation-production.test.cjs','tests/legacy-identity-audit.test.cjs','tests/legacy-pin-reset-login.test.cjs','tests/legacy-pin-reset-ops.test.cjs'];
const legacyResetFile=file=>/^functions\/legacy-pin-reset\//.test(file)||[
  'firebase.legacy-identity-fences.json','firebase.legacy-identity-fences.emulator.json',
  'scripts/build-legacy-identity-fences.cjs','scripts/check-legacy-identity-fences.sh',
  'scripts/legacy-pin-reset-ops.cjs',
  'scripts/legacy-slot-reconciliation.cjs','scripts/legacy-identity-audit.cjs',
  'scripts/lib/legacy-slot-reconciliation.cjs','scripts/lib/legacy-slot-reconciliation-transport.cjs',
  'scripts/lib/legacy-slot-reconciliation-evidence.cjs','scripts/lib/legacy-slot-reconciliation-production.cjs',
  'scripts/lib/legacy-slot-reconciliation-boundary.cjs',
  'tests/firebase/database.rules.legacy-identity-fences.json','tests/firebase/legacy-identity-fences.test.cjs',
  'tests/firebase/legacy-identity-guard.test.cjs','tests/helpers/legacy-reconciliation-emulator.cjs','tests/legacy-pin-reset.spec.js',
  'docs/LEGACY-IDENTITY-REPAIR.md',...LEGACY_RESET
].includes(file);
function select(files,{exists=existsSync,checkDeletedOwners=true}={}){
  const node=new Set(['tests/product-check-selection.test.cjs']),browser=new Set(),commands=[],errors=[];
  const any=pattern=>files.some(file=>pattern.test(file));
  const add=tests=>tests.forEach(file=>node.add(file));
  const legacyReset=files.some(legacyResetFile);
  const resetOnly=legacyReset&&files.every(file=>legacyResetFile(file)||['tests/account-sync-runtime.test.cjs',
    'scripts/select-product-checks.cjs','tests/product-check-selection.test.cjs','.github/workflows/product-review.yml'].includes(file));
  if(legacyReset){
    add(LEGACY_RESET);
    commands.push(['npm',['--prefix','functions/legacy-pin-reset','test']]);
    commands.push(['bash',['scripts/check-legacy-identity-fences.sh']]);
    browser.add('tests/legacy-pin-reset.spec.js');
  }
  const product=any(/^(?:index\.html|css\/|js\/)/);
  if(any(/^(?:scripts\/archive-proof\/|docs\/verification\/archive-proof\/archive-v1\.schema\.json$)/))add(['tests/offline-archive-restore.test.cjs']);
  if(product){add(PRODUCT);browser.add('tests/trusted-readiness.spec.js');browser.add('tests/anonymous-public-share.spec.js');}
  if(any(/^(?:index\.html|sw\.js|js\/app\/application\.js|scripts\/pages\/|tests\/signed-in-boot-dependencies)/)){
    add(['tests/signed-in-boot-dependencies.test.cjs']);
    browser.add('tests/signed-in-boot-dependencies.spec.js');
  }
  if(any(/^js\/(?:data\/accountSync|domain\/accountSync|app\/application\.js)/)){add(SYNC);browser.add('tests/normal-sync-product.spec.js');}
  if(any(/^(?:js\/domain\/(?:pokemonKeys|publicPokemonDex)\.js|scripts\/generate-public-sprite-dex\.cjs)$/))add(['tests/pokemon-catalog.test.cjs','tests/sprite-resolution.test.cjs']);
  if(any(/^js\/(?:app\/|domain\/publicShare|services\/providerPublic|data\/(?:publicShare|trainerShare))/)){add(PRIVACY);browser.add('tests/anonymous-public-share.spec.js');}
  if(any(/^(?:sw\.js|index\.html|js\/domain\/clientRelease|release\/|scripts\/pages\/)/)||files.some(file=>RELEASE.includes(file))){
    add(RELEASE);add(['tests/verification-routing-workflow.test.cjs']);
  }
  if(any(/^(?:scripts\/select-product-checks\.cjs|tests\/verification-routing-workflow\.test\.cjs|\.github\/workflows\/(?:product-review|deploy-pages|pages-release-control)\.yml|package\.json)$/)){
    add(RELEASE);add(['tests/verification-routing-workflow.test.cjs','tests/pages-deployment-control.test.cjs']);
  }
  const publicContract=file=>['functions/e1-authority-service/providerPublicProjection.js','functions/e1-gateway/gatewayCore.js',...PUBLIC_BACKEND,'js/domain/providerPublicProjection.js','tests/firebase/database.rules.provider-public-projection.json'].includes(file);
  if(files.some(publicContract)){
    add(['tests/provider-public-projection.test.cjs','tests/provider-public-application-integration.test.cjs']);
    commands.push([process.execPath,['--test',...PUBLIC_BACKEND]]);
  }
  if(files.some(file=>!publicContract(file)&&!legacyResetFile(file)&&/^(?:functions\/|js\/(?:services\/(?:googleAuth|provider)|domain\/provider))/.test(file))){
    add(['tests/provider-linking-foundation.test.cjs','tests/provider-account-foundation.test.cjs','tests/provider-privacy.test.cjs']);
    // An unfamiliar backend change does not silently receive UI-only coverage.
    commands.push(['npm',['--prefix','functions','run','check:contract']]);
  }
  if(any(/firestore.*rules/))commands.push(['npm',['run','check:e1-firestore-authority']]);
  if(files.includes('tests/firebase/database.rules.provider-public-projection.json'))commands.push(['bash',['scripts/check-provider-public-projection-rules.sh']]);
  if(files.some(file=>!publicContract(file)&&!legacyResetFile(file)&&/database.*rules|SECURITY-RULES|build-sec02-production-rules/.test(file)))commands.push(['npm',['run','check:sec02-production-rules']]);
  if(any(/^\.github\/workflows\/frontend-performance\.yml$/))add(['tests/performance-observability.test.cjs']);
  for(const file of files){
    if(resetOnly&&file==='tests/account-sync-runtime.test.cjs')continue;
    if(BACKEND_TEST_SUPPORT[file])add(BACKEND_TEST_SUPPORT[file].map(name=>`functions/test/${name}.test.cjs`));
    else if(/^functions\/test\/.+\.(?:c?js|mjs|json)$/.test(file)&&!file.endsWith('.test.cjs'))errors.push(`Backend test support needs declared consumers: ${file}`);
    if(!exists(file)&&/\.(?:test\.cjs|spec\.js)$/.test(file)){
      const owners=[...OWNER_GROUPS.filter(group=>group.includes(file)).flat(),...(legacyResetFile(file)?LEGACY_RESET:[])].filter(owner=>owner!==file&&exists(owner));
      if(owners.length)add(owners);
      else errors.push(`Deleted test has no surviving declared owner: ${file}. Declare replacement coverage before qualification.`);
    }
    if(/^tests\/[\w/-]+\.test\.cjs$/.test(file)&&exists(file)&&!file.includes('operator')&&!file.startsWith('tests/firebase/'))node.add(file);
    if(/^functions\/test\/.+\.test\.cjs$/.test(file)&&exists(file)&&!commands.some(([command,args])=>command===process.execPath&&args[0]==='--test'&&args.includes(file)))node.add(file);
    if(/^tests\/[\w/-]+\.spec\.js$/.test(file)&&exists(file)&&!/(performance|provider)/i.test(file))browser.add(file);
  }
  // Keep deleted paths for ownership matching, but never pass them to runners.
  // Missing unchanged checks are configuration failures, not optional coverage.
  const runnable=file=>{
    if(exists(file))return true;
    if(!files.includes(file))errors.push(`Required check is missing: ${file}`);
    return false;
  };
  for(const file of node)if(!runnable(file))node.delete(file);
  for(const file of browser)if(!runnable(file))browser.delete(file);
  const safeCommands=commands.flatMap(([command,args])=>{
    if(command!==process.execPath||args[0]!=='--test')return[[command,args]];
    const tests=args.slice(1).filter(runnable);
    if(!tests.length){errors.push('No surviving tests for an owning backend command');return[];}
    return[[command,['--test',...tests]]];
  });
  if(checkDeletedOwners)for(const file of files){
    if(exists(file)||/\.(?:test\.cjs|spec\.js)$/.test(file)||/^(?:docs\/|.*\.(?:md|txt)$)/.test(file))continue;
    const owner=select([file],{exists,checkDeletedOwners:false});
    if(owner.node.length<=1&&!owner.browser.length&&!owner.commands.length){
      errors.push(`Deleted path has no declared surviving owner: ${file}. Add a routing rule before qualification.`);
    }
  }
  return{node:[...node].sort(),browser:[...browser].sort(),commands:safeCommands,errors,legacyReset,functions:[...node].some(file=>file.startsWith('functions/test/'))||safeCommands.some(([command,args])=>args.some(arg=>arg==='functions'||arg.startsWith('functions/')&&!arg.startsWith('functions/legacy-pin-reset'))),rules:legacyReset||commands.some(([command,args])=>args.some(arg=>/rules|firestore-authority/.test(arg))),sensitive:any(/accountSync|functions\/|rules|provider/i),
    performance:any(/^(?:index\.html|css\/|js\/|sw\.js|data\.js|data\/|package(?:-lock)?\.json|playwright\.config\.js|scripts\/performance\/|tests\/.*performance|\.github\/workflows\/frontend-performance\.yml)/),
    syntax:files.filter(file=>/\.(?:c?js|mjs)$/.test(file)&&exists(file))};
}
function changedFiles(base,{cwd=process.cwd()}={}){
  // NUL delimiters preserve whitespace/newlines; no rename folding retains both
  // the old owner and new path. No status filter: deletions and type changes count.
  return execFileSync('git',['diff','--name-only','--no-renames','-z',base,'HEAD'],{cwd,encoding:'utf8'}).split('\0').filter(Boolean);
}
function run(command,args){
  const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
function qualifiedReviewBase({base,previous,passed=false,isAncestor}){
  return /^[a-f0-9]{40}$/.test(previous||'')&&passed&&isAncestor(base,previous)&&isAncestor(previous,'HEAD')?previous:base;
}
function reviewBase(base){
  const previous=process.env.PRODUCT_PREVIOUS_SHA,repo=process.env.GITHUB_REPOSITORY;
  if(!/^[a-f0-9]{40}$/.test(previous||'')||!repo||!process.env.GH_TOKEN)return base;
  try{
    // Only inherit a successful exact-head run of this workflow, never a failed
    // predecessor or rewritten history. Ready-for-review still checks the full PR.
    const result=JSON.parse(execFileSync('gh',['api',`repos/${repo}/actions/workflows/product-review.yml/runs?head_sha=${previous}&status=success&per_page=1`],{encoding:'utf8',timeout:15000}));
    const passed=result.workflow_runs?.some(run=>run.head_sha===previous&&run.conclusion==='success');
    return qualifiedReviewBase({base,previous,passed,isAncestor:(a,b)=>spawnSync('git',['merge-base','--is-ancestor',a,b]).status===0});
  }catch{return base;}
}
if(require.main===module){
  const requestedBase=process.env.PRODUCT_BASE_SHA;
  if(!/^[a-f0-9]{40}$/.test(requestedBase||''))throw new Error('PRODUCT_BASE_SHA must be an exact base commit');
  const base=reviewBase(requestedBase);console.log(`Qualified comparison base: ${base}`);
  const files=changedFiles(base);
  const plan=select(files);console.log(JSON.stringify(plan,null,2));
  if(plan.errors.length)throw new Error(plan.errors.join('\n'));
  if(process.argv.includes('--plan')){
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`browser=${plan.browser.length>0}\nperformance=${plan.performance}\nfunctions=${plan.functions}\nrules=${plan.rules}\nlegacyReset=${plan.legacyReset}\n`);
  }else if(process.argv.includes('--browser')){
    if(plan.browser.length)run(process.execPath,['node_modules/@playwright/test/cli.js','test',...plan.browser,'--project=desktop','--workers=1']);
  }else{
    run('git',['diff','--check',base,'HEAD']);
    for(const file of plan.syntax)run(process.execPath,['--check',file]);
    run(process.execPath,['--test',...plan.node]);
    for(const [command,args]of plan.commands)run(command,args);
  }
}
module.exports={select,qualifiedReviewBase,changedFiles};
