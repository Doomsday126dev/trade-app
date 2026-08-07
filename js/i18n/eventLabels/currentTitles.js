(function(global){
  const root=global.PogoI18n=global.PogoI18n||{};
  const localizedArticle=slug=>Object.freeze({en:`https://pokemongo.com/en/news/${slug}`,ja:`https://pokemongo.com/ja/news/${slug}`,es:`https://pokemongo.com/es/news/${slug}`,de:`https://pokemongo.com/de/news/${slug}`});
  const officialNews=Object.freeze({
    fireAndIce:localizedArticle('fire-and-ice-hatch-day-2026'),
    summerMarathon:localizedArticle('summer-marathon-2026'),
    starmie:localizedArticle('starmie-super-mega-raid-day-2026'),
    waterFestival:localizedArticle('water-festival-2026'),
    communityDay:Object.freeze({en:'https://pokemongo.com/en/news',ja:'https://pokemongo.com/ja/news',es:'https://pokemongo.com/es/news',de:'https://pokemongo.com/de/news'}),
    goPass:Object.freeze({en:'https://pokemongo.com/en/news/go-pass-august-2026',ja:'https://pokemongo.com/ja/news/go-pass-august-2026',es:'https://pokemongo.com/es/news/go-pass-august-2026',de:'https://pokemongo.com/de/news/go-pass-august-2026'}),
    season:Object.freeze({en:'https://pokemongo.com/en/seasons/forever-forward',ja:'https://pokemongo.com/ja/seasons/forever-forward',es:'https://pokemongo.com/es/seasons/forever-forward',de:'https://pokemongo.com/de/seasons/forever-forward'}),
    megaFinale:Object.freeze({en:'https://pokemongo.com/en/news',es:'https://pokemongo.com/es/news',de:'https://pokemongo.com/de/news'})
  });
  const entry=(titles,sources)=>Object.freeze({titles:Object.freeze(titles),sources});
  const titlesByEventId=Object.freeze({
    'fire-and-ice-hatch-day-2026':entry({en:'Fire and Ice Hatch Day',ja:'炎と氷ふかの日',es:'Día de eclosiones: Fuego y hielo',de:'Feuer-und-Eis-Schlüpftag'},officialNews.fireAndIce),
    'summer-marathon-2026':entry({en:'Summer Marathon: Arctic Embers',ja:'夏の遠足：凍てつく残火',es:'Maratón estival: Fuego ártico',de:'Sommer-Marathon: Arktische Glut'},officialNews.summerMarathon),
    'starmie-super-mega-raid-day-2026':entry({en:'Starmie Super Mega Raid Day',ja:'ウルトラアンロック：スターミーのスーパーメガレイド・デイ',es:'Ultrabonus: Día de supermegaincursiones de Starmie',de:'Hyperbonus: Super-Mega-Raid-Tag mit Starmie'},officialNews.starmie),
    'water-festival-2026':entry({en:'Ultra Unlock: Water Festival',ja:'ウルトラアンロック：ウォーターフェスティバル',es:'Ultrabonus: Festival Acuático',de:'Hyperbonus: Wasserfestival'},officialNews.waterFestival),
    'august-communityday2026':entry({en:'Nickit Community Day',ja:'2026年8月のコミュニティ・デイ：クスネ',es:'Día de la Comunidad de agosto de 2026: Nickit',de:'Community Day im August 2026: Kleptifux'},officialNews.communityDay),
    'go-pass-august-2026':entry({en:'GO Pass: August',ja:'GOパス：8月',es:'Pase de GO de agosto',de:'GO-Pass: August'},officialNews.goPass),
    'season-23-forever-forward':entry({en:'Forever Forward',ja:'新たな歩み',es:'Siempre Adelante',de:'Immer weiter'},officialNews.season),
    'pokemon-go-fest-2026-mega-finale':entry({en:'Pokémon GO Fest 2026: Mega Finale',es:'Festival de Pokémon GO: Megafinal',de:'Pokémon GO Fest: Mega-Finale'},officialNews.megaFinale)
  });
  root.eventTitleCatalog=Object.freeze({retrievedAt:'2026-08-07',titlesByEventId,officialNews});
})(window);
