'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const catalog=require('../data/costume-sprite-catalog.json');
const snapshot=require('../data/costume-sprite-upstream-snapshot.json');

// Independent supplier-caption correspondence, reviewed 2026-09-23. Pattern 9
// visibly carries the heart forehead marking; it is not an alias of Pattern 1.
const expected=[
  ['Spinda (Form 1)','spinda-01.png','Pattern #1'],
  ['Spinda (Form 2)','spinda-02.png','Pattern #2'],
  ['Spinda (Form 3)','spinda-03.png','Pattern #3'],
  ['Spinda (Form 4)','spinda-04.png','Pattern #4'],
  ['Spinda (Form 5)','spinda-05.png','Pattern #5'],
  ['Spinda (Form 6)','spinda-06.png','Pattern #6'],
  ['Spinda (Form 7)','spinda-07.png','Pattern #7'],
  ['Spinda (Form 8)','spinda-08.png','Pattern #8'],
  ['Spinda (Heart)','spinda-09.png','Pattern #9']
];

test('every existing Spinda pattern has its own verified supplier image',()=>{
  const page=snapshot.pages.find(row=>row.dex===327);
  assert.equal(page.url,'https://pokemondb.net/sprites/spinda');
  const hashes=new Set();
  for(const [name,file,label] of expected){
    const entry=catalog.entries.find(row=>row.names.includes(name));
    assert.equal(entry.no,327,name);
    assert.equal(entry.status,'exact',name);
    assert.equal(entry.sourceFile,file,name);
    assert.equal(entry.sourceLabel,label,name);
    assert.equal(entry.sourcePage,page.url,name);
    assert.equal(entry.sourceUrl,`https://img.pokemondb.net/sprites/go/normal/1x/${file}`);
    assert.deepEqual(page.files.find(row=>row.file===file),{file,label});
    assert.equal(entry.assets.default,`assets/sprites/go/${file}`);
    const bytes=fs.readFileSync(path.join(root,entry.assets.default));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const hash=crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash,entry.sha256.default,name);
    hashes.add(hash);
  }
  assert.equal(hashes.size,9,'distinct visible spot patterns must not share generic art');
});
