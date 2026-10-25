const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {emulatorHtmlPolicy,emulatorHtml}=require('./support/favoriteBrowserFixtures.cjs');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const tokens=html=>new Set(/connect-src\s+([^";]+)/.exec(html)[1].trim().split(/\s+/));
test('emulator HTML retains production policy and adds only four exact local test endpoints',()=>{
 const before=tokens(source),after=tokens(emulatorHtmlPolicy(source));for(const value of before)assert.ok(after.has(value));assert.deepEqual([...after].filter(value=>!before.has(value)),['http://127.0.0.1:9500','ws://127.0.0.1:9500','http://127.0.0.1:9599','http://127.0.0.1:4198']);
 assert.equal((emulatorHtmlPolicy(source).match(/http-equiv="Content-Security-Policy"/g)||[]).length,1);
});
test('test-only endpoint insertion is idempotent and fails closed without an existing connect policy',()=>{
 assert.equal(emulatorHtmlPolicy(emulatorHtmlPolicy(source)),emulatorHtmlPolicy(source));assert.throws(()=>emulatorHtmlPolicy('<html></html>'),/policy is missing/);assert.throws(()=>emulatorHtmlPolicy('<meta http-equiv="Content-Security-Policy" content="default-src self">'),/policy is missing/);
});

test('emulator project rewrite is confined to Firebase config and preserves the intercepted resolver origin',()=>{
 const html=emulatorHtml(source),allowed=tokens(html);assert.ok(allowed.has('https://us-central1-trade-list-a4297.cloudfunctions.net'));assert.ok(!allowed.has('https://us-central1-demo-pogo-saving-incident.cloudfunctions.net'));assert.match(html,/projectId:'demo-pogo-saving-incident'/);assert.throws(()=>emulatorHtml(source.replace('window.__POGO_FIREBASE_CONFIG=','window.__OTHER_CONFIG=')),/config is missing/);
});
