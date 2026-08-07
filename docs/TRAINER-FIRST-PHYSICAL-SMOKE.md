# Trainer-first physical-device smoke

Status: externally pending. Do not mark a row passed without running it on the named physical device and installed mode.

## Shared prerequisites

- Confirm the live release ID and first-party asset versions are coherent before testing.
- Use a normal test account without changing identities, PINs, server gates, or feature flags.
- Keep synced trainer preferences and share visibility disabled.
- Record device, OS, browser version, installed/browser mode, timestamp, and tester.
- Stop on any Firebase preference write, callable invocation, automatic publication, mixed-version load, or private-data exposure.

## iPhone Safari

- Sign in, switch among English, Japanese, Spanish, and German, then reload.
- Add and remove a temporary My List entry; confirm autocomplete, keyboard, and 48 px targets.
- Open Find Trainer with the keyboard visible; test suggestions above and below the field.
- Open and close Settings; verify scroll and focus restoration.
- Review Events filters and cards at portrait width.
- Confirm Legacy Inventory opens only through Account > Tools and remains read-only.
- Verify no horizontal overflow with long German and Japanese labels.

## Installed iOS PWA

- Launch cold and warm; confirm the current release and coherent service-worker activation.
- Repeat My List autocomplete, Find Trainer, Settings, and Events checks with the keyboard open.
- Background and foreground the app; confirm no sync, migration, queue drain, or publication starts.
- Confirm safe-area padding and internal sheet scrolling.

## Android Chrome

- Repeat locale switching, My List, Find Trainer, Settings, Events, and Legacy Inventory checks.
- Verify Back closes overlays before leaving the current product journey.
- Test voice input availability and localized feedback without changing canonical Pokémon search terms.
- Confirm no horizontal overflow at narrow portrait widths.

## Installed Android PWA

- Launch cold and warm; confirm release/cache coherence and no update loop.
- Test keyboard-open autocomplete and Settings sheet behavior.
- Background and foreground the app; verify local-only behavior remains unchanged.
- Confirm the manifest has no Legacy Inventory shortcut.

## Closeout

- Remove temporary local list, Favorite, tag, and note changes.
- Record console errors, network observations, Firebase read/write observations, and any externally pending checks.
- Do not infer a pass for one platform from another platform's result.
