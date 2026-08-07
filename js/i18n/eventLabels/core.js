(function(global){
  const root=global.PogoI18n=global.PogoI18n||{};
  const pokemonNames=root.pokemonNames;
  const officialCatalog=root.eventTitleCatalog?.titlesByEventId||{};
  const supported=Object.freeze(['en','ja','es','de']);
  const typeLabels=Object.freeze({
    en:Object.freeze({community_day:'Community Day',raid_day:'Raid Day',raid_hour:'Raid Hour',spotlight_hour:'Spotlight Hour',research_day:'Research Day',go_battle_day:'GO Battle Day',max_battle_day:'Max Battle Day',max_monday:'Max Monday',hatch_day:'Hatch Day',seasonal:'Seasonal event',ticketed:'Ticketed event',in_person:'In-person event',global:'Global event'}),
    ja:Object.freeze({community_day:'コミュニティ・デイ',raid_day:'レイド・デイ',raid_hour:'レイドアワー',spotlight_hour:'スポットライトアワー',research_day:'リサーチデイ',go_battle_day:'GOバトル・デイ',max_battle_day:'マックスバトルデイ',max_monday:'マックスマンデー',hatch_day:'ふかの日',seasonal:'シーズンイベント',ticketed:'チケット制イベント',in_person:'現地イベント',global:'グローバルイベント'}),
    es:Object.freeze({community_day:'Día de la Comunidad',raid_day:'Día de Incursiones',raid_hour:'Hora de Incursiones',spotlight_hour:'Hora del Pokémon destacado',research_day:'Día de Investigación',go_battle_day:'Día de Combates GO',max_battle_day:'Día de Combates Max',max_monday:'Lunes Max',hatch_day:'Día de Eclosión',seasonal:'Evento de temporada',ticketed:'Evento con entrada',in_person:'Evento presencial',global:'Evento global'}),
    de:Object.freeze({community_day:'Community Day',raid_day:'Raid-Tag',raid_hour:'Raid-Stunde',spotlight_hour:'Rampenlicht-Stunde',research_day:'Forschungstag',go_battle_day:'GO-Kampftag',max_battle_day:'Dyna-Kampftag',max_monday:'Dyna-Montag',hatch_day:'Schlüpftag',seasonal:'Saison-Event',ticketed:'Ticket-Event',in_person:'Vor-Ort-Event',global:'Globales Event'})
  });
  const bonusLabels=Object.freeze({
    en:Object.freeze({increased_spawns:'Increased spawns',raid_bonus:'Raid bonus',hatch_distance:'Reduced hatch distance',stardust_bonus:'Stardust bonus',xp_bonus:'XP bonus',shiny_chance:'Increased Shiny chance',timed_research:'Timed Research',field_research:'Field Research',ticketed:'Ticket required',free:'Free',local_time:'Local time'}),
    ja:Object.freeze({increased_spawns:'出現率アップ',raid_bonus:'レイドボーナス',hatch_distance:'ふか距離短縮',stardust_bonus:'ほしのすなボーナス',xp_bonus:'XPボーナス',shiny_chance:'色違いの出現率アップ',timed_research:'タイムチャレンジ',field_research:'フィールドリサーチ',ticketed:'チケットが必要',free:'無料',local_time:'現地時間'}),
    es:Object.freeze({increased_spawns:'Más apariciones',raid_bonus:'Bonus de incursión',hatch_distance:'Menor distancia de eclosión',stardust_bonus:'Bonus de Polvos Estelares',xp_bonus:'Bonus de PX',shiny_chance:'Mayor probabilidad de variocolor',timed_research:'Investigación temporal',field_research:'Investigación de campo',ticketed:'Requiere entrada',free:'Gratis',local_time:'Hora local'}),
    de:Object.freeze({increased_spawns:'Erhöhte Erscheinungsrate',raid_bonus:'Raid-Bonus',hatch_distance:'Verringerte Schlüpfdistanz',stardust_bonus:'Sternenstaub-Bonus',xp_bonus:'EP-Bonus',shiny_chance:'Erhöhte Schillernd-Chance',timed_research:'Befristete Forschung',field_research:'Feldforschung',ticketed:'Ticket erforderlich',free:'Kostenlos',local_time:'Ortszeit'})
  });
  const titleTemplates=Object.freeze({
    en:Object.freeze({community_day:p=>`${p} Community Day`,community_day_classic:p=>`${p} Community Day Classic`,spotlight_hour:p=>`${p} Spotlight Hour`,raid_day:p=>`${p} Raid Day`,raid_hour:p=>`${p} Raid Hour`,research_day:p=>`${p} Research Day`,max_battle_day:p=>`${p} Max Battle Day`,max_monday:p=>`Dynamax ${p} during Max Monday`,hatch_day:p=>`${p} Hatch Day`,mega_raids:p=>`Mega ${p} in Mega Raids`,five_star_raids:p=>`${p} in 5-star Raid Battles`,shadow_raids:p=>`Shadow ${p} in Shadow Raids`}),
    ja:Object.freeze({community_day:p=>`${p}のコミュニティ・デイ`,community_day_classic:p=>`${p}の「コミュニティ・デイ（復刻）」`,spotlight_hour:p=>`${p}のスポットライトアワー`,raid_day:p=>`${p}のレイド・デイ`,raid_hour:p=>`${p}のレイドアワー`,research_day:p=>`${p}のリサーチデイ`,max_battle_day:p=>`${p}のマックスバトルデイ`,max_monday:p=>`マックスマンデー：ダイマックス${p}`,hatch_day:p=>`${p}のふかの日`,mega_raids:p=>`メガ${p}がメガレイドに登場`,five_star_raids:p=>`${p}が伝説レイドバトルに登場`,shadow_raids:p=>`シャドウ${p}がシャドウレイドに登場`}),
    es:Object.freeze({community_day:p=>`Día de la Comunidad de ${p}`,community_day_classic:p=>`Día de la Comunidad clásico de ${p}`,spotlight_hour:p=>`Hora del Pokémon destacado: ${p}`,raid_day:p=>`Día de Incursiones de ${p}`,raid_hour:p=>`Hora de Incursiones de ${p}`,research_day:p=>`Día de Investigación de ${p}`,max_battle_day:p=>`Día de Combates Max de ${p}`,max_monday:p=>`Lunes Max: ${p} Dinamax`,hatch_day:p=>`Día de Eclosión de ${p}`,mega_raids:p=>`Mega-${p} en megaincursiones`,five_star_raids:p=>`${p} en incursiones de cinco estrellas`,shadow_raids:p=>`${p} oscuro en incursiones oscuras`}),
    de:Object.freeze({community_day:p=>`Community Day mit ${p}`,community_day_classic:p=>`Community Day Classic mit ${p}`,spotlight_hour:p=>`Rampenlicht-Stunde mit ${p}`,raid_day:p=>`Raid-Tag mit ${p}`,raid_hour:p=>`Raid-Stunde mit ${p}`,research_day:p=>`Forschungstag mit ${p}`,max_battle_day:p=>`Dyna-Kampftag mit ${p}`,max_monday:p=>`Dyna-Montag mit Dynamax-${p}`,hatch_day:p=>`Schlüpftag mit ${p}`,mega_raids:p=>`Mega-${p} in Mega-Raids`,five_star_raids:p=>`${p} in Stufe-5-Raids`,shadow_raids:p=>`Crypto-${p} in Crypto-Raids`})
  });
  const leagueTerms=Object.freeze({
    en:Object.freeze({'Great League':'Great League','Ultra League':'Ultra League','Master League':'Master League','Master Premier':'Master Premier','Weather Cup: Great League Edition':'Weather Cup: Great League Edition','Evolution Cup: Great League Edition':'Evolution Cup: Great League Edition','Scroll Cup: Great League Edition':'Scroll Cup: Great League Edition','Great League: Mega Edition':'Great League: Mega Edition','Ultra League: Mega Edition':'Ultra League: Mega Edition','Master League: Mega Edition':'Master League: Mega Edition'}),
    ja:Object.freeze({'Great League':'スーパーリーグ','Ultra League':'ハイパーリーグ','Master League':'マスターリーグ','Master Premier':'マスタープレミア','Weather Cup: Great League Edition':'自然界カップ：スーパーリーグバージョン','Evolution Cup: Great League Edition':'進化カップ：スーパーリーグバージョン','Scroll Cup: Great League Edition':'かけじくカップ：スーパーリーグバージョン','Great League: Mega Edition':'スーパーリーグ：メガバージョン','Ultra League: Mega Edition':'ハイパーリーグ：メガバージョン','Master League: Mega Edition':'マスターリーグ：メガバージョン'}),
    es:Object.freeze({'Great League':'Liga Super Ball','Ultra League':'Liga Ultra Ball','Master League':'Liga Master Ball','Master Premier':'Master Premier','Weather Cup: Great League Edition':'Copa Meteorológica: Edición Liga Super Ball','Evolution Cup: Great League Edition':'Copa Evolución: Edición Liga Super Ball','Scroll Cup: Great League Edition':'Copa Manuscrito: Edición Liga Super Ball','Great League: Mega Edition':'Liga Super Ball: Edición Mega','Ultra League: Mega Edition':'Liga Ultra Ball: Edición Mega','Master League: Mega Edition':'Liga Master Ball: Edición Mega'}),
    de:Object.freeze({'Great League':'Superliga','Ultra League':'Hyperliga','Master League':'Meisterliga','Master Premier':'Meister-Premier','Weather Cup: Great League Edition':'Wetter-Cup – Edition: Superliga','Evolution Cup: Great League Edition':'Entwicklungs-Cup – Edition: Superliga','Scroll Cup: Great League Edition':'Schriftrollen-Cup – Edition: Superliga','Great League: Mega Edition':'Mega-Edition: Superliga','Ultra League: Mega Edition':'Mega-Edition: Hyperliga','Master League: Mega Edition':'Mega-Edition: Meisterliga'})
  });
  const seasonTerms=Object.freeze({en:'Forever Forward',ja:'新たな歩み',es:'Siempre Adelante',de:'Immer weiter'});

  function localeKey(value){const base=String(value||'en').toLowerCase().replaceAll('_','-').split('-')[0];return supported.includes(base)?base:'en';}
  function mapValue(value,locale,{englishFallback=false}={}){if(!value||typeof value!=='object'||Array.isArray(value))return'';const lang=localeKey(locale);return String(value[lang]||(englishFallback?value.en:'')||'').trim();}
  function translatedMapField(event,field,locale,{englishFallback=false}={}){const direct=mapValue(event?.[field],locale,{englishFallback});if(direct)return direct;const lang=localeKey(locale),translations=event?.translations||event?.localizations;return String(translations?.[lang]?.[field]||(englishFallback?translations?.en?.[field]:'')||'').trim();}
  function sourceField(event,field){return typeof event?.[field]==='string'?event[field].trim():'';}
  function eventId(event){return String(event?.id||event?.eventID||event?.eventId||event?.slug||'').trim();}
  function sourceTitle(event){return sourceField(event,'title')||sourceField(event,'name')||sourceField(event,'heading');}
  function sourceSummary(event){return sourceField(event,'summary')||sourceField(event,'description');}
  function typeKey(value){const key=String(value||'').trim().toLowerCase().replace(/[\s-]+/g,'_');const aliases={community_day:'community_day',raid_day:'raid_day',raid_hour:'raid_hour',pokemon_spotlight_hour:'spotlight_hour',spotlight_hour:'spotlight_hour',research_day:'research_day',go_battle_day:'go_battle_day',gbl_day:'go_battle_day',max_battle_day:'max_battle_day',max_mondays:'max_monday',hatch_day:'hatch_day',seasonal_event:'seasonal',ticketed_event:'ticketed',in_person_event:'in_person',global_event:'global'};return aliases[key]||key;}
  function speciesId(value){return pokemonNames?.speciesIdByEnglishName(String(value||'').replace(/^Mega\s+/,'').replace(/^Shadow\s+/,'').replace(/\s*\((?:Altered|Origin)(?: Forme)?\)\s*$/i,''));}
  function localizedSpecies(value,locale){const id=speciesId(value);return id?pokemonNames.speciesName({no:id},localeKey(locale)):'';}
  function englishListParts(value){return String(value||'').split(/,\s+and\s+|,\s+|\s+and\s+/).map(x=>x.trim()).filter(Boolean);}
  function localeList(values,locale){const lang=localeKey(locale),items=values.filter(Boolean);if(items.length<2)return items[0]||'';if(lang==='ja')return items.join('、');const conjunction=lang==='es'?' y ':' und ';if(lang==='en')return items.length===2?items.join(' and '):`${items.slice(0,-1).join(', ')}, and ${items.at(-1)}`;return items.length===2?items.join(conjunction):`${items.slice(0,-1).join(', ')}${conjunction}${items.at(-1)}`;}
  function recurringParts(event){
    const value=sourceTitle(event),kind=typeKey(event?.eventType),patterns={community_day_classic:/^(.+) Community Day Classic$/,community_day:/^(.+) Community Day$/,spotlight_hour:/^(.+) Spotlight Hour$/,raid_day:/^(.+) Raid Day$/,raid_hour:/^(.+) Raid Hour$/,research_day:/^(.+) Research Day$/,max_battle_day:/^(.+) Max Battle Day$/,max_monday:/^Dynamax (.+) during Max Monday$/,hatch_day:/^(.+) Hatch Day$/};
    const allowed=kind==='community_day'?['community_day_classic','community_day']:kind==='spotlight_hour'?['spotlight_hour']:kind==='raid_day'?['raid_day']:kind==='raid_hour'?['raid_hour']:kind==='research_day'||kind==='research'?['research_day']:kind==='max_battle_day'||kind==='max_battles'?['max_battle_day']:kind==='max_monday'?['max_monday']:kind==='hatch_day'||kind==='event'?['hatch_day']:[];
    for(const candidate of allowed){const match=value.match(patterns[candidate]);if(match){const names=englishListParts(match[1]),ids=names.map(speciesId);return ids.every(Boolean)?{kind:candidate,speciesIds:ids}:null;}}
    return null;
  }
  function recurringTitle(event,locale){const parts=recurringParts(event);if(!parts)return'';const lang=localeKey(locale),pokemon=localeList(parts.speciesIds.map(id=>pokemonNames.speciesName({no:id},lang)),lang);return pokemon&&titleTemplates[lang]?.[parts.kind]?titleTemplates[lang][parts.kind](pokemon):'';}
  function raidTitle(event,locale){
    const source=sourceTitle(event),lang=localeKey(locale),patterns=[[/^Mega (.+) in Mega Raids$/,'mega_raids'],[/^(.+) in 5-star Raid Battles$/,'five_star_raids'],[/^Shadow (.+) in Shadow Raids$/,'shadow_raids']];
    for(const[pattern,kind]of patterns){const match=source.match(pattern);if(!match)continue;const names=englishListParts(match[1]),localized=names.map(name=>localizedSpecies(name,lang));if(localized.every(Boolean))return titleTemplates[lang][kind](localeList(localized,lang));}
    return'';
  }
  function leagueTitle(event,locale){
    if(typeKey(event?.eventType)!=='go_battle_league')return'';
    const source=sourceTitle(event),match=source.match(/^(.+?)(?:\s*\|\s*Forever Forward)$/);if(!match)return'';
    let terms=englishListParts(match[1]);
    if(match[1]==='Great League, Ultra League, and Master League: Mega Edition')terms=['Great League: Mega Edition','Ultra League: Mega Edition','Master League: Mega Edition'];
    const lang=localeKey(locale),localized=terms.map(term=>leagueTerms[lang]?.[term]);if(!localized.every(Boolean))return'';
    const list=localeList(localized,lang),season=seasonTerms[lang];return lang==='ja'?`${list}｜${season}`:`${list} | ${season}`;
  }
  function structuredTitle(event,locale){return recurringTitle(event,locale)||raidTitle(event,locale)||leagueTitle(event,locale);}
  function officialTitle(event,locale){return String(officialCatalog[eventId(event)]?.titles?.[localeKey(locale)]||'').trim();}
  function titleResolution(event,locale){
    const mapped=translatedMapField(event,'title',locale)||translatedMapField(event,'name',locale)||translatedMapField(event,'heading',locale)||officialTitle(event,locale);
    if(mapped)return Object.freeze({text:mapped,status:'official-localized',stableId:eventId(event),ambiguous:false});
    const composed=structuredTitle(event,locale);
    if(composed)return Object.freeze({text:composed,status:'structured-localized',stableId:eventId(event),ambiguous:false});
    const fallback=sourceTitle(event)||translatedMapField(event,'title','en',{englishFallback:true})||translatedMapField(event,'name','en',{englishFallback:true})||translatedMapField(event,'heading','en',{englishFallback:true});
    const recognized=/Community Day|Spotlight Hour|Raid (?:Day|Hour)|Max (?:Battle Day|Monday)|Hatch Day|Mega Raids|5-star Raid Battles|Shadow Raids|\| Forever Forward/.test(fallback);
    return Object.freeze({text:fallback,status:'english-fallback',stableId:eventId(event),ambiguous:recognized});
  }
  function title(event,locale){return titleResolution(event,locale).text;}
  function summary(event,locale){return translatedMapField(event,'summary',locale)||translatedMapField(event,'description',locale)||sourceSummary(event)||translatedMapField(event,'summary','en',{englishFallback:true})||translatedMapField(event,'description','en',{englishFallback:true});}
  function typeLabel(value,locale){const lang=localeKey(locale),key=typeKey(value);return typeLabels[lang]?.[key]||typeLabels.en[key]||String(value||'');}
  function bonusLabel(kind,locale){const lang=localeKey(locale),key=String(kind||'').trim().toLowerCase().replace(/[\s-]+/g,'_');return bonusLabels[lang]?.[key]||bonusLabels.en[key]||'';}
  function localizeEvent(event,locale){const resolved=titleResolution(event,locale);return Object.freeze({...event,stableId:eventId(event),localizedTitle:resolved.text,localizedTitleStatus:resolved.status,localizedSummary:summary(event,locale)});}
  function coverage(events,locale){const result={locale:localeKey(locale),total:0,officialLocalized:0,structuredLocalized:0,curatedLocalized:0,englishFallback:0,ambiguous:0};for(const event of events||[]){const resolved=titleResolution(event,locale);result.total++;if(resolved.status==='official-localized')result.officialLocalized++;else if(resolved.status==='structured-localized')result.structuredLocalized++;else if(resolved.status==='curated-localized')result.curatedLocalized++;else result.englishFallback++;if(resolved.ambiguous)result.ambiguous++;}return Object.freeze(result);}

  root.eventLabels=Object.freeze({localeKey,eventId,sourceTitle,title,titleResolution,summary,typeKey,typeLabel,bonusLabel,recurringParts,recurringTitle,raidTitle,leagueTitle,structuredTitle,officialTitle,localizeEvent,coverage,typeLabels,bonusLabels,titleTemplates,leagueTerms,seasonTerms});
})(window);
