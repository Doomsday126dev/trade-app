# Local Trade Intent Prototype

Non-production design study. No Firebase SDK, service worker, auth session,
production API, contact delivery or account data. Trainers and groups are fictional.
The study source is [docs/trade-intent-study](../../docs/trade-intent-study/README.md).

## Run

From repository root:

```sh
python3 -m http.server 8912 --bind 127.0.0.1 --directory prototypes/trade-intent-study
```

Open <http://127.0.0.1:8912/>. Serve only this directory, never the whole release
checkout, which may contain unrelated operator files. The current study session
already has this server running. Do not deploy this prototype to production Pages.

## Routes and interactions

| Route | Review |
|---|---|
| `#list` | Combined wants/offers, Add, filtering, rows/grid, selection, share |
| `#people` | Mutual candidates, saved people, community and freshness |
| `#match/mira` | Independent receive/give sets, details, prepare, copy search |
| `#public` | Anonymous recipient and local possible-offer selection |
| `#session` | Private checklist, directional searches and coordination text |
| `#large` | 300 real catalog variants, 60 per page, read-only scale fixture |
| `#special` | Costume/shiny/gender/BG examples and unavailable artwork |
| `#empty` | New trainer starts directly with Add |
| `#concepts` | Structural comparison and links to all three concepts |
| `?concept=b#people` | Opportunity-first navigation and landing |
| `?concept=c#session` | Session-first navigation and landing |

Local edits persist under `pogo-intent-study-v1` on this origin. Account menu can
restore the demo list or undo the latest edit. No credentials are involved. Ordinary
grid imagery is label-free; click or use compact rows for exact identity text.

Add permits want, offer or both. Duplicate exact declarations merge sides. Base
shiny entries retain the base variant in the editor. Sample Max controls demonstrate
progressive qualification, not a complete species/release eligibility engine.
Chicago BG is a Mewtwo fixture; no unapproved background image is supplied.

## Assets

396 representative catalog identities, not a complete or auto-updating GO catalog.
355 existing reviewed costume records, 40 bounded PokeAPI HOME images and one
unavailable Worlds 2026 Pikachu example. Existing costume bytes are reused;
`prepare.cjs` records their paths and bounded source requests. PokeAPI's source
README permits sprite downloading, with the upstream license retained in vendor.
Pokemon imagery remains the respective rights holders' property. No rights to new
GO background artwork or competitor assets are inferred.

`asset-manifest.json` records local asset digests. Visible alpha bounds normalize
CSS and image-export placement; original image files are not modified. A missing
exact image produces text, never base-species substitution or a question mark.

Assets are already included. `node prototypes/trade-intent-study/prepare.cjs` is
optional regeneration and requires network for its bounded PokeAPI downloads.

## Verify

Use the repository's existing Playwright dependency/browser installation:

```sh
npm test --prefix prototypes/trade-intent-study
node prototypes/trade-intent-study/verify.cjs
```

The browser check needs the local server. It blocks and records any non-local
request, writes screenshots and a verification report to the study docs. Clipboard
and download checks use a fresh test browser, not an owner browser or account.

## Not implemented

Publication and account synchronization; provider onboarding; production discovery
index/consent enforcement; complete catalog and Max eligibility; exact game-query
compilation for every qualifier; delivery to another trainer; negotiated trade value.
Link output opens the synthetic recipient example, not a published selected list.
English UI offers four existing game-query locales. Session checks are ephemeral;
they do not consume inventory or edit standing intent. See the evidence document
for the distinction between working interactions and future product contracts.
