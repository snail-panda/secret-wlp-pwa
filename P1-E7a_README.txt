WLP P1-E7a — Normal Home > Study > New Local Library source (optional, per-browser)
Source baseline: secret-wlp-pwa-clean(20261009-233312).zip (E6c deployed baseline)
Branch: stage7-app-ui

APPLY ONLY 4 FILES (relative to deployed site root):
  deck-browser.js
  deck-browser.html
  flashcards/wlp/app.js
  flashcards/wlp/batch.html
DO NOT overwrite any other files from an old package.

What changes:
- A normal Home > Study > Choose a Deck page gets a New-only source selector.
  Starts Standard on every browser until explicitly enabled. Selecting Local verifies
  the account-bound Canonical Mirror before saving a per-browser setting.
- While Local New is selected, New's deck browsing and search read the verified Mirror;
  a chosen deck uses the already-tested E5 Local queue + Canonical writer. It stays
  enabled across normal Study page visits on that browser.
- Continue and Review remain on the existing paths and tabs; no changes to Study Entry.
- Return from a Local New card goes to the normal Choose a Deck (all three tabs).
- Switching New back to Standard checks that the E5 intent journal and Canonical
  outbox are empty; a pending write blocks the switch without deleting anything.
- The E6c HTML cache warmer remains in place; app.js cache URL is bumped with its
  own exact reference in the E6c verification logic. Service Worker remains unchanged.

DO NOT DEPLOY E6 OR E6a (they change Service Worker).
No SQL. No Master TSV edit. No PWA cache or IndexedDB deletion.

First manual check after deploy: PC Brave, ONLINE, new tab:
  https://stage7-app-ui--secret-wlp-pwa.netlify.app/
  Click Study -> New: Continue and Review must still be enabled.
  Click 'Use Local Library for New': expect successful Mirror verification / reload.
  New: search / choose WLP004, view WID32 smattering, flip card.
  Choose a Deck return: expect normal Study tabs, New remains Local.
  Do not write Studied/Review just for this initial UI inspection.
  If Local reader/writer blocks, stop and report the message. No silent TSV fallback.
  Wait for a separate targeted offline verification before calling E7 fully complete.

Rollback (files only): replace these 4 files with originals from the source baseline
ZIP and Commit/Push. Do not clear any local data, Outbox or Service Worker cache.
Browser's E7 New preference may remain; reset it through the UI when Queue/Outbox
are confirmed clear, BEFORE reverting code. No source cutover applies automatically
without that explicit preference.

Tests performed: Chromium DOM-based source switch / tabs / E5 URL / Mirror rejection /
Queue and Outbox guards / syntax checks / original-archive diff. These tests do
NOT prove live Supabase, production SW refresh, or actual Brave/iPhone behavior.
