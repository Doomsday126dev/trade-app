(function(global){
  const root=global.PogoI18n=global.PogoI18n||{};
  const pokemonNames=root.pokemonNames;
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
    en:Object.freeze({community_day:p=>`${p} Community Day`,community_day_classic:p=>`${p} Community Day Classic`,spotlight_hour:p=>`${p} Spotlight Hour`,raid_day:p=>`${p} Raid Day`,raid_hour:p=>`${p} Raid Hour`,research_day:p=>`${p} Research Day`,max_battle_day:p=>`${p} Max Battle Day`,max_monday:p=>`Dynamax ${p} during Max Monday`,hatch_day:p=>`${p} Hatch Day`}),
    ja:Object.freeze({community_day:p=>`${p}のコミュニティ・デイ`,community_day_classic:p=>`${p}の「コミュニティ・デイ（復刻）」`,spotlight_hour:p=>`${p}のスポットライトアワー`,raid_day:p=>`${p}のレイド・デイ`,raid_hour:p=>`${p}のレイドアワー`,research_day:p=>`${p}のリサーチデイ`,max_battle_day:p=>`${p}のマックスバトルデイ`,max_monday:p=>`マックスマンデー：ダイマックス${p}`,hatch_day:p=>`${p}のふかの日`}),
    es:Object.freeze({community_day:p=>`Día de la Comunidad de ${p}`,community_day_classic:p=>`Día de la Comunidad clásico de ${p}`,spotlight_hour:p=>`Hora del Pokémon destacado: ${p}`,raid_day:p=>`Día de Incursiones de ${p}`,raid_hour:p=>`Hora de Incursiones de ${p}`,research_day:p=>`Día de Investigación de ${p}`,max_battle_day:p=>`Día de Combates Max de ${p}`,max_monday:p=>`Lunes Max: ${p} Dinamax`,hatch_day:p=>`Día de Eclosión de ${p}`}),
    de:Object.freeze({community_day:p=>`Community Day mit ${p}`,community_day_classic:p=>`Community Day Classic mit ${p}`,spotlight_hour:p=>`Rampenlicht-Stunde mit ${p}`,raid_day:p=>`Raid-Tag mit ${p}`,raid_hour:p=>`Raid-Stunde mit ${p}`,research_day:p=>`Forschungstag mit ${p}`,max_battle_day:p=>`Dyna-Kampftag mit ${p}`,max_monday:p=>`Dyna-Montag mit Dynamax-${p}`,hatch_day:p=>`Schlüpftag mit ${p}`})
  });

  function localeKey(value){const base=String(value||'en').toLowerCase().replaceAll('_','-').split('-')[0];return supported.includes(base)?base:'en';}
  function mapValue(value,locale,{englishFallback=false}={}){if(!value||typeof value!=='object'||Array.isArray(value))return'';const lang=localeKey(locale);return String(value[lang]||(englishFallback?value.en:'')||'').trim();}
  function translatedMapField(event,field,locale,{englishFallback=false}={}){const direct=mapValue(event?.[field],locale,{englishFallback});if(direct)return direct;const lang=localeKey(locale),translations=event?.translations||event?.localizations;return String(translations?.[lang]?.[field]||(englishFallback?translations?.en?.[field]:'')||'').trim();}
  function sourceField(event,field){return typeof event?.[field]==='string'?event[field].trim():'';}
  function eventId(event){return String(event?.id||event?.eventID||event?.eventId||event?.slug||'').trim();}
  function sourceTitle(event){return sourceField(event,'title')||sourceField(event,'name')||sourceField(event,'heading');}
  function sourceSummary(event){return sourceField(event,'summary')||sourceField(event,'description');}
  function typeKey(value){const key=String(value||'').trim().toLowerCase().replace(/[\s-]+/g,'_');const aliases={community_day:'community_day',raid_day:'raid_day',raid_hour:'raid_hour',pokemon_spotlight_hour:'spotlight_hour',spotlight_hour:'spotlight_hour',research_day:'research_day',go_battle_day:'go_battle_day',gbl_day:'go_battle_day',max_battle_day:'max_battle_day',max_mondays:'max_monday',hatch_day:'hatch_day',seasonal_event:'seasonal',ticketed_event:'ticketed',in_person_event:'in_person',global_event:'global'};return aliases[key]||key;}
  function recurringParts(event){
    const value=sourceTitle(event),kind=typeKey(event?.eventType),patterns={
      community_day_classic:/^(.+) Community Day Classic$/,
      community_day:/^(.+) Community Day$/,
      spotlight_hour:/^(.+) Spotlight Hour$/,
      raid_day:/^(.+) Raid Day$/,
      raid_hour:/^(.+) Raid Hour$/,
      research_day:/^(.+) Research Day$/,
      max_battle_day:/^(.+) Max Battle Day$/,
      max_monday:/^Dynamax (.+) during Max Monday$/,
      hatch_day:/^(.+) Hatch Day$/
    };
    const allowed=kind==='community_day'?['community_day_classic','community_day']:kind==='spotlight_hour'?['spotlight_hour']:kind==='raid_day'?['raid_day']:kind==='raid_hour'?['raid_hour']:kind==='research_day'||kind==='research'?['research_day']:kind==='max_battle_day'?['max_battle_day']:kind==='max_monday'?['max_monday']:kind==='hatch_day'||kind==='event'?['hatch_day']:[];
    for(const candidate of allowed){const match=value.match(patterns[candidate]);if(match){const speciesId=pokemonNames?.speciesIdByEnglishName(match[1]);return speciesId?{kind:candidate,speciesId}:null;}}
    return null;
  }
  function recurringTitle(event,locale){const parts=recurringParts(event);if(!parts)return'';const lang=localeKey(locale),pokemon=pokemonNames.speciesName({no:parts.speciesId},lang);return pokemon&&titleTemplates[lang]?.[parts.kind]?titleTemplates[lang][parts.kind](pokemon):'';}
  function titleResolution(event,locale){
    const mapped=translatedMapField(event,'title',locale)||translatedMapField(event,'name',locale)||translatedMapField(event,'heading',locale);
    if(mapped)return Object.freeze({text:mapped,status:'official-localized',stableId:eventId(event)});
    const composed=localeKey(locale)==='en'?'':recurringTitle(event,locale);
    if(composed)return Object.freeze({text:composed,status:'template-localized',stableId:eventId(event)});
    const fallback=sourceTitle(event)||translatedMapField(event,'title','en',{englishFallback:true})||translatedMapField(event,'name','en',{englishFallback:true})||translatedMapField(event,'heading','en',{englishFallback:true});
    return Object.freeze({text:fallback,status:'english-fallback',stableId:eventId(event)});
  }
  function title(event,locale){return titleResolution(event,locale).text;}
  function summary(event,locale){return translatedMapField(event,'summary',locale)||translatedMapField(event,'description',locale)||sourceSummary(event)||translatedMapField(event,'summary','en',{englishFallback:true})||translatedMapField(event,'description','en',{englishFallback:true});}
  function typeLabel(value,locale){const lang=localeKey(locale),key=typeKey(value);return typeLabels[lang]?.[key]||typeLabels.en[key]||String(value||'');}
  function bonusLabel(kind,locale){const lang=localeKey(locale),key=String(kind||'').trim().toLowerCase().replace(/[\s-]+/g,'_');return bonusLabels[lang]?.[key]||bonusLabels.en[key]||'';}
  function localizeEvent(event,locale){const resolved=titleResolution(event,locale);return Object.freeze({...event,stableId:eventId(event),localizedTitle:resolved.text,localizedTitleStatus:resolved.status,localizedSummary:summary(event,locale)});}

  root.eventLabels=Object.freeze({localeKey,eventId,sourceTitle,title,titleResolution,summary,typeKey,typeLabel,bonusLabel,recurringParts,recurringTitle,localizeEvent,typeLabels,bonusLabels,titleTemplates});
})(window);
