# Core workflow specification

## A. Create intent

Open -> local/private draft -> Add -> species -> want and/or offer -> save ->
visible entry -> add another or Share. No avatar, location, friend code, priority
or account question before the first useful declaration. Production anonymous
drafting is a later permission-reviewed phase, not an auth change in this study.
Persist locally with honest 'On this device'; account save is valuable for recovery,
cross-device use and publication. Never display green server Saved for a local draft.

## B. Add and edit

Search catalog -> exact species/form -> independent want/offer controls -> Save.
Shiny is a primary toggle with sparkle. Form/costume are a single variant selector,
not two competing identities. Only species with known variants show that selector.
Background, gender and Max capability are progressive details, shown if meaningful.
Top want is optional and only meaningful for wants. Existing H/M/L survives in
advanced detail; no automatic priority conversion. No stock quantities.

Infer dex number and artwork from reviewed identity only. Never infer ownership,
shiny release, exact background, contact permission or trade legality from a sprite.
Wanted attributes can be exact, any, or unknown. Offers must state exact known
attributes; missing details make a possible match, not an exact one. Wanting an
unspecified gender differs from asserting a genderless species. Mewtwo cannot
receive a male/female badge. Unknown costume art uses a text identity, not base art.

Prototype supports choosing reviewed costumes, shiny base examples, independent
LF/FT edits, supported gender fixtures, sample Max capability controls, BG choice and top wants. It is not a full
release-eligibility or catalog ingestion engine.

## C. Share

Share -> scope (all/current selection/top wants) -> preview both directions ->
output (link/image/text) -> explicit copy/download. Keep output choice, not a Board
entity. Link publication success must precede copied/current claim. A failed update
offers retry or clearly dated old link; never silently copy stale content as new.
Public preview reveals exactly fields being shared; private notes/tags never enter it.
Image is a dated snapshot, not revocable live state. Missing images remain textual
exact identities; exported content never silently disappears. Dense image defaults
to no species names where artwork is exact; BG fallback text remains mandatory.

## D. Receive

Link -> trainer's two sides + list confirmation age -> inspect exact details ->
'Check what I can offer' -> anonymous local subset -> candidate summary/search.
No signup to read/copy. Signed-in viewer can see own matching declarations; no
cross-account private reads. Contact requires sender's explicit published method.
No account creation just to reveal whether the link is useful. Expired/private
links respond neutrally, without leaking hidden lists or owner identity.

## E. Find useful trainers

People -> chosen community (optional; no geolocation request) -> qualified mutual
results -> explanation -> inspect. Saved is one filter. Name search remains useful
with zero overlap. Unknown/stale offers cannot inflate exact counts. No new public
index without consent, rate limits, opt-out and revocation design.

## F. Understand a match

Person -> You receive / You give -> inspect variants -> select possible items ->
prepare draft. Two sets are not matched one-to-one and are not a value equivalence.
One-way results say one-way; unknown attributes say confirm. No 'you own' claims.
Viewer lacks offers? Invite explicit offers, never subtract wants from a Dex.

## G. Prepare the real trade

Selected candidates -> private checklist grouped by direction -> copy search for
each group -> check exact details in game -> copy coordination message -> hand off
to existing channel. Proposed venue is coarse, optional and not a live location.
Remote eligibility, friendship and current limits are confirmed in game; no hardcoded
old one-special-per-day rule. Marking a draft item done never removes standing intent.
Completion can later offer a separate explicit list review, with undo/tombstones.

## Special collectibles and honest strings

Exact BG: stable catalog ID, rendered approved local art only when rights and exact
match are reviewed; otherwise `{Name} · BG`. Any BG: distinct wildcard, never a
fake catalog record or exact-match count. No BG: distinct from unknown. An exact
offer satisfies an any-BG want; an any-BG offer cannot satisfy an exact want.
Private/public/image keep the distinction. New collectible types are attributes,
not permanent navigation. Asset availability cannot affect matching identity.

Search is attached to the selected set: my wants, my offers, their wants, what I
give, what I receive, session, top wants or event subset. Prototype reuses the
existing canonical serializer for species-number prefilters, explicitly labeled
'Species only' with manual checks. No inherited shiny/BG exclusions or CP cap.
Production follow-up may partition compatible groups for documented shiny/costume/
Max/BG tokens. Exact named costumes/BGs and unsupported forms stay manual. Do not
join per-item AND groups with commas and accidentally broaden semantics; compile
and test a supported query model, split oversized output, and show unknowns.
Game language is separate from UI language. Existing EN/JA/ES/DE serialization is
retained; unsupported locale is disclosed, not guessed. Trade search is not a safe
transfer string and must not imply selected Pokemon are safe to delete.

## State and accessibility contracts

Back returns to prior filter/page/scroll; edit does not change direction silently.
Save failure keeps draft; undo affects only latest explicit edit. Selection is
stable by entry ID across filters; share scope is visible. Label icon actions;
44px touch targets, visible keyboard focus, focus return/trap in modal, Escape
close, live announcements. Color is supplemental to text/symbols. Text-only art
failure remains readable. Empty/no-results/private/offline states are distinct.
