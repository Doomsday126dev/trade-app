# Direct mobile Events navigation — local review

The phone menu hid Events at widths up to700px, rendered only three grid columns, and marked More selected when Events was active. Events was reachable only through More. This was deliberate responsive behavior, not cache/device failure.

The narrow candidate makes My List / Trainers / Events / More consistently available, uses four equal mobile columns, and selects Events for its actual page. The redundant Events shortcut is removed from More; Profile, Settings and permitted Admin access remain there. Existing routes, colors, icons and app logic outside navigation remain unchanged. Tab switching continues the existing history behavior; no routes or history entries were added.

Six browser cases passed at390/700/701px in Chromium and WebKit: all four destinations visible, direct Events selection, More/My List return and correct selected states, keyboard Enter activation, minimum44px targets, no horizontal overflow and no duplicate More action. The390px rendered screenshot was inspected. Synthetic session only; no real account/data writes or physical device claim.

Local branch `fix/mobile-events-navigation`, based on `.143` runtime `d40923bc02f5f6e7953e91d44c19e8368c4a9b54`. Not part of PR172 or its immutable release artifact. No push/deployment for this candidate yet.
