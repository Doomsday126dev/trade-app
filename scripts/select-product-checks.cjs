const {execFileSync,spawnSync}=require('node:child_process');
const {existsSync,appendFileSync}=require('node:fs');

const PRODUCT=['tests/trade-list-comparison.test.cjs','tests/account-sync-product.test.cjs','tests/i18n.test.cjs','tests/public-share-localization.test.cjs','tests/pokemon-go-search-syntax.test.cjs'];
const SYNC=['tests/account-sync-domain.test.cjs','tests/account-sync-product.test.cjs','tests/account-sync-repository.test.cjs','tests/account-sync-runtime.test.cjs','tests/my-list-sync-safety.test.cjs'];
const PRIVACY=['tests/public-share-publication.test.cjs','tests/provider-privacy.test.cjs','tests/share-visibility-client.test.cjs'];
function select(files){
  const node=new Set(['tests/product-check-selection.test.cjs']),browser=new Set(),commands=[];
  const any=pattern=>files.some(file=>pattern.test(file));
  const add=tests=>tests.forEach(file=>node.add(file));
  const product=any(/^(?:index\.html|css\/|js\/)/);
  if(product){add(PRODUCT);browser.add('tests/trusted-readiness.spec.js');browser.add('tests/anonymous-public-share.spec.js');}
  if(any(/^js\/(?:data\/accountSync|domain\/accountSync|app\/application\.js)/))add(SYNC);
  if(any(/^js\/(?:app\/|domain\/publicShare|services\/providerPublic|data\/(?:publicShare|trainerShare))/)){add(PRIVACY);browser.add('tests/anonymous-public-share.spec.js');}
  if(any(/^(?:sw\.js|index\.html|js\/domain\/clientRelease|release\/|scripts\/pages\/)/))add(['tests/client-asset-versioning.test.cjs','tests/frontend-asset-extraction.test.cjs','tests/service-worker-release.test.cjs']);
  if(any(/^(?:functions\/|js\/(?:services\/(?:googleAuth|provider)|domain\/provider))/)){
    add(['tests/provider-linking-foundation.test.cjs','tests/provider-account-foundation.test.cjs','tests/provider-privacy.test.cjs']);
    // An unfamiliar backend change does not silently receive UI-only coverage.
    commands.push(['npm',['--prefix','functions','run','check:contract']]);
  }
  if(any(/firestore.*rules/))commands.push(['npm',['run','check:e1-firestore-authority']]);
  if(any(/database.*rules|SECURITY-RULES|build-sec02-production-rules/))commands.push(['npm',['run','check:sec02-production-rules']]);
  if(any(/^\.github\/workflows\/frontend-performance\.yml$/))add(['tests/performance-observability.test.cjs']);
  for(const file of files){
    if(/^tests\/[\w/-]+\.test\.cjs$/.test(file)&&existsSync(file)&&!file.includes('operator'))node.add(file);
    if(/^tests\/[\w/-]+\.spec\.js$/.test(file)&&existsSync(file)&&!/(performance|provider)/i.test(file))browser.add(file);
  }
  return{node:[...node].sort(),browser:[...browser].sort(),commands,sensitive:any(/accountSync|functions\/|rules|provider/i),
    performance:any(/^(?:index\.html|css\/|js\/|sw\.js|data\.js|data\/|package(?:-lock)?\.json|playwright\.config\.js|scripts\/performance\/|tests\/.*performance|\.github\/workflows\/frontend-performance\.yml)/),
    syntax:files.filter(file=>/\.(?:c?js|mjs)$/.test(file)&&existsSync(file))};
}
function run(command,args){
  const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
if(require.main===module){
  const base=process.env.PRODUCT_BASE_SHA;
  if(!/^[a-f0-9]{40}$/.test(base||''))throw new Error('PRODUCT_BASE_SHA must be an exact base commit');
  const files=execFileSync('git',['diff','--name-only','--diff-filter=ACMR',base,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const plan=select(files);console.log(JSON.stringify(plan,null,2));
  if(process.argv.includes('--plan')){
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`browser=${plan.browser.length>0}\nperformance=${plan.performance}\n`);
  }else if(process.argv.includes('--browser')){
    if(plan.browser.length)run(process.execPath,['node_modules/@playwright/test/cli.js','test',...plan.browser,'--project=desktop','--workers=1']);
  }else{
    run('git',['diff','--check',base,'HEAD']);
    for(const file of plan.syntax)run(process.execPath,['--check',file]);
    run(process.execPath,['--test',...plan.node]);
    for(const [command,args]of plan.commands)run(command,args);
  }
}
module.exports={select};
