# Apri visual implementation brief

## Approved target and baseline

Implement the selected warm ivory Subtle Paper light theme and charcoal dark theme in the existing app, based on live .148 runtime `84e057be83f5de292c660324b156fd07940ec3af`. This branch is a tested preview and draft PR only; no deployment is authorized in this task. Preserve the app name, domain, routes, account behavior, public sharing, privacy, read contracts, performance budgets, and all existing Pokémon artwork.

## References inspected

Library references were materialized and their actual pixels viewed locally before implementation. Comparison `libfile_699b460eeb188191a03275f0fbb1bf37` selects the LEFT warm ivory paper surface; `libfile_43b3dbd58a98819195c591356371df4e` is the subtle paper reference. My List light/dark: `libfile_663141c69d948191a6527618ba11803b`, `libfile_914ffcbdf87c8191880f007cbfbae5bb`. Events light/dark v2: `libfile_e3d702796bb08191a9a582b63a4a520d`, `libfile_3a362768b80c8191b4442987b6b42fdb`. More: `libfile_899d282c2d70819197f825abd4cea741`, `libfile_4a0ff9a7e5408191b6a289aedd9deb9b`. Trainers v2: `libfile_e9b46dc0ab948191a5d573a81ff2894b`, `libfile_e64537e8f4208191bd7db55016bfd1bd`. Mascot: `libfile_9bf0b3ff3b708191bce8da3f3c30130e`, no smile. Reference screenshots contain illustrative content, not production data.

## Existing components and assets

- `css/app.css` owns theme tokens, shared controls, responsive shell, rows, dialogs and tab presentation. System/light/dark preferences already exist.
- `index.html` owns the top bar, main navigation, My List controls, discovery panels, More destinations and settings overlay.
- `js/app/application.js` renders existing public trainer projections, list rows and event calendar/timeline/details. Existing icon symbols and system font will be reused; no new font requests or icon runtime dependency.
- `assets/sprites/go/` and current sprite resolvers remain byte-for-byte unchanged. Generated reference Pokémon pixels must never be imported.
- Current My List uses two columns on desktop and one on phone, priority sections, Add controls, Share, Select, List tools, section copy controls and row detail actions. Preserve this structure and order.
- The current public trainer experience supports direct name lookup, Favorites and recent trainers. The mockup's global directory is not permission to create a new directory read or expose private accounts.
- Existing Events calendar/date selection, details, source freshness, time basis, conditional bonuses and featured Pokémon data will be reused.

## Implementation sequence

1. Centralize ivory/charcoal/gold tokens with readable text, button foreground, focus and semantic status colors. Keep layout dimensions and touch targets stable for My List. Paper is a static lightweight raster, never a scroll-time filter/noise generator.
2. Reuse the current header/navigation, substituting only the supplied mascot asset using the reviewed no-smile extraction (not byte-exact master pixels); preserve PoGo Trades name. Mobile retains four direct destinations including Events.
3. Present More as one profile entry and grouped account/preferences/help destinations invoking existing dialogs and actions. Preserve admin visibility and sign-out behavior.
4. Style Trainers as balanced rows within its existing authorized data flow. Show Last updated from validated public snapshot `updatedAt`, with a readable local date/time and a missing dash. Explain via accessible help that this is public snapshot publication, not last list edit/login. Do not fetch private activity or derive dates from local viewing time. Clarify direct lookup does not require Favorites.
5. Present the selected Events day with all overlapping events and real hours/bonuses/featured species. Do not invent timing, bonuses or event content. Preserve existing timezone/DST, unknown-time and freshness distinctions and details access.
6. Capture and compare light/dark at 390, tablet and 1440. Exercise 30+ realistic rows, long names, empty/loading/error/offline, keyboard/dialogs/popovers, repeat navigation, account switching, public share and analytics opt-outs. Record P0/P1/P2 fixes and any remaining limitations in `design-qa.md`.

## Asset needs

One 256×256 seamless subtle ivory paper tile and one 256×256 transparent cutout of the exact supplied no-smile Apri mascot for the header. No generated Pokémon, no replacement sprite art. Clean readable card surfaces should attenuate paper texture.

## Scope exclusions

No spreadsheet My List, new routes/models, auth changes, data writes/migrations, public-directory broadening, calendar image export, app/domain rename, invented mockup content or release gate changes.

## Feedback boundaries verified

Direct trainer lookup opens an existing shared list without first saving a Favorite. The Pokémon-demand search currently searches Favorites’ shared wanted lists; it does not establish owned inventory or global community demand. The revised copy makes those differences explicit. An empty result is not advice to transfer a Pokémon. Broader discovery, opt-in directory/location filters, and a calendar image export are separate future decisions.

The user subsequently prioritized design before new login. Existing sign-in remains unchanged; provider onboarding screens, proposed registration flows, provider configuration and auth-owner changes are excluded from this branch.
