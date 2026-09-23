const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const html=readFileSync(join(__dirname,'../index.html'),'utf8');

test('visual pass preserves exact accepted legal/privacy words, links and dates',()=>{
  // Frozen from approved .121 source; attributes and whitespace are presentation.
  const cases=[
    [/<article[^>]+id="privacy-pg"[\s\S]*?<\/article>/,'daa799e21175dc6af71245c91cdc097e50bf07bff423c563ac120ab449972006'],
    [/<dialog class="legal-dialog"[\s\S]*?<\/dialog>/,'6366336edd62f61a1181cc2b907c22d91016fa491dbfdb9b07b20932667040c0']
  ];
  for(const [pattern,expected]of cases){
    const source=html.match(pattern)[0],text=source.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const links=[...source.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
    assert.equal(createHash('sha256').update(JSON.stringify({text,links})).digest('hex'),expected);
  }
});
