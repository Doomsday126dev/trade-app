# Historical source contracts

These eight files are byte-identical to commit `c3fd690a2a2c46dab448873b244e496199283694` (release `.100`), verified against `../source-contracts.json` on every fixture load. They construct and independently validate the historical offline archive proof; the archive reader does not execute them. Vendoring makes this proof reproducible in shallow CI checkouts without relabeling historical provenance as the current runtime. Current runtime compatibility requires separate tests; this proof does not establish production backup or restore support.
