const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const w={};for(const locale of ['en','ja','es','de'])vm.runInNewContext(fs.readFileSync('js/i18n/locales/'+locale+'.js','utf8'),{window:w});
test('all approved editor and priority-filter labels have explicit localized values with matching placeholders',()=>{
 const keys=Object.keys(w.PogoLocales.en).filter(k=>k.startsWith('wantEditor.')||['workflow.priorityFilter','workflow.priorityEmpty','workflow.selectedOtherPriorities'].includes(k));assert.ok(keys.length>=19);
 const placeholders=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
 for(const locale of ['ja','es','de'])for(const key of keys){const value=w.PogoLocales[locale][key];assert.equal(typeof value,'string',locale+':'+key);assert.ok(value.trim());assert.deepEqual(placeholders(value),placeholders(w.PogoLocales.en[key]),locale+':'+key);const source=fs.readFileSync('js/i18n/locales/'+locale+'.js','utf8');assert.ok(source.includes(JSON.stringify(key)+':')||source.includes("'"+key+"':"),locale+':'+key+' must be explicitly translated');}
 assert.equal(w.PogoLocales.ja['wantEditor.anyGender'],'指定なし');for(const locale of ['ja','es','de'])assert.ok(!/♀|♂/.test(w.PogoLocales[locale]['wantEditor.anyGender']));
});
