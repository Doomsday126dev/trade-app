const {execFileSync,spawnSync}=require('node:child_process');
const {existsSync,appendFileSync}=require('node:fs');

const PRODUCT=['tests/trade-list-comparison.test.cjs','tests/account-sync-product.test.cjs','tests/i18n.test.cjs','tests/public-share-localization.test.cjs','tests/pokemon-go-search-syntax.test.cjs'];
const SYNC=['tests/account-sync-domain.test.cjs','tests/account-sync-eligibility.test.cjs','tests/account-sync-product.test.cjs','tests/account-sync-repository.test.cjs','tests/account-sync-runtime.test.cjs','tests/account-sync-recovery.test.cjs','tests/my-list-sync-safety.test.cjs'];
const PRIVACY=['tests/public-share-publication.test.cjs','tests/provider-privacy.test.cjs','tests/share-visibility-client.test.cjs'];
function select(files){
  const node=new Set(['tests/product-check-selection.test.cjs']),browser=new Set(),commands=[];
  const any=pattern=>files.some(file=>pattern.test(file));
  const add=tests=>tests.forEach(file=>node.add(file));
  const product=any(/^(?:index\.html|css\/|js\/)/);
  if(product){add(PRODUCT);browser.add('tests/trusted-readiness.spec.js');browser.add('tests/anonymous-public-share.spec.js');}
  if(any(/^js\/(?:data\/accountSync|domain\/accountSync|app\/application\.js)/)){add(SYNC);browser.add('tests/normal-sync-product.spec.js');}
  if(any(/^(?:js\/domain\/(?:pokemonKeys|publicPokemonDex)\.js|scripts\/generate-public-sprite-dex\.cjs)$/))add(['tests/pokemon-catalog.test.cjs','tests/sprite-resolution.test.cjs']);
  if(any(/^js\/(?:app\/|domain\/publicShare|services\/providerPublic|data\/(?:publicShare|trainerShare))/)){add(PRIVACY);browser.add('tests/anonymous-public-share.spec.js');}
  if(any(/^(?:sw\.js|index\.html|js\/domain\/clientRelease|release\/|scripts\/pages\/)/))add(['tests/client-asset-versioning.test.cjs','tests/frontend-asset-extraction.test.cjs','tests/service-worker-release.test.cjs']);
  const publicContract=file=>['functions/e1-authority-service/providerPublicProjection.js','functions/e1-gateway/gatewayCore.js','functions/test/e1-provider-public-share-gateway.test.cjs','js/domain/providerPublicProjection.js','tests/firebase/database.rules.provider-public-projection.json'].includes(file);
  if(files.some(publicContract)){
    add(['tests/provider-public-projection.test.cjs','tests/provider-public-application-integration.test.cjs']);
    commands.push([process.execPath,['--test','functions/test/e1-provider-public-share.test.cjs','functions/test/e1-provider-public-share-gateway.test.cjs']]);
  }
  if(files.some(file=>!publicContract(file)&&/^(?:functions\/|js\/(?:services\/(?:googleAuth|provider)|domain\/provider))/.test(file))){
    add(['tests/provider-linking-foundation.test.cjs','tests/provider-account-foundation.test.cjs','tests/provider-privacy.test.cjs']);
    // An unfamiliar backend change does not silently receive UI-only coverage.
    commands.push(['npm',['--prefix','functions','run','check:contract']]);
  }
  if(any(/firestore.*rules/))commands.push(['npm',['run','check:e1-firestore-authority']]);
  if(files.includes('tests/firebase/database.rules.provider-public-projection.json'))commands.push(['bash',['scripts/check-provider-public-projection-rules.sh']]);
  if(files.some(file=>!publicContract(file)&&/database.*rules|SECURITY-RULES|build-sec02-production-rules/.test(file)))commands.push(['npm',['run','check:sec02-production-rules']]);
  if(any(/^\.github\/workflows\/frontend-performance\.yml$/))add(['tests/performance-observability.test.cjs']);
  for(const file of files){
    if(/^tests\/[\w/-]+\.test\.cjs$/.test(file)&&existsSync(file)&&!file.includes('operator')&&!file.startsWith('tests/firebase/'))node.add(file);
    if(/^tests\/[\w/-]+\.spec\.js$/.test(file)&&existsSync(file)&&!/(performance|provider)/i.test(file))browser.add(file);
  }
  return{node:[...node].sort(),browser:[...browser].sort(),commands,functions:commands.some(([command,args])=>args.some(arg=>arg.startsWith('functions'))),rules:commands.some(([command,args])=>args.some(arg=>/rules|firestore-authority/.test(arg))),sensitive:any(/accountSync|functions\/|rules|provider/i),
    performance:any(/^(?:index\.html|css\/|js\/|sw\.js|data\.js|data\/|package(?:-lock)?\.json|playwright\.config\.js|scripts\/performance\/|tests\/.*performance|\.github\/workflows\/frontend-performance\.yml)/),
    syntax:files.filter(file=>/\.(?:c?js|mjs)$/.test(file)&&existsSync(file))};
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
  const files=execFileSync('git',['diff','--name-only','--diff-filter=ACMR',base,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const plan=select(files);console.log(JSON.stringify(plan,null,2));
  if(process.argv.includes('--plan')){
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`browser=${plan.browser.length>0}\nperformance=${plan.performance}\nfunctions=${plan.functions}\nrules=${plan.rules}\n`);
  }else if(process.argv.includes('--browser')){
    if(plan.browser.length)run(process.execPath,['node_modules/@playwright/test/cli.js','test',...plan.browser,'--project=desktop','--workers=1']);
  }else{
    run('git',['diff','--check',base,'HEAD']);
    for(const file of plan.syntax)run(process.execPath,['--check',file]);
    run(process.execPath,['--test',...plan.node]);
    for(const [command,args]of plan.commands)run(command,args);
  }
}
module.exports={select,qualifiedReviewBase};
