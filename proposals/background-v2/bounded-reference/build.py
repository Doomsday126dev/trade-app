import json
from pathlib import Path
here=Path(__file__).resolve().parent
for source,name in [(here.parent/'immutable-reference/database.rules.json','full.rules.json'),(here.parent/'release-review-20261030/current-public-only.rules.candidate.json','current.rules.json')]:
 x=json.loads(source.read_text());
 if name=='full.rules.json':x['rules']['accountSync']=json.loads((here/'current.rules.json').read_text())['rules']['accountSync'] if (here/'current.rules.json').exists() else json.loads((here.parent/'release-review-20261030/current-public-only.rules.candidate.json').read_text())['rules']['accountSync']
 st=x['rules']['backgroundStores']['$token'];root="root.child('backgroundStores').child($token)";owner=f"auth != null && auth.uid === {root}.child('ownerUid').val()"
 slots={'$other':{'.validate':False}}
 for slot in ['a','b','c']:
  slots[slot]={'.write':owner+" && newData.isString() && newData.val() === 'r' + newData.parent().parent().child('head').val() && newData.parent().parent().child('head').val() === ("+root+".child('head').exists() ? "+root+".child('head').val() + 1 : 1) && (!data.exists() || !newData.parent().parent().child('snapshots').child(data.val()).exists()) && newData.parent().parent().child('snapshots').child(newData.val()).exists()"}
 st['snapshotSlots']={'.read':owner,**slots}
 snap=st['snapshots']['$revision'];mapping="newData.parent().parent().child('snapshotSlots')";matched=' || '.join(f"{mapping}.child('{s}').val() === $revision" for s in ['a','b','c'])
 old=snap['.write'];dele=owner+" && !newData.exists() && "+root+".child('published').child($revision).val() !== true && newData.parent().parent().child('head').val() === "+root+".child('head').val() + 1 && newData.parent().parent().child('snapshots').child('r' + newData.parent().parent().child('head').val()).exists()"
 snap['.write']='('+old.split(' || (auth')[0]+') || ('+dele+')'
 snap['.validate']+=' && ('+matched+')'
 snap['opId']={'.validate':"newData.isString() && newData.val().length <= 80"}
 (here/name).write_text(json.dumps(x,indent=2)+'\n')
(here/'firebase.json').write_text(json.dumps({'database':{'rules':'full.rules.json'},'emulators':{'database':{'port':9220},'auth':{'port':9319},'ui':{'enabled':False},'singleProjectMode':True}}))
