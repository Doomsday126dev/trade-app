import importlib.util,pathlib,unittest,json,copy
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('event_pipeline',ROOT/'scripts/events/refresh-event-details.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Sources(unittest.TestCase):
 def setUp(self):self.catalog=json.loads((ROOT/'data/event-details.json').read_text());self.feed=json.loads((ROOT/'tests/fixtures/events-source/events-2026-10-25.json').read_text())
 def test_direct_detail_html_is_rejected_before_network(self):
  with patch.object(p.urllib.request,'urlopen') as network:
   for url in ['https://leekduck.com/events/halloween-2026-part-1/','https://pokemongo.com/news/halloween-part-1-2026','http://127.0.0.1/']:
    with self.assertRaises(ValueError):p.download(url)
   network.assert_not_called()
 def test_original_detail_dates_and_facts_are_preserved(self):
  result=p.build_record(self.feed,self.catalog,'2026-10-26T12:00:00Z')
  self.assertEqual(len(result['events']),15)
  for key,value in result['events'].items():
   self.assertEqual(value['checkedAt'],self.catalog['events'][key]['checkedAt']);self.assertEqual(value['bonuses'],self.catalog['events'][key]['bonuses']);self.assertEqual(value['caveats'],self.catalog['events'][key]['caveats']);self.assertEqual(value['maintenanceMode'],'curated')
 def test_missing_event_never_receives_invented_bonus(self):
  result=p.build_record([{'eventID':'unknown'}],self.catalog,'2026-10-26T12:00:00Z');self.assertNotIn('unknown',result['events'])
 def test_malformed_feed_fails_closed(self):
  for bad in [{},['bad'],[{}]]:
   with self.assertRaises(ValueError):p.build_record(bad,self.catalog,'2026-10-26T12:00:00Z')
 def test_invalid_curated_provenance_fails_closed(self):
  bad=copy.deepcopy(self.catalog);bad['events']['halloween-2026-part-1']['source']='javascript:alert(1)'
  with self.assertRaises(ValueError):p.build_record(self.feed,bad,'2026-10-26T12:00:00Z')
 def test_rank_ticket_and_exclusion_conditions_remain(self):
  events=p.build_record(self.feed,self.catalog,'2026-10-26T12:00:00Z')['events'];self.assertIn('Rank 10',events['halloween-2026-part-1']['bonuses'][0]);self.assertIn('Deluxe',events['halloween-2026-part-1']['bonuses'][1]);self.assertTrue(all('ticket holders' in b for b in events['pokemon-go-city-safari-boston-2026-rescheduled']['bonuses']));self.assertTrue(any('Daily Adventure Incense' in c for c in events['november-communityday2026']['caveats']))
if __name__=='__main__':unittest.main()
