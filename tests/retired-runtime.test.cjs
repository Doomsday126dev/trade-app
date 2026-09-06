const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const acorn=require('acorn');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('retired inventory entrypoints and background modules are absent from runtime',()=>{
  const source=read('js/app/application.js');
  const functions=new Set(acorn.parse(source,{ecmaVersion:'latest'}).body.filter(node=>node.type==='FunctionDeclaration').map(node=>node.id.name));
  for(const name of ['cycleInventoryGender','setHaveView','setHaveSubTab','toggleHaveMatchOnly','buildHaveAcItems','haveAcSearch','haveAcSelect','haveAcKeydown','updateHaveAcFocus','setHaveAddMode','setHaveAddGender','addInventoryEntry','editInventoryNote','updateInventoryQty','setInventoryQty','toggleInventoryMirror','cycleInventoryMode','toggleHaveBulkMode','toggleHaveBulkSelection','updateHaveBulkCount','bulkHaveSetMode','bulkHaveAdjustQty','bulkHaveDelete','removeInventoryEntry','makeHaveBrowseContext','haveBrowseItemsForTrainer','sortHaveBrowseItems','haveBrowseTrainerSummary','queueRenderMyHave','queueRenderHaveBrowse']){
    assert.equal(functions.has(name),false,name);
  }
  for(const file of ['index.html','sw.js','scripts/pages/frontend-files.json','js/app/application.js']){
    assert.doesNotMatch(read(file),/backgroundCatalog|backgroundVisual|renderMyHave\(|renderHaveBrowse\(/,file);
  }
  for(const file of ['js/domain/backgroundCatalog.js','js/domain/backgroundVisual.js'])assert.equal(fs.existsSync(path.join(root,file)),false);
  assert.doesNotMatch(read('css/app.css'),/\.background-picker|\.background-trigger|--background-artwork/);
});
