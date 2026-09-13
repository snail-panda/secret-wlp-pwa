WLP Stage 6A.1 — PWA Foundation

PURPOSE
This is a separate PWA development copy. Do NOT overwrite the existing stable WLP Web deployment.

WHAT CHANGED
- Added manifest.webmanifest
- Added service-worker.js
- Added pwa-register.js
- Added 192px / 512px PWA icons and 180px Apple touch icon
- Added PWA/iOS metadata to index.html and batch.html
- Added basic offline caching for the app shell, flashcard UI, and Master TSV

WHAT DID NOT CHANGE
- Existing Master TSV content
- Existing deck/card logic
- Draft/local-addition logic
- Local Override/Revert logic
- Progress/Review behavior
- Guest/Admin UI behavior and password logic
- Existing WLP Central / Phrasal Verbs / Media Language UI
- No card shuffling or data migration

DEPLOYMENT
Deploy this folder as a NEW/SEPARATE HTTPS site (or separate development deployment).
Do not copy it over the current stable site.
Service workers require HTTPS in normal deployment.

FIRST iPHONE TEST
1. Open the NEW PWA development URL in Safari while online.
2. Let the first page finish loading once so the offline cache can be installed.
3. Share > Add to Home Screen.
4. Launch WLP from the new Home Screen icon.
5. Verify it opens without normal Safari chrome.
6. Open a few decks and test existing controls.
7. Turn off network access and relaunch/test a previously normal deck.

NOTE
The current Admin mode remains UI-level protection only. PWA conversion itself does not create real server-side authentication.
