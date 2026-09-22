# Search policy implementation proof

This proof covers the bounded A1/A4/A5 search-policy change on the `.115` review stack before integration with the accepted `.117` baseline.

## Contract tests

```text
node --test tests/search-policy-contract.test.cjs tests/contextual-intent-search.test.cjs tests/my-list-priority-sections.test.cjs tests/pokemon-go-search-syntax.test.cjs tests/i18n.test.cjs tests/public-share-localization.test.cjs
71 tests passed, 0 failed
```

The independent expected strings cover English, Japanese, Spanish, and German. They verify protected ordinary searches, broad special searches, mixed-list splitting, explicit game-language preference, and the absence of contradictory Shiny/Lucky/size filters.

## Real-browser proof

Chrome was launched through Playwright against a local-only server with all external requests aborted. The proof used actual My List buttons, a synthetic public-only Who provider, and the anonymous public-share renderer.

```json
{
  "sections": [
    {"locale":"en","section":"H","actual":"!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25"},
    {"locale":"en","section":"SHINY","actual":"!traded&1"},
    {"locale":"ja","section":"H","actual":"!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&25"},
    {"locale":"ja","section":"SHINY","actual":"!こうかん&1"},
    {"locale":"es","section":"H","actual":"!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&25"},
    {"locale":"es","section":"SHINY","actual":"!intercambiados&1"},
    {"locale":"de","section":"H","actual":"!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25"},
    {"locale":"de","section":"SHINY","actual":"!getauscht&1"}
  ],
  "mixed": [
    "!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25",
    "!traded&1"
  ],
  "who": {
    "before":"!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25",
    "after":"!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25"
  },
  "public": {
    "ui":"en",
    "query":"!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25"
  },
  "errors": []
}
```

The Who result changed immediately when the game-search language changed from English to German. The anonymous public page kept its English interface while emitting the explicitly selected German Pokémon GO query.
