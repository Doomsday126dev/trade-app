#!/usr/bin/env python3
"""Bounded, dependency-free build-time source enrichment. No browser HTML scraping.
Writes a review candidate; --write embeds it in the versioned runtime. The daily
read-only workflow checks sources and uploads a candidate, never auto-publishes.
"""
import argparse, datetime, hashlib, html, json, pathlib, re, urllib.request
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parents[2]
FEED='https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json'
OFFICIAL={
 'season-24-twilight-trails':'https://pokemongo.com/seasons/twilight-trails',
 'halloween-2026-part-1':'https://pokemongo.com/news/halloween-part-1-2026',
 'go-pass-october-2026':'https://pokemongo.com/news/go-pass-october-2026',
 'chandelure-super-mega-raid-day-2026':'https://pokemongo.com/news/chandelure-super-mega-raid-day-2026',
}
class Node:
 def __init__(self,tag='',attrs=()): self.tag=tag;self.attrs=dict(attrs);self.children=[]
 def text(self): return re.sub(r'\s+',' ',''.join(c.text() if isinstance(c,Node) else c for c in self.children)).strip()
class DOM(HTMLParser):
 def __init__(self): super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root]
 def handle_starttag(self,t,a):
  n=Node(t,a);self.stack[-1].children.append(n)
  if t not in ['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']:self.stack.append(n)
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==t:self.stack=self.stack[:i];break
 def handle_data(self,s):self.stack[-1].children.append(s)
def walk(n):
 if n.tag in ['script','style','nav','footer']:return
 yield n
 for c in n.children:
  if isinstance(c,Node):yield from walk(c)
def parse_bonuses(source):
 """Only explicit bonus sections. Preserve rank headings, introductory conditions,
 starred caveats, and time windows. Never infer bonuses from source flags."""
 p=DOM();p.feed(source);active=False;context='';scope='';rows=[];caveats=[];level=2
 for n in walk(p.root):
  s=n.text()
  if not s:continue
  if n.tag in ['h2','h3','h4'] or (n.tag=='div' and 'heading' in n.attrs.get('class','') and len(s)<80):
   if re.fullmatch(r'(?:Event |Major Milestone |Ticket Holder |GO Pass Major Milestone )?Bonuses',s,re.I):active=True;level=int(n.tag[1]) if n.tag.startswith('h') else 2;context='';scope='Ticket holders only' if 'Ticket Holder' in s else 'GO Pass milestones' if 'GO Pass' in s else '';continue
   if active and (n.tag=='div' or int(n.tag[1])<=level):active=False
   elif active:context=s
  if not active:continue
  if n.tag=='p' or (n.tag=='div' and 'size:body' in n.attrs.get('class','') and not any(isinstance(c,Node) and c.tag in ['p','ul','div'] for c in n.children)):
   if re.match(r'(?:Tier\s*\d|Rank\s*\d)',s,re.I):context=s
   else:
    caveats.append(s)
    if re.search(r'Upgrade.*Deluxe|Deluxe.*following|ticketed event day|ticket holders',s,re.I):scope=s
  if n.tag=='li' or 'bonus-text' in n.attrs.get('class','').split():
   if len(s)<=1200:rows.append((' · '.join(x for x in [scope,context] if x)+' — ' if scope or context else '')+s)
 # Missing starred disclaimer or context is a parser failure, not a complete record.
 return {'bonuses':list(dict.fromkeys(rows)),'caveats':list(dict.fromkeys(caveats))}
def download(url):
 if not re.match(r'^https://(?:pokemongo\.com/(?:(?:en/)?news/|seasons/)|leekduck\.com/events/|raw\.githubusercontent\.com/bigfoott/ScrapedDuck/data/events\.min\.json$)',url):raise ValueError('Unapproved source URL')
 cache=pathlib.Path('/tmp/trade-event-source-pages');cache.mkdir(exist_ok=True);cached=cache/(hashlib.sha256(url.encode()).hexdigest()+'.html')
 if cached.exists() and datetime.datetime.now().timestamp()-cached.stat().st_mtime<300:return cached.read_text()
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'TradeList-event-source-check/1.0'}),timeout=15) as r:
  if r.status!=200:raise ValueError('Source HTTP '+str(r.status))
  raw=r.read(2_000_001)
  if len(raw)>2_000_000:raise ValueError('Source too large')
  value=raw.decode('utf-8');cached.write_text(value);return value
def resolve(event,fetch=download,now=None,previous=None):
 now=now or datetime.datetime.now(datetime.timezone.utc).isoformat();failures=[]
 rules=json.loads((ROOT/'data/event-detail-rules.json').read_text());rule=rules.get(event['eventID']);normalize=lambda x:re.sub(r'\s+',' ',x).strip()
 urls=[rule.get('source') if rule else OFFICIAL.get(event['eventID']),event.get('link')]
 for url in dict.fromkeys(x for x in urls if x):
  try:
   source=fetch(url)
   if rule and url==rule['source']:
    dom=DOM();dom.feed(source);body=normalize(dom.root.text())
    if not all(normalize(proof) in body for proof in rule['evidence']):raise ValueError('Reviewed evidence changed')
    facts={'bonuses':rule['bonuses'],'caveats':rule['caveats']}
   else:facts=parse_bonuses(source)
   if facts['bonuses']:
    return {**facts,'source':url,'checkedAt':now,'contentHash':hashlib.sha256(source.encode()).hexdigest(),'status':'verified','field':'bonuses','failures':failures}
   failures.append({'source':url,'kind':'no-bonus-section'})
  except Exception as error:failures.append({'source':url,'kind':'unavailable'})
 if previous and previous.get('bonuses'):return {**previous,'status':'last-known','failures':failures}
 return {'bonuses':[],'caveats':[],'status':'not-supplied','failures':failures}
def main():
 a=argparse.ArgumentParser();a.add_argument('--write',action='store_true');a.add_argument('--feed');a.add_argument('--output',default='event-details-candidate.json');args=a.parse_args()
 now=datetime.datetime.now(datetime.timezone.utc);events=json.loads(pathlib.Path(args.feed).read_text() if args.feed else download(FEED));file=ROOT/'data/event-details.json';previous=json.loads(file.read_text()) if file.exists() else {'events':{}};records={}
 for event in events:
  try:end=datetime.datetime.fromisoformat(event['end'].replace('Z','+00:00')).replace(tzinfo=datetime.timezone.utc);start=datetime.datetime.fromisoformat(event['start'].replace('Z','+00:00')).replace(tzinfo=datetime.timezone.utc)
  except (ValueError,KeyError):continue
  if end<now or start>now+datetime.timedelta(days=32):continue
  records[event['eventID']]=resolve(event,now=now.isoformat(),previous=previous['events'].get(event['eventID']))
 result={'schemaVersion':1,'generatedAt':now.isoformat(),'feed':events,'events':records};pathlib.Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 if args.write:
  file.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');domain=ROOT/'js/domain/eventPresentation.js';s=domain.read_text();block='  // BEGIN REVIEWED EVENT DETAILS\n  const reviewedEventDetails='+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';\n  // END REVIEWED EVENT DETAILS'
  if '// BEGIN REVIEWED EVENT DETAILS' in s:s=re.sub(r'  // BEGIN REVIEWED EVENT DETAILS.*?  // END REVIEWED EVENT DETAILS',lambda _:block,s,flags=re.S)
  else:s=s.replace('  function eventFacts(event){',block+'\n  function eventFacts(event){')
  domain.write_text(s)
 print(json.dumps({'events':len(records),'withBonuses':sum(bool(x['bonuses']) for x in records.values()),'output':args.output}))
if __name__=='__main__':main()
