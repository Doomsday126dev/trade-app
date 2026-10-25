#!/usr/bin/env python3
"""Refresh the permitted summary feed; preserve manually curated factual details.
Never fetch detail-page HTML. Source links are references for human verification,
not network targets. A daily candidate does not publish or reverify bonus facts.
"""
import argparse,datetime,hashlib,json,pathlib,re,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2]
FEED='https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json'
def download(url):
 if url!=FEED:raise ValueError('Only the permitted ScrapedDuck summary feed may be fetched')
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'TradeList-event-feed-check/1.0'}),timeout=15) as r:
  if r.status!=200:raise ValueError('Feed HTTP '+str(r.status))
  raw=r.read(2_000_001)
  if len(raw)>2_000_000:raise ValueError('Feed too large')
  return raw.decode('utf-8')
def build_record(events,curation,now):
 if not isinstance(events,list):raise ValueError('Feed must be an array')
 records={}
 for event in events:
  if not isinstance(event,dict) or not isinstance(event.get('eventID'),str):raise ValueError('Event identity missing')
  record=curation.get('events',{}).get(event['eventID'])
  if not record or not record.get('bonuses'):continue
  if not isinstance(record.get('source'),str) or not re.match(r'^https://(?:pokemongo\.com/|leekduck\.com/events/)',record['source']):raise ValueError('Curated source reference invalid')
  datetime.datetime.fromisoformat(record['checkedAt'].replace('Z','+00:00'))
  for field in ['bonuses','caveats']:
   if not isinstance(record.get(field),list) or not all(isinstance(x,str) and len(x)<=1500 for x in record[field]):raise ValueError('Curated fact text invalid')
  # Preserve provenance and verification timestamps byte-for-byte. Fetching the
  # summary feed says nothing about the freshness of separately curated facts.
  records[event['eventID']]={**record,'maintenanceMode':'curated'}
 return {'schemaVersion':2,'generatedAt':now,'feed':events,'events':records,'detailMaintenance':'curated; source references require human verification'}
def embed(result):
 p=ROOT/'js/domain/eventPresentation.js';s=p.read_text();block='  // BEGIN REVIEWED EVENT DETAILS\n  const reviewedEventDetails='+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';\n  // END REVIEWED EVENT DETAILS'
 if '// BEGIN REVIEWED EVENT DETAILS' not in s:raise ValueError('Runtime catalog marker missing')
 p.write_text(re.sub(r'  // BEGIN REVIEWED EVENT DETAILS.*?  // END REVIEWED EVENT DETAILS',lambda _:block,s,flags=re.S))
def main():
 a=argparse.ArgumentParser();a.add_argument('--write',action='store_true');a.add_argument('--feed');a.add_argument('--output',default='event-details-candidate.json');args=a.parse_args()
 events=json.loads(pathlib.Path(args.feed).read_text() if args.feed else download(FEED));curation=json.loads((ROOT/'data/event-details.json').read_text());now=datetime.datetime.now(datetime.timezone.utc).isoformat();result=build_record(events,curation,now);pathlib.Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 if args.write:
  (ROOT/'data/event-details.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');embed(result)
 print(json.dumps({'feedEvents':len(events),'curatedEvents':len(result['events']),'detailsReverified':False,'output':args.output}))
if __name__=='__main__':main()
