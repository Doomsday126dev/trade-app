// Materialize an isolated sample from reviewed repository assets. No user data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const target = path.join(__dirname, 'vendor');
fs.mkdirSync(target, { recursive: true });
const catalog = require(path.join(root, 'data/costume-sprite-catalog.json'));
const rows = catalog.entries.filter(e => e.status === 'exact').map((e, i) => {
  const file = path.basename(e.assets.default);
  fs.copyFileSync(path.join(root, e.assets.default), path.join(target, file));
  return { id: `costume-${i}`, no: e.no, name: e.names[0], art: `vendor/${file}`, costume: !/Unown|Furfrou|Pumpkaboo/.test(e.names[0]), form: e.sourceLabel || e.names[0], source: e.sourcePage };
});
const base = [[1,'Bulbasaur'],[4,'Charmander'],[7,'Squirtle'],[25,'Pikachu'],[39,'Jigglypuff'],[54,'Psyduck'],[94,'Gengar'],[129,'Magikarp'],[131,'Lapras'],[133,'Eevee'],[143,'Snorlax'],[150,'Mewtwo'],[175,'Togepi'],[201,'Unown'],[280,'Ralts'],[302,'Sableye'],[384,'Rayquaza'],[479,'Rotom'],[757,'Salandit'],[872,'Snom']];
async function main() {
  for (const [no,name] of base) {
    for (const shiny of [false,true]) {
      const file = `home-${no}${shiny ? '-shiny' : ''}.png`;
      const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny ? 'shiny/' : ''}${no}.png`;
      const dest = path.join(target,file);
      if (!fs.existsSync(dest)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Asset fetch failed ${no}: ${response.status}`);
        fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
      }
      rows.push({ id:`base-${no}${shiny ? '-shiny' : ''}`, no, name, shiny, art:`vendor/${file}`, source:url });
    }
  }
  rows.push({id:'worlds-2026',no:25,name:'Pikachu (Worlds 2026)',costume:true,form:'Worlds 2026',art:null,source:'Repository pending-artwork catalog'});
  fs.writeFileSync(path.join(__dirname,'catalog.json'),JSON.stringify(rows,null,2)+'\n');
  fs.copyFileSync(path.join(root,'js/domain/pokemonGoSearchSyntax.js'),path.join(target,'pokemonGoSearchSyntax.js'));
  fs.copyFileSync(path.join(root,'docs/third-party/POKEAPI-LICENSE.md'),path.join(target,'POKEAPI-LICENSE.md'));
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const symbols = html.slice(html.indexOf('<defs>'),html.indexOf('</defs>')+7);
  fs.writeFileSync(path.join(target,'icons.svg'),`<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>\n`);
  const manifest=fs.readdirSync(target).sort().map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(target,file))).digest('hex')}));
  fs.writeFileSync(path.join(__dirname,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Prepared ${rows.length} catalog identities; local assets and source provenance retained.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
