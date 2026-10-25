const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/domain/pokemonSearchTerms.js'),'utf8'),{window});const parse=window.PogoDomain.pokemonSearchTerms.parseImportTokens;
test('bounded import grammar never coerces exclusions, ranges, CP or partial unsupported input',()=>{
 for(const raw of ['!25','1-3','CP300','25&unknown','25&shiny,1-3','25||133','25&&shiny','25&male&female','25&xxl&xxs','26&alola&kanto','26&kanto&alola'])assert.equal(parse(raw).ok,false,raw);
 for(const raw of ['25','25,133','25&shiny','shiny&25','25&female&shiny','alola&26'])assert.equal(parse(raw).ok,true,raw);
 assert.equal(parse('25&shiny').tokens[0].dex,25);assert.equal(parse('25&shiny').tokens[0].filters[0],'shiny');
});
