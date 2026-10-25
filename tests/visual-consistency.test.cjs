const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const html=readFileSync(join(__dirname,'../index.html'),'utf8');

test('legal and privacy surfaces preserve substantive safeguards and disclose actual analytics',()=>{
  const privacy=html.match(/<article[^>]+id="privacy-pg"[\s\S]*?<\/article>/)?.[0],legal=html.match(/<dialog class="legal-dialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(privacy);assert.ok(legal);
  for(const phrase of ['Google Firebase','GitHub Pages','GoatCounter','no page URL, query, fragment, referrer','no analytics cookies','collection contents or typed input'])assert.ok(privacy.includes(phrase),phrase);
  assert.match(privacy,/IP address and browser User-Agent/);
  for(const phrase of ['PokéAPI','Pokémon Database','their artwork is not served','not affiliated with, endorsed by, or sponsored by'])assert.ok(legal.includes(phrase),phrase);
  assert.doesNotMatch(legal,/<a\b|href=|https?:\/\//i);
  assert.match(legal,/<form method="dialog"/);
});
