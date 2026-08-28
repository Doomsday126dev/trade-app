// Repository-owned primary-type snapshot generated from the PokeAPI canonical CSV.
// Source: https://github.com/PokeAPI/pokeapi/blob/master/data/v2/csv/pokemon_types.csv
(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const TYPES=Object.freeze([
    null,"grass","grass","grass","fire","fire","fire","water","water","water","bug","bug","bug","bug","bug","bug","normal","normal","normal","normal","normal","normal","normal","poison",
    "poison","electric","electric","ground","ground","poison","poison","poison","poison","poison","poison","fairy","fairy","fire","fire","normal","normal","poison","poison","grass","grass","grass","bug","bug",
    "bug","bug","ground","ground","normal","normal","water","water","fighting","fighting","fire","fire","water","water","water","psychic","psychic","psychic","fighting","fighting","fighting","grass","grass","grass",
    "water","water","rock","rock","rock","fire","fire","water","water","electric","electric","normal","normal","normal","water","water","poison","poison","water","water","ghost","ghost","ghost","rock",
    "psychic","psychic","water","water","electric","electric","grass","grass","ground","ground","fighting","fighting","normal","poison","poison","ground","ground","normal","grass","normal","water","water","water","water",
    "water","water","psychic","bug","ice","electric","fire","bug","normal","water","water","water","normal","normal","water","electric","fire","normal","rock","rock","rock","rock","rock","normal",
    "ice","electric","fire","dragon","dragon","dragon","psychic","psychic","grass","grass","grass","fire","fire","fire","water","water","water","normal","normal","normal","normal","bug","bug","bug",
    "bug","poison","water","water","electric","fairy","normal","fairy","fairy","psychic","psychic","electric","electric","electric","grass","water","water","rock","water","grass","grass","grass","normal","grass",
    "grass","bug","water","water","psychic","dark","dark","water","ghost","psychic","psychic","normal","bug","bug","normal","ground","steel","fairy","fairy","water","bug","bug","bug","dark",
    "normal","normal","fire","fire","ice","ice","water","water","water","ice","water","steel","dark","dark","water","ground","ground","normal","normal","normal","fighting","fighting","ice","electric",
    "fire","normal","normal","electric","fire","water","rock","rock","rock","psychic","fire","psychic","grass","grass","grass","fire","fire","fire","water","water","water","dark","dark","normal",
    "normal","bug","bug","bug","bug","bug","water","water","water","grass","grass","grass","normal","normal","water","water","psychic","psychic","psychic","bug","bug","grass","grass","normal",
    "normal","normal","bug","bug","bug","normal","normal","normal","fighting","fighting","normal","rock","normal","normal","dark","steel","steel","steel","steel","fighting","fighting","electric","electric","electric",
    "electric","bug","bug","grass","poison","poison","water","water","water","water","fire","fire","fire","psychic","psychic","normal","ground","ground","ground","grass","grass","normal","dragon","normal",
    "poison","rock","rock","water","water","water","water","ground","ground","rock","rock","rock","rock","water","water","normal","normal","ghost","ghost","ghost","ghost","grass","psychic","dark",
    "psychic","ice","ice","ice","ice","ice","water","water","water","water","water","dragon","dragon","dragon","steel","steel","steel","rock","ice","steel","dragon","dragon","water","ground",
    "dragon","steel","psychic","grass","grass","grass","fire","fire","fire","water","water","water","normal","normal","normal","normal","normal","bug","bug","electric","electric","electric","grass","grass",
    "rock","rock","rock","rock","bug","bug","bug","bug","bug","electric","water","water","grass","grass","water","water","normal","ghost","ghost","normal","normal","ghost","dark","normal",
    "normal","psychic","poison","poison","steel","steel","rock","psychic","normal","normal","ghost","dragon","dragon","dragon","normal","fighting","fighting","ground","ground","poison","poison","poison","poison","grass",
    "water","water","water","grass","grass","dark","electric","normal","ground","grass","electric","fire","fairy","bug","grass","ice","ground","ice","normal","psychic","rock","ghost","ice","electric",
    "psychic","psychic","psychic","steel","water","fire","normal","ghost","psychic","water","water","dark","grass","normal","psychic","grass","grass","grass","fire","fire","fire","water","water","water",
    "normal","normal","normal","normal","normal","dark","dark","grass","grass","fire","fire","water","water","psychic","psychic","normal","normal","normal","electric","electric","rock","rock","rock","psychic",
    "psychic","ground","ground","normal","fighting","fighting","fighting","water","water","water","fighting","fighting","bug","bug","bug","bug","bug","bug","grass","grass","grass","grass","water","ground",
    "ground","ground","fire","fire","grass","bug","bug","dark","dark","psychic","ghost","ghost","water","water","rock","rock","poison","poison","dark","dark","normal","normal","psychic","psychic",
    "psychic","psychic","psychic","psychic","water","water","ice","ice","ice","normal","normal","electric","bug","bug","grass","grass","water","water","water","bug","bug","grass","grass","steel",
    "steel","steel","electric","electric","electric","psychic","psychic","ghost","ghost","ghost","dragon","dragon","dragon","ice","ice","ice","bug","bug","ground","fighting","fighting","dragon","ground","ground",
    "dark","dark","normal","normal","normal","dark","dark","fire","bug","dark","dark","dark","bug","bug","steel","rock","grass","flying","electric","dragon","dragon","ground","dragon","water",
    "normal","bug","grass","grass","grass","fire","fire","fire","water","water","water","normal","normal","normal","fire","fire","bug","bug","bug","fire","fire","fairy","fairy","fairy",
    "grass","grass","fighting","fighting","normal","psychic","psychic","steel","steel","steel","fairy","fairy","fairy","fairy","dark","dark","rock","rock","poison","poison","water","water","electric","electric",
    "rock","rock","rock","rock","fairy","fighting","electric","rock","dragon","dragon","dragon","steel","ghost","ghost","ghost","ghost","ice","ice","flying","flying","fairy","dark","dragon","rock",
    "psychic","fire","grass","grass","grass","fire","fire","fire","water","water","water","normal","normal","normal","normal","normal","bug","bug","bug","fighting","fighting","fire","bug","bug",
    "rock","rock","water","poison","poison","ground","ground","water","water","grass","grass","grass","grass","poison","poison","normal","normal","grass","grass","grass","fairy","normal","fighting","bug",
    "bug","ghost","ghost","water","normal","normal","rock","normal","fire","electric","ghost","water","normal","ghost","dragon","dragon","dragon","electric","psychic","grass","water","psychic","psychic","psychic",
    "psychic","rock","bug","bug","electric","steel","grass","dark","psychic","steel","fighting","poison","poison","rock","fire","electric","steel","steel","grass","grass","grass","fire","fire","fire",
    "water","water","water","normal","normal","flying","flying","flying","bug","bug","bug","dark","dark","grass","grass","normal","normal","water","water","electric","electric","rock","rock","rock",
    "grass","grass","grass","ground","ground","flying","water","water","electric","electric","fire","fire","fighting","fighting","ghost","ghost","psychic","psychic","psychic","dark","dark","dark","dark","steel",
    "ghost","fighting","ice","ground","fairy","fairy","fighting","electric","ice","ice","rock","ice","psychic","electric","steel","steel","electric","electric","water","water","steel","dragon","dragon","dragon",
    "fairy","fighting","poison","fighting","fighting","dark","electric","dragon","ice","ghost","psychic","normal","bug","ground","water","fighting","dark","fairy","grass","grass","grass","fire","fire","fire",
    "water","water","water","normal","normal","bug","bug","bug","bug","electric","electric","electric","normal","normal","fairy","fairy","grass","grass","grass","normal","rock","rock","rock","fire",
    "fire","fire","electric","electric","electric","electric","dark","dark","poison","poison","grass","grass","ground","ground","rock","grass","grass","bug","bug","psychic","psychic","fairy","fairy","fairy",
    "water","water","flying","water","water","steel","steel","dragon","steel","rock","rock","ghost","ghost","flying","ice","ice","water","water","dragon","fighting","poison","normal","normal","dark",
    "ground","fairy","grass","ghost","bug","electric","ground","ice","fighting","dark","fire","rock","dragon","dragon","dragon","ghost","steel","dark","dark","dark","dark","dragon","fairy","fighting",
    "electric","water","grass","grass","grass","grass","poison","poison","poison","grass","steel","grass","fire","electric","rock","steel","normal","poison"
  ]);
  const VALID_TYPES=Object.freeze(["normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"]);
  function primaryTypeForDex(value){
    const dex=Number(value);
    return Number.isSafeInteger(dex)&&dex>0&&dex<TYPES.length?TYPES[dex]||"":"";
  }
  root.pokemonPrimaryTypes=Object.freeze({schemaVersion:1,sourceRevision:"2026-08-28",count:TYPES.length-1,types:TYPES,validTypes:VALID_TYPES,primaryTypeForDex});
})(window);
