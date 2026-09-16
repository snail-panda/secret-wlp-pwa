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
  if (!form || !word || !source || !lookup || !status || !preview || !fieldsMount) return;

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
    status.textContent = message;
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
    const headword = String(word.value || '').trim();
    if (!headword) {
      showStatus('Enter a Word or phrase first, then look it up.');
      word.focus();
      return;
    }
    const provider = providers[source.value];
    if (!provider?.configured) {
      showStatus(`${provider?.label || 'This source'} is not connected yet. Your ${noun} has not been changed.`);
      return;
    }
    setBusy(true);
    showStatus(`Looking up “${headword}”…`);
    try {
      const data = await provider.lookup(headword);
      if (!data.found) {
        const suffix = data.suggestions?.length ? ` Suggestions: ${data.suggestions.join(', ')}.` : '';
        showStatus(`No exact Merriam-Webster entry was returned for “${headword}”.${suffix} Your ${noun} has not been changed.`);
        return;
      }
      renderPreview(data);
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

  function renderPreview(data = {}) {
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
