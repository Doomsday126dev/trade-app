# Wants-only product follow-up

## Scope

Candidate release: `2026-09-05.91`, from accepted `.90` source
`f59bed3529f4c44d71df6b05518c08ac68da8a2e`. No prototype runtime merged.

My List is a wants list with preserved priority, exact variant qualifiers,
notes and selection. For Trade is not an active product workflow. Desktop
navigation remains My List / Trainers / Events / More; mobile remains
My List / Trainers / More, with Events available through More.

Search-copy is visible above My List, with filtered, Top wants and selected
scopes. Published trainer wants expose category-scoped search without signing
in. Queries remain localized species prefilters, split at the existing size
limit. Manual verification lists retain unresolved entries. Exact costume,
form, shiny status and trade eligibility must be checked in the game.

Share retains Full list -> Link / Image / Text; Top wants and Selected ->
Image / Text. Subset flows cannot copy a full-list public URL. Publication
failure remains distinct from successful clipboard copy.

## Data decision

A read-only production audit on 2026-09-05 examined 59 legacy user records and
3 canonical account roots. One non-obviously-synthetic legacy Board contained
one FT entry, and one canonical account contained one FT entry. These may
represent the same trainer. They were not classified as disposable test data.
No audit writes were made. All stored FT records are retained inertly.

The presentation adapter and anonymous v1/v2 renderer expose wants only.
New normal-product publications omit FT. The old public envelope/parser remains
readable; no background republish, deletion or migration of old public records
is performed. No private viewer reads were added.

Pokemon backgrounds have no active picker, badge, visual overlay or search/share
qualifier. Stored encodings remain parseable so an unrelated wants edit does not
damage historical records. No background data migration was introduced.

Canonical schema, Auth UID, recovery receipts, recovery66, PIN reset, provider
configuration and PR #63 operator workflows are untouched. Canonical transport
fixtures verify persistence, inert FT preservation and wants-only publication.
They do not mutate ordinary production users.

## Costume review

The existing reviewed catalog has 376 records: 355 exact, 21 unavailable, with
462 distinct locally integrity-checked assets. Canonical alias coverage includes
402 exact costume selector identities and 21 unavailable identities. Both add
selectors now exclude unavailable identities, including Worlds 2026 Pikachu and
Cosmog Spacesuit Pikachu. Exact identity metadata remains available internally.

The 127-page accepted-source freshness check found no new assets relative to the
2026-08-30 snapshot. No base-art substitution or newly unreviewed image source was
introduced. Existing saved unsupported identities are not silently deleted.

Sources reviewed:
- https://pokemondb.net/sprites/pikachu
- https://pokemondb.net/about
- https://archives.bulbagarden.net/wiki/Archives:Copyrights

Bulbagarden image availability is not treated as a reusable image license;
its copyright page says most images are claimed under fair use, not licensed.
No assets were copied from that source.

## Removed and retained

Deleted LF/FT editing controls, FT publication tabs, inventory page and entry
points, offer/acceptance modal markup and eleven retired rendering functions,
background picker/handlers, background badges/overlays and public BG rendering.
The Board is still a selection of wants, not a second editable model.

Advanced category tools remain for bulk priority/flags, import, speed-add and
reordering. They operate on wants and retain historical H/M/L information.
Inert storage parsers and inaccessible legacy data helpers are retained where
deleting them would enlarge this bounded frontend release into storage work.

## Qualification and next direction

Focused qualification covers scope/copy failures, v1/v2 anonymous privacy,
canonical mutation and IndexedDB reopen, exact-art selector gating, localization,
Board image export, navigation and responsive layouts. Existing release and
large-list performance gates are required before deployment. Final PR/deployment
identities and smoke evidence belong in the PR closeout.

Next: build private Groups/Circles from Favorites and private tags, after observing
this wants-only release. Membership should reference trainers, not copy or own
their lists. Group search must use only each member's currently permitted public
wants and report inaccessible/stale members without fetching private lists.
