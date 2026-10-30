'use strict';
// Read-only validation of the local reviewed admission artifact. Never promotes
// source claims, performs network reads, changes rollout or modifies Rules.
const COSTUME_CHAINS=new Map([
 ['charmander-goggles-2026|charmeleon-goggles-2026','https://pokemongo.com/en/news/pokemon-horizons-celebration-event-2026'],
 ['pikachu-summer-2018|raichu-summer-2018','https://www.reddit.com/r/TheSilphRoad/comments/8wlq5l/raichu_keeps_the_summer_hat_and_sunglasses_as/']
]);
function validate(row,parent,child,parentMap){
 const fail=reason=>{throw Error('evolution-review: '+reason)};
 if(!row||!parent||!child)fail('missing-proof');
 const [from,to]=row.reviewed_evolution_chain||[],observation=row.captured_event_dates?.[0];
 if(!parentMap[to]?.includes(from)||parent.source_variant_id!==from||child.source_variant_id!==to)fail('unreviewed-chain');
 if(parent.background_id!==row.background_id||child.background_id!==row.background_id||observation?.background_id!==row.background_id)fail('background-drift');
 if(observation.derivation_claim!=='evolution'||observation.date_state_internal!=='past_or_current_claim'||!parent.source_event_ids.includes(observation.event_id)||!child.source_event_ids.includes(observation.event_id))fail('event-proof');
 const lane=row.shiny?'shiny':'normal';
 if(parent[lane].status!=='qualified_local')fail('unqualified-progenitor-lane');
 if(row.qualified_same_background_progenitor?.[0]!==row.background_id||row.qualified_same_background_progenitor?.[1]!==parent.catalog_id||row.qualified_same_background_progenitor?.[2]!==row.shiny||child.catalog_id!==row.catalog_id)fail('identity-or-shiny-drift');
 if(parent.costume!==child.costume)fail('costume-drift');
 if(parent.costume&&!COSTUME_CHAINS.has(from+'|'+to))fail('unreviewed-costume');
 for(const suffix of ['-dynamax','-alola','-galarian'])if(from.endsWith(suffix)!==to.endsWith(suffix))fail('form-drift');
 const color=s=>s.match(/-(red|blue|yellow|orange|white)$/)?.[1];
 if((from.startsWith('flabebe-')||from.startsWith('floette-'))&&color(from)!==color(to))fail('flower-drift');
 if(/necrozma-(dawn|dusk)|kyurem-(black|white)|zacian-crowned|zamazenta-crowned/.test(to))fail('not-an-evolution');
 if(row.intrinsic_form_constraints)fail('unexpected-inherited-constraint');
 return true;
}
module.exports={validate,COSTUME_CHAINS};
if(require.main===module){
 try{
  const fs=require('node:fs'),file=process.argv[2];if(!file)throw Error('usage: review-evolution-joins.cjs REVIEW_ARTIFACT');
  const r=JSON.parse(fs.readFileSync(file)),facts=new Map(r.input_pair_facts.map(p=>[p.background_id+'|'+p.source_variant_id,p]));
  for(const row of r.admitted)validate(row,...row.reviewed_evolution_chain.map(s=>facts.get(row.background_id+'|'+s)),r.explicit_parent_map);
  console.log(JSON.stringify({validated:r.admitted.length,productionChanges:false}));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
