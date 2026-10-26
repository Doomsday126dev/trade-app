'use strict';
const fs=require('node:fs'),path=require('node:path');
const forms={
 'Bulbasaur (Shedinja)':[1,'001-halloween2019','halloween'],
 'Bulbasaur (Red Party)':[1,'001-partyhat','party'],
 'Bulbasaur (Visor)':[1,'001-pikachuvisor','visor'],
 'Charmander (Cubone)':[4,'004-halloween2019','halloween'],
 'Charmander (Red Party)':[4,'004-partyhat','party'],
 'Charmander (Visor)':[4,'004-pikachuvisor','visor'],
 'Squirtle (Yamask)':[7,'007-halloween2019','halloween'],
 'Squirtle (Red Party)':[7,'007-partyhat','party'],
 'Squirtle (Visor)':[7,'007-pikachuvisor','visor'],
 'Squirtle (Sunglasses)':[7,'007-sunglasses','sunglasses']
};
const evidence={halloween:'https://pokemongo.com/news/halloween2019',party:'https://pokemongo.com/news/pokemonday2020?hl=en',visor:'https://www.serebii.net/pokemongo/ticketevents/pokemongofest2020.shtml',sunglasses:'https://pokemongo.com/news/community-day-classic-squirtle-makeup-2023'};
function validateStarterShinyReview(entry,root){
 const r=entry.starterShinyArtworkReview;
 if(!r){if(Object.values(entry.assets||{}).some(a=>a.includes('serebii-starter-')))throw Error('Starter Shiny review missing: '+entry.names[0]);return;}
 const form=forms[entry.names[0]],fail=()=>{throw Error('Starter Shiny review mismatch: '+entry.names[0]);};
 if(!form||r.name!==entry.names[0]||r.no!==entry.no||entry.no!==form[0]||r.stem!==form[1]||r.shinyAvailability!=='released'||entry.shinyAvailability!=='released'||r.releaseEvidence!==evidence[form[2]]||r.genderModel!=='shared-no-visual-dimorphism')fail();
 if(r.sourcePage!=='https://www.serebii.net/pokemongo/shiny.shtml'||r.sourceUrl!=='https://www.serebii.net/pokemongo/pokemon/shiny/'+r.stem+'.png'||r.normalReference?.url!=='https://www.serebii.net/pokemongo/pokemon/'+r.stem+'.png')fail();
 if(r.asset!=='assets/sprites/go/serebii-starter-'+r.stem+'-shiny.png'||r.asset===entry.assets.default||r.retainedNormal?.asset!==entry.assets.default||r.retainedNormal?.sha256!==entry.sha256.default)fail();
 for(const key of ['shiny','femaleShiny'])if(entry.assets[key]!==r.asset||entry.sha256[key]!==r.sha256)fail();
 if(root){const proof=JSON.parse(fs.readFileSync(path.join(root,'data/starter-costume-shiny-assets.json'))).records.find(p=>p.name===r.name);if(JSON.stringify(proof)!==JSON.stringify(r))fail();}
}
module.exports={validateStarterShinyReview};
