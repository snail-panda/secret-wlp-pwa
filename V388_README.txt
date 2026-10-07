WLP v1.8.6.388 · stale official-card bootstrap exact-action Cloud reconcile

Purpose
- Fix iPhone stale official-card bootstrap retry collision after another device already committed the same deterministic bootstrap action to Canonical Cloud.

Core changes
1) Before re-sending a pending official-card bootstrap, query Cloud by the exact deterministic actionId.
2) If Cloud already has the validated cards + card_content pair, materialize those Cloud rows locally and delete only the matching stale local bootstrap outbox rows; do not send a duplicate INSERT RPC.
3) Reconciliation may use Cloud change rows older than the local cursor without regressing the cursor.
4) Cursor ACK / retry continuation use the preserved committed cursor.
5) If a card_classification row is already mirrored locally for the reconciled card, re-materialize its Classification metadata after the card core becomes available.
6) Keep v386 receiver backlog continuation.

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
