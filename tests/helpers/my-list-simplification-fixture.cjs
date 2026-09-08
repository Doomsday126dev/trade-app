const {expect}=require('@playwright/test');
const {installPriorityReviewFixture,settlePriorityReview}=require('./my-list-priority-fixture.cjs');

async function installSimplificationFixture(page){
  await installPriorityReviewFixture(page);
  const evidence=await page.evaluate(()=>{
    const high=[];
    const add=(type,name)=>{const entry=DB[type].find(entry=>entry.name===name);if(!entry)throw new Error(`Missing fixture catalog entry: ${name}`);if(!high.some(row=>row.type===type&&row.name===name))high.push({type,name,no:entry.no});};
    for(const name of ['Arrokuda','Flittle','Shedinja','P-Tauros (Aqua)','P-Tauros (Blaze)','Rotom (Frost)','Rotom (Fan)','Rotom (Heat)','Rotom (Mow)','Rotom (Wash)','H-Braviary'])add('wishlist',name);
    for(const name of ['Unown (Z)','Unown (F)','Unown (M)'])add('costumes',name);
    for(const entry of DB.costumes.filter(entry=>/Vivillon \((Garden|Jungle|Monsoon|Marine|Ocean)\)|Furfrou|Wormadam|Oricorio/.test(entry.displayName||entry.name)))add('costumes',entry.name);
    add('costumes','Pikachu (Worlds 2025)');
    for(const entry of DB.costumes.filter(entry=>entry.name.startsWith('Unown ('))){if(high.length>=48)break;add('costumes',entry.name);}
    if(high.length!==48)throw new Error(`Expected 48 High wants, got ${high.length}`);
    const lists={wishlist:{Pikachu:'M',Eevee:'M(F)',Snom:'M',Dragonite:'M',Sinistea:'M(Antique)',Snorlax:'L',Lapras:'L',Bulbasaur:'[lucky]',Gengar:'[shiny]',Charmander:'[xxl]',Squirtle:'[xxs]',Wailmer:'[lucky][xxl]'},costumes:{},dynamax:{},gmax:{}};
    for(const {type,name}of high)lists[type][name]='H';
    allData=normalizeData({users:{Avery:{authUid:'synthetic-priority-review-avery',specialTradeBoard:{lf:[{name:'Pikachu',no:25,lucky:true,note:'Lucky dex'}],ft:[]}}},...Object.fromEntries(Object.entries(lists).map(([type,entries])=>[type,{Avery:entries}]))});
    document.getElementById('combined-filter').value='';
    document.getElementById('wants-find').hidden=true;document.getElementById('wants-combine').open=false;
    closeWantsListTools();combinedSelection.clear();wantsSelectionMode=false;wantsCustomScopes.clear();wantsCollapsedSections.clear();wantsSectionLimits.clear();
    renderMyList();window.__simplificationBefore=JSON.stringify(allData);
    return{high,entries:productDeclarations().entries.length,unresolved:productDeclarations().entries.filter(entry=>!entry.no).map(entry=>entry.name)};
  });
  expect(evidence.high).toHaveLength(48);expect(evidence.unresolved).toEqual([]);
  await expect(page.locator('#combined-list [data-wants-section="H"] .wants-row')).toHaveCount(48);
  return evidence;
}
module.exports={installSimplificationFixture,settlePriorityReview};
