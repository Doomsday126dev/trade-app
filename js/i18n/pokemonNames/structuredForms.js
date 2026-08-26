(function(global){
  const source=Object.freeze({kind:'curated-official-form-supplement',upstream:'PokeAPI/pokeapi',reviewedAt:'2026-08-26',identity:'species-number plus canonical app name'});
  const entry=(formId,canonicalDescriptor,labels,category='official-form')=>Object.freeze({category,formId,canonicalDescriptor,labels:Object.freeze(labels)});
  const entries=Object.freeze({
    '128|P-Tauros (Combat)':entry(10419,'Paldean Form (Combat Breed)',{en:'Paldean Form (Combat Breed)',ja:'パルデアのすがた・コンバット種',es:'Forma de Paldea · variedad combatiente',de:'Paldea-Form · Kampfvariante'},'regional-breed'),
    '128|P-Tauros (Blaze)':entry(10420,'Paldean Form (Blaze Breed)',{en:'Paldean Form (Blaze Breed)',ja:'パルデアのすがた・ブレイズ種',es:'Forma de Paldea · variedad ardiente',de:'Paldea-Form · Flammenvariante'},'regional-breed'),
    '128|P-Tauros (Aqua)':entry(10421,'Paldean Form (Aqua Breed)',{en:'Paldean Form (Aqua Breed)',ja:'パルデアのすがた・ウォーター種',es:'Forma de Paldea · variedad acuática',de:'Paldea-Form · Flutenvariante'},'regional-breed'),
    '386|Deoxys (Attack)':entry(10001,'Attack Forme',{en:'Attack Forme',ja:'アタックフォルム',es:'Forma Ataque',de:'Angriffsform'}),
    '386|Deoxys (Defense)':entry(10002,'Defense Forme',{en:'Defense Forme',ja:'ディフェンスフォルム',es:'Forma Defensa',de:'Verteidigungsform'}),
    '386|Deoxys (Speed)':entry(10003,'Speed Forme',{en:'Speed Forme',ja:'スピードフォルム',es:'Forma Velocidad',de:'Initiativeform'}),
    '487|Giratina (Altered)':entry(487,'Altered Forme',{en:'Altered Forme',ja:'アナザーフォルム',es:'Forma Modificada',de:'Wandelform'}),
    '487|Giratina (Origin)':entry(10063,'Origin Forme',{en:'Origin Forme',ja:'オリジンフォルム',es:'Forma Origen',de:'Urform'}),
    '492|Shaymin (Land)':entry(492,'Land Forme',{en:'Land Forme',ja:'ランドフォルム',es:'Forma Tierra',de:'Landform'}),
    '492|Shaymin (Sky)':entry(10064,'Sky Forme',{en:'Sky Forme',ja:'スカイフォルム',es:'Forma Cielo',de:'Zenitform'}),
    '720|Hoopa (Confined)':entry(720,'Hoopa Confined',{en:'Hoopa Confined',ja:'いましめられしフーパ',es:'Hoopa Contenido',de:'Gebanntes Hoopa'}),
    '720|Hoopa (Unbound)':entry(10086,'Hoopa Unbound',{en:'Hoopa Unbound',ja:'ときはなたれしフーパ',es:'Hoopa Desatado',de:'Entfesseltes Hoopa'}),
    '745|Lycanroc (Midday)':entry(745,'Midday Form',{en:'Midday Form',ja:'まひるのすがた',es:'Forma Diurna',de:'Tagform'}),
    '745|Lycanroc (Midnight)':entry(10126,'Midnight Form',{en:'Midnight Form',ja:'まよなかのすがた',es:'Forma Nocturna',de:'Nachtform'}),
    '745|Lycanroc (Dusk)':entry(10152,'Dusk Form',{en:'Dusk Form',ja:'たそがれのすがた',es:'Forma Crepuscular',de:'Zwielichtform'}),
    '854|Sinistea (Phony)':entry(854,'Phony Form',{en:'Phony Form',ja:'がんさくフォルム',es:'Forma Falsificada',de:'Fälschungsform'}),
    '854|Sinistea (Antique)':entry(10344,'Antique Form',{en:'Antique Form',ja:'しんさくフォルム',es:'Forma Auténtica',de:'Originalform'}),
    '855|Polteageist (Phony)':entry(855,'Phony Form',{en:'Phony Form',ja:'がんさくフォルム',es:'Forma Falsificada',de:'Fälschungsform'}),
    '855|Polteageist (Antique)':entry(10345,'Antique Form',{en:'Antique Form',ja:'しんさくフォルム',es:'Forma Auténtica',de:'Originalform'}),
    '978|Tatsugiri (Curly)':entry(978,'Curly Form',{en:'Curly Form',ja:'そったすがた',es:'Forma Curvada',de:'Gebogene Form'},'tatsugiri-form'),
    '978|Tatsugiri (Droopy)':entry(10427,'Droopy Form',{en:'Droopy Form',ja:'たれたすがた',es:'Forma Lánguida',de:'Hängende Form'},'tatsugiri-form'),
    '978|Tatsugiri (Stretchy)':entry(10428,'Stretchy Form',{en:'Stretchy Form',ja:'のびたすがた',es:'Forma Recta',de:'Langgestreckte Form'},'tatsugiri-form')
  });
  global.PogoPokemonStructuredForms=Object.freeze({source,entries});
})(window);
