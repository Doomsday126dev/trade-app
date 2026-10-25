const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../js/domain/eventPresentation.js'),'utf8'),{window,Date,Intl,URL});const d=window.PogoDomain.eventPresentation;
for(const locale of ['en','ja','es','de'])test(`multi-day hours do not repeat numeric dates (${locale})`,()=>{
 const t=d.eventTiming({start:'2026-12-31T10:00:00Z',end:'2027-01-02T18:00:00Z'},{locale,timeZone:'UTC'});
 assert.match(t.dateLabel,/2026/);assert.match(t.dateLabel,/2027/);assert.doesNotMatch(t.timeLabel,/2026|2027|12\/31|1\/2/);assert.ok(t.startTimeLabel);assert.ok(t.endTimeLabel);assert.notEqual(t.startTimeLabel,t.endTimeLabel);
 assert.equal(d.eventTiming({start:'2026-12-31',end:'2027-01-02'},{locale,timeZone:'UTC'}).timeLabel,'');
});
