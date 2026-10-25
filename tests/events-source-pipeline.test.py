import importlib.util,pathlib,unittest,json
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('event_pipeline',ROOT/'scripts/events/refresh-event-details.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Sources(unittest.TestCase):
 def test_official_rank_and_deluxe(self):
  f=p.parse_bonuses((ROOT/'tests/fixtures/events-source/halloween-official.html').read_text());self.assertEqual(len(f['bonuses']),4);self.assertIn('Rank 10',f['bonuses'][0]);self.assertIn('Deluxe',f['bonuses'][1]);self.assertIn('Rank 20',f['bonuses'][2]);self.assertTrue(any('Milestones' in c for c in f['caveats']))
 def test_secondary_rank_and_deluxe(self):
  f=p.parse_bonuses((ROOT/'tests/fixtures/events-source/halloween-secondary.html').read_text());self.assertEqual(len(f['bonuses']),4);self.assertIn('Rank 10',f['bonuses'][0]);self.assertIn('Rank 20',f['bonuses'][2])
 def test_primary_down_uses_secondary(self):
  event={'eventID':'halloween-2026-part-1','link':'https://leekduck.com/events/halloween-2026-part-1/'}
  def fetch(url):
   if 'pokemongo.com' in url:raise OSError('offline')
   return (ROOT/'tests/fixtures/events-source/halloween-secondary.html').read_text()
  f=p.resolve(event,fetch=fetch,now='2026-10-25T12:00:00Z');self.assertEqual(len(f['bonuses']),4);self.assertIn('leekduck.com',f['source']);self.assertEqual(f['failures'][0]['kind'],'unavailable')
 def test_both_sources_down_preserves_original_check(self):
  old={'bonuses':['Rank 10: double Candy'],'caveats':[],'checkedAt':'2026-10-24T12:00:00Z','source':'https://pokemongo.com/news/test'}
  def fail(url):raise OSError('offline')
  f=p.resolve({'eventID':'halloween-2026-part-1','link':'https://leekduck.com/events/halloween-2026-part-1/'},fetch=fail,now='2026-10-25T12:00:00Z',previous=old);self.assertEqual(f['status'],'last-known');self.assertEqual(f['checkedAt'],old['checkedAt'])
 def test_no_section_not_false_no_bonuses(self):
  f=p.resolve({'eventID':'unannounced','link':'https://leekduck.com/events/test/'},fetch=lambda u:'<h2>Spawns</h2><p>Details coming soon</p>');self.assertEqual(f['status'],'not-supplied');self.assertEqual(f['bonuses'],[])
 def test_ticket_and_time_context(self):
  f=p.parse_bonuses('<h2>Ticket Holder Bonuses</h2><p>Only on your ticketed event day, 10–18 local.</p><div class="bonus-text">Double Candy</div><h3>Trading</h3><p>Ticket holders: 00–23:59 local.</p><div class="bonus-text">Half trade Stardust</div><h2>Spawns</h2><li>Not a bonus</li>');self.assertEqual(len(f['bonuses']),2);self.assertIn('10–18',f['bonuses'][0]);self.assertIn('00–23:59',f['bonuses'][1]);self.assertIn('Trading',f['bonuses'][1])
 def test_deluxe_context_stays_attached(self):
  f=p.parse_bonuses('<h2>Major Milestone Bonuses</h2><p>Tier 2 Rank 25</p><li>40 Gifts</li><p>Upgrade to GO Pass Deluxe for the following bonus.</p><p>Tier 2 Rank 25</p><li>50 Gifts</li><h2>Shop</h2><li>Shop offer</li>');self.assertEqual(len(f['bonuses']),2);self.assertNotIn('Deluxe',f['bonuses'][0]);self.assertIn('Deluxe',f['bonuses'][1])
 def test_real_current_cards_have_verified_information(self):
  d=json.loads((ROOT/'data/event-details.json').read_text());ids=['season-24-twilight-trails','go-pass-october-2026','halloween-2026-part-1','chandelure-super-mega-raid-day-2026','pokemon-go-city-safari-boston-2026-rescheduled'];self.assertTrue(all(d['events'][i]['bonuses'] and d['events'][i]['source'].startswith('https://') for i in ids));self.assertTrue(all('Current ticket holders' in b for b in d['events'][ids[-1]]['bonuses']))
if __name__=='__main__':unittest.main()
