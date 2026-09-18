(() => {
  'use strict';

  const form = document.getElementById('new-card-form')
    || document.getElementById('draft-edit-form')
    || document.getElementById('local-edit-form');
  const word = document.getElementById('new-card-word')
    || document.getElementById('draft-edit-word')
    || document.getElementById('local-edit-word');
  const source = document.getElementById('reference-source');
  const lookup = document.getElementById('reference-lookup-button');
  const status = document.getElementById('reference-assist-status');
  const preview = document.getElementById('reference-preview');
  const fieldsMount = document.getElementById('reference-preview-fields');
  const apply = document.getElementById('reference-preview-apply');
  const cancel = document.getElementById('reference-preview-cancel');
  const controls = document.querySelector('.reference-assist-controls');
  if (!form || !word || !source || !lookup || !status || !preview || !fieldsMount || !controls) return;

  // The WLP card headword and the dictionary lookup term are intentionally
  // separate. Phrase cards can keep their WLP wording while looking up a
  // lexical core such as "concord" for a card headed "in concord".
  const queryField = document.createElement('label');
  queryField.className = 'new-card-field reference-query-field';
  queryField.innerHTML = '<span class="reference-query-label"><span>Lookup term</span><button type="button" class="reference-query-reset" hidden>Use Word</button></span><input id="reference-lookup-term" type="text" autocomplete="off" spellcheck="false" aria-label="Dictionary lookup term">';
  controls.insertBefore(queryField, lookup);
  const queryInput = queryField.querySelector('#reference-lookup-term');
  const queryReset = queryField.querySelector('.reference-query-reset');

  // Manual web research stays user-controlled: open Google with the current
  // Lookup term, without scraping or importing anything automatically.
  const googleSearch = document.createElement('button');
  googleSearch.type = 'button';
  googleSearch.className = 'reference-google-button';
  googleSearch.innerHTML = '<span>Google Search</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5"></path><path d="M10 14 19 5"></path><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path></svg>';
  lookup.insertAdjacentElement('afterend', googleSearch);

  let queryDirty = false;

  const syncQueryReset = () => {
    const cardWord = String(word.value || '').trim();
    const query = String(queryInput.value || '').trim();
    queryReset.hidden = !cardWord || query === cardWord;
  };
  const syncQueryFromWord = () => {
    if (!queryDirty) queryInput.value = String(word.value || '').trim();
    syncQueryReset();
  };
  queryInput.value = String(word.value || '').trim();
  word.addEventListener('input', syncQueryFromWord);
  queryInput.addEventListener('input', () => {
    queryDirty = String(queryInput.value || '').trim() !== String(word.value || '').trim();
    syncQueryReset();
  });
  queryReset.addEventListener('click', () => {
    queryDirty = false;
    queryInput.value = String(word.value || '').trim();
    syncQueryReset();
    queryInput.focus();
  });

  googleSearch.addEventListener('click', () => {
    const lookupTerm = String(queryInput.value || '').trim();
    if (!lookupTerm) {
      showStatus('Enter a Lookup term first, then search Google.');
      queryInput.focus();
      return;
    }
    const url = `https://www.google.com/search?q=${encodeURIComponent(lookupTerm)}`;

    // Open manual web research in a separate tab without ever navigating the
    // current WLP editor page. On iOS/Safari, window.open(..., 'noopener') can
    // legitimately return null even when a new tab opened; using that return
    // value as a fallback signal caused both a new Google tab AND the current
    // editor tab to navigate away. A real target=_blank link avoids that race.
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  const mode = form.id === 'new-card-form' ? 'new' : (form.id === 'draft-edit-form' ? 'draft-edit' : 'local-edit');
  const noun = mode === 'new' ? 'Draft' : (mode === 'draft-edit' ? 'Draft' : 'Local Edit');

  const providers = {
    'merriam-webster': {
      label: 'Merriam-Webster',
      configured: true,
      async lookup(headword) {
        const response = await fetch(`/.netlify/functions/merriam-webster?word=${encodeURIComponent(headword)}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store'
        });
        let data = {};
        try { data = await response.json(); } catch {}
        if (!response.ok) throw new Error(data.error || 'lookup-failed');
        return data;
      }
    },
    collins: {
      label: 'Collins Dictionary',
      configured: false,
      async lookup() { throw new Error('provider-not-configured'); }
    }
  };

  const showStatus = (message) => {
    status.replaceChildren();
    status.textContent = message;
    status.hidden = false;
  };

  const lookupCandidates = (cardWord, apiSuggestions = []) => {
    const out = [];
    const add = value => {
      const clean = String(value || '').trim();
      if (clean && clean.toLowerCase() !== String(cardWord || '').trim().toLowerCase() && !out.some(item => item.toLowerCase() === clean.toLowerCase())) out.push(clean);
    };
    apiSuggestions.slice(0, 4).forEach(add);
    const parts = String(cardWord || '').trim().split(/\s+/).filter(Boolean);
    const removable = new Set(['in','on','at','by','for','from','with','without','of','to','into','onto','over','under','through','across','around','about','after','before','between','among','against','within','beyond','upon','off','out','up','down','as','the','a','an']);
    if (parts.length > 1 && removable.has(parts[0].toLowerCase())) add(parts.slice(1).join(' '));
    return out.slice(0, 5);
  };

  const showNoResult = (cardWord, lookupTerm, suggestions = []) => {
    status.replaceChildren();
    const copy = document.createElement('div');
    copy.textContent = `No exact Merriam-Webster entry was returned for “${lookupTerm}”. Your ${noun} has not been changed.`;
    status.appendChild(copy);
    const candidates = lookupCandidates(cardWord, suggestions);
    if (candidates.length) {
      const wrap = document.createElement('div');
      wrap.className = 'reference-retry-options';
      const label = document.createElement('span');
      label.textContent = 'Try another lookup term:';
      wrap.appendChild(label);
      candidates.forEach(candidate => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reference-retry-chip';
        button.textContent = candidate;
        button.addEventListener('click', () => {
          queryDirty = true;
          queryInput.value = candidate;
          syncQueryReset();
          lookup.click();
        });
        wrap.appendChild(button);
      });
      status.appendChild(wrap);
    }
    const hint = document.createElement('div');
    hint.className = 'reference-query-hint';
    hint.textContent = 'You can also edit Lookup term above and try again. The card Word will stay unchanged.';
    status.appendChild(hint);
    status.hidden = false;
  };

  const clearConflict = () => document.getElementById('reference-conflict')?.remove();
  const clearPreview = () => {
    clearConflict();
    preview.hidden = true;
    fieldsMount.replaceChildren();
  };

  const setBusy = (busy) => {
    lookup.disabled = busy;
    lookup.textContent = busy ? 'Looking Up…' : 'Look Up';
  };

  lookup.addEventListener('click', async () => {
    clearPreview();
    const cardWord = String(word.value || '').trim();
    const lookupTerm = String(queryInput.value || '').trim();
    if (!cardWord) {
      showStatus('Enter a Word or phrase first, then look it up.');
      word.focus();
      return;
    }
    if (!lookupTerm) {
      showStatus('Enter a Lookup term first. The card Word can stay as it is.');
      queryInput.focus();
      return;
    }
    const provider = providers[source.value];
    if (!provider?.configured) {
      showStatus(`${provider?.label || 'This source'} is not connected yet. Your ${noun} has not been changed.`);
      return;
    }
    setBusy(true);
    showStatus(`Looking up “${lookupTerm}”…`);
    try {
      const data = await provider.lookup(lookupTerm);
      if (!data.found) {
        showNoResult(cardWord, lookupTerm, data.suggestions || []);
        return;
      }
      renderPreview(data, { cardWord, lookupTerm });
    } catch (error) {
      const message = String(error?.message || '');
      showStatus(message.includes('API keys are not available')
        ? 'Merriam-Webster is connected, but its API keys are not available to this deploy context yet.'
        : `The Merriam-Webster lookup could not be completed. Your ${noun} has not been changed.`);
    } finally {
      setBusy(false);
    }
  });

  const mapping = [
    ['Part of Speech', 'pos'],
    ['Definition', 'definition'],
    ['Synonym(s)', 'synonyms'],
    ['Example Sentence', 'example'],
    ['IPA', 'ipa']
  ];

  function renderPreview(data = {}, context = {}) {
    fieldsMount.replaceChildren();
    clearConflict();
    mapping.forEach(([label, key]) => {
      const value = String(data[key] || '').trim();
      if (!value) return;
      const row = document.createElement('label');
      row.className = 'reference-preview-field';
      row.innerHTML = '<input type="checkbox" data-reference-key="" checked><span class="reference-preview-label"></span><span class="reference-preview-value"></span>';
      row.querySelector('input').dataset.referenceKey = key;
      row.querySelector('.reference-preview-label').textContent = label;
      row.querySelector('.reference-preview-value').textContent = value;
      row.dataset.value = value;
      row.dataset.formName = label;
      fieldsMount.appendChild(row);
    });
    const cardWord = String(context.cardWord || '').trim();
    const lookupTerm = String(context.lookupTerm || '').trim();
    if (lookupTerm && cardWord && lookupTerm.toLowerCase() !== cardWord.toLowerCase()) {
      const provenance = document.createElement('div');
      provenance.className = 'reference-lookup-provenance';
      provenance.innerHTML = '<strong>Looked up as</strong><span></span>';
      provenance.querySelector('span').textContent = lookupTerm;
      fieldsMount.appendChild(provenance);
    }
    if (data.related) {
      const note = document.createElement('div');
      note.className = 'reference-related-note';
      note.innerHTML = '<strong>Related words</strong><span></span>';
      note.querySelector('span').textContent = data.related;
      fieldsMount.appendChild(note);
    }
    if (!fieldsMount.querySelector('.reference-preview-field')) {
      showStatus(`No usable suggestions were returned. Your ${noun} has not been changed.`);
      return;
    }
    status.hidden = true;
    preview.hidden = false;
  }

  function selectedRows() {
    return [...fieldsMount.querySelectorAll('.reference-preview-field')].filter(row => row.querySelector('input[type="checkbox"]')?.checked);
  }

  function applyRows(rows, { replaceExisting = true } = {}) {
    let changed = 0;
    rows.forEach(row => {
      const target = form.elements.namedItem(row.dataset.formName);
      if (!target) return;
      const current = String(target.value || '').trim();
      if (!replaceExisting && current) return;
      target.value = row.dataset.value || '';
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      changed += 1;
    });
    clearPreview();
    showStatus(changed
      ? `Selected suggestions applied to the ${noun}. Review or edit them before saving.`
      : `No existing values were changed in the ${noun}.`);
  }

  function showConflictPrompt(rows, conflicts) {
    clearConflict();
    const box = document.createElement('div');
    box.id = 'reference-conflict';
    box.className = 'reference-conflict';
    const names = conflicts.map(({ row }) => row.dataset.formName).join(', ');
    box.innerHTML = `
      <strong>Some fields already have content.</strong>
      <span class="reference-conflict-copy"></span>
      <div class="reference-conflict-actions">
        <button type="button" class="new-card-secondary" data-reference-conflict="cancel">Cancel</button>
        <button type="button" class="new-card-secondary" data-reference-conflict="empty">Fill empty fields only</button>
        <button type="button" class="new-card-primary" data-reference-conflict="replace">Replace selected fields</button>
      </div>`;
    box.querySelector('.reference-conflict-copy').textContent = `${names} already contain values. Do you want to replace the selected existing values?`;
    preview.appendChild(box);
    box.querySelector('[data-reference-conflict="cancel"]').addEventListener('click', clearConflict);
    box.querySelector('[data-reference-conflict="empty"]').addEventListener('click', () => applyRows(rows, { replaceExisting: false }));
    box.querySelector('[data-reference-conflict="replace"]').addEventListener('click', () => applyRows(rows, { replaceExisting: true }));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  apply?.addEventListener('click', () => {
    clearConflict();
    const rows = selectedRows();
    if (!rows.length) {
      showStatus('Choose at least one suggested field to apply.');
      return;
    }

    // New Card keeps the original quick workflow. Existing cards/drafts protect
    // any field that already has content and ask before replacing it.
    if (mode === 'new') {
      applyRows(rows, { replaceExisting: true });
      return;
    }

    const conflicts = rows.map(row => ({ row, target: form.elements.namedItem(row.dataset.formName) }))
      .filter(({ row, target }) => target && String(target.value || '').trim() && String(target.value || '').trim() !== String(row.dataset.value || '').trim());
    if (!conflicts.length) {
      applyRows(rows, { replaceExisting: true });
      return;
    }
    showConflictPrompt(rows, conflicts);
  });

  cancel?.addEventListener('click', clearPreview);
})();
