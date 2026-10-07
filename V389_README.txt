WLP v1.8.6.389 · Classification overlay projection repair + gap-safe stale-bootstrap reconciliation

Purpose
- Fix iPhone Classification count/local projection remaining at 6550 even after v388 removed the stale official-card bootstrap collision.
- Repair any new official cards/content/classification rows that were already committed to Canonical Cloud but were skipped locally because an out-of-band stale-bootstrap reconciliation moved the local cursor past unseen change rows.

Root cause found in v388
- receiver-reconcile used max(cursorBefore, remoteBootstrap.seqMax).
- If the exact Cloud bootstrap being reconciled was ahead of the current cursor (for example WID7050), the cursor could jump over earlier unseen actions.
- Classification Editor count is based on localStorage Classification projection, not the Cloud row count, so skipped card_classification rows could remain absent even though Cloud was complete.

Core changes
1) Gap-safe stale-bootstrap reconcile: receiver-reconcile never advances the committed cursor out-of-band. It clears the stale local bootstrap using validated Cloud rows while preserving the prior cursor so normal receiver processing cannot skip intervening actions.
2) Classification-page overlay repair: on receiver load, fetch the latest incremental Cloud rows for cards, card_content, and card_classification independent of cursor; idempotently materialize them into the local Canonical mirror.
3) Rebuild the local Classification projection from the latest Canonical card_classification overlay in one localStorage write, preserving a genuinely newer local record by updatedAt.
4) Refresh local mirror fingerprint metadata without changing the sync cursor.
5) Existing v388 exact-action stale-bootstrap Cloud reconciliation and v386 backlog continuation remain in place.

Files
- canonical-auto-sync-canary.js OVERWRITE
- deck-browser.html OVERWRITE (cache-bust only)
- editor-classification.html OVERWRITE (cache-bust only)
- editor-learning-metadata.html OVERWRITE (cache-bust only)
- editor-local-edit.html OVERWRITE (cache-bust only)
- index.html OVERWRITE (cache-bust only)
- progress.html OVERWRITE (cache-bust only)
- review.html OVERWRITE (cache-bust only)
- study-hub.html OVERWRITE (cache-bust only)

No SQL changes.
Service Worker untouched.
Bottom Nav logic untouched.
Master untouched.
