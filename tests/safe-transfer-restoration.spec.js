const {test,expect}=require('@playwright/test');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const application=readFileSync(path.join(root,'js/app/application.js'),'utf8');
const copyStart=application.indexOf('async function copyText(str)');
const copyEnd=application.indexOf('async function copyStr(',copyStart);
if(copyStart<0||copyEnd<0)throw new Error('Shared copyText helper not found');
const sharedCopySource=application.slice(copyStart,copyEnd);

async function mountCandidate(page,clipboardMode){
  await page.setContent('<main><div id="candidate"></div></main>');
  await page.addScriptTag({path:path.join(root,'js/domain/pokemonGoSearchSyntax.js')});
  await page.addScriptTag({path:path.join(root,'js/domain/safeTransferRestoration.js')});
  await page.addScriptTag({path:path.join(root,'js/ui/safeTransferCandidate.js')});
  await page.addScriptTag({content:sharedCopySource});
  await page.evaluate(mode=>{
    Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
    window.__directWrites=[];window.__fallbackWrites=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
      if(mode!=='direct')throw new Error('direct denied');window.__directWrites.push(value);
    }}});
    document.execCommand=command=>{
      if(command!=='copy'||mode==='fail')return false;
      window.__fallbackWrites.push(document.activeElement?.value||'');return true;
    };
    const safe=window.PogoDomain.safeTransferRestoration,syntax=window.PogoDomain.pokemonGoSearchSyntax;
    const catalog=safe.createCatalog([{no:1,name:'Bulbasaur'},{no:4,name:'Charmander'},{no:25,name:'Pikachu'},{no:133,name:'Eevee'}]);
    const snapshot={
      contractVersion:1,account:{id:'owner-uid',version:'session-4'},
      scope:{id:'favorites',version:'members-9',displayedSelectionVersion:'members-9',kind:'group',selected:[{id:'a',label:'Ada'},{id:'b',label:'Bert'}]},
      universe:{version:'reviewed-1',policy:'fixture',species:[1,4,25,133],excludedSpecies:[]},
      sources:[
        {trainerId:'a',state:'complete',complete:true,freshness:'current',snapshotVersion:'v2',sourceVersion:'a-3',pagination:{complete:true,nextCursor:null},declarations:[{intent:'lf',category:'wishlist',name:'Pikachu'}]},
        {trainerId:'b',state:'complete',complete:true,freshness:'current',snapshotVersion:'v2',sourceVersion:'b-7',pagination:{complete:true,nextCursor:null},declarations:[{intent:'lf',category:'wishlist',name:'Eevee'}]}
      ]
    };
    const makePlan=value=>safe.commandPlan(safe.evaluate(value,{catalog}),{syntax,locale:'de',characterBudget:1500});
    const expected=makePlan(snapshot);window.__candidateExpected=expected.commands[0].value;window.__liveBinding=JSON.parse(JSON.stringify(expected.binding));
    window.__candidateController=safe.createController({loadSnapshot:async()=>snapshot,plan:makePlan,currentBinding:()=>window.__liveBinding,copy:value=>copyText(value)});
    window.PogoUi.safeTransferCandidate.mountSafeTransferCandidate(document.getElementById('candidate'),{controller:window.__candidateController});
    return window.__candidateController.start({binding:window.__liveBinding,selection:snapshot.scope.selected,gameLocale:'de'});
  },clipboardMode);
}

test('synthetic scoped UI shows the exact computed scope and reports direct clipboard success only after write',async({page})=>{
  await mountCandidate(page,'direct');
  await expect(page.locator('[data-safe-transfer-scope]')).toHaveText('Selected scope: Ada, Bert');
  await expect(page.locator('[data-safe-transfer-status]')).toHaveText('2 candidate species after protecting 2 wanted species.');
  const command=await page.locator('[data-safe-transfer-command="0"]').inputValue();
  expect(command).toBe('!Favorit&!4*&!Schillernd&!Crypto&!Erlöst&!hintergrund&!getauscht&!Legendär&!Mysteriös&WP-2500&1,4');
  await page.locator('[data-safe-transfer-copy="0"]').click();
  await expect(page.locator('#candidate')).toHaveAttribute('data-phase','copied');
  expect(await page.evaluate(()=>window.__directWrites)).toEqual([command]);
  expect(await page.evaluate(()=>window.__fallbackWrites)).toEqual([]);
});

test('synthetic UI uses the shared fallback and both-method failure preserves manual recovery without a false success',async({page})=>{
  await mountCandidate(page,'fallback');
  const command=await page.locator('[data-safe-transfer-command="0"]').inputValue();
  await page.locator('[data-safe-transfer-copy="0"]').click();
  await expect(page.locator('#candidate')).toHaveAttribute('data-phase','copied');
  expect(await page.evaluate(()=>window.__fallbackWrites)).toEqual([command]);

  await mountCandidate(page,'fail');
  const failedCommand=await page.locator('[data-safe-transfer-command="0"]').inputValue();
  await page.locator('[data-safe-transfer-copy="0"]').click();
  await expect(page.locator('#candidate')).toHaveAttribute('data-phase','copy_failed');
  await expect(page.locator('[data-safe-transfer-status]')).toHaveText('Copy failed. The current command is preserved below for manual copy.');
  expect(await page.locator('[data-safe-transfer-command="0"]').inputValue()).toBe(failedCommand);
  expect(await page.evaluate(()=>window.__candidateController.snapshot().manualCommand)).toBe(failedCommand);
  expect(await page.evaluate(()=>window.__candidateController.snapshot().phase)).not.toBe('copied');
});

test('synthetic visible copy control and direct handler both refuse a changed source binding',async({page})=>{
  await mountCandidate(page,'direct');
  await page.evaluate(()=>{window.__liveBinding.sourceVersions.a='a-4';});
  const result=await page.evaluate(()=>window.__candidateController.copyPart(0));
  expect(result.status).toBe('stale');
  await expect(page.locator('#candidate')).toHaveAttribute('data-phase','invalidated');
  expect(await page.evaluate(()=>window.__directWrites)).toEqual([]);
});
