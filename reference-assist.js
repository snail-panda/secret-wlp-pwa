(() => {
  'use strict';
  const form = document.getElementById('new-card-form');
  const word = document.getElementById('new-card-word');
  const source = document.getElementById('reference-source');
  const lookup = document.getElementById('reference-lookup-button');
  const status = document.getElementById('reference-assist-status');
  const preview = document.getElementById('reference-preview');
  const fieldsMount = document.getElementById('reference-preview-fields');
  const apply = document.getElementById('reference-preview-apply');
  const cancel = document.getElementById('reference-preview-cancel');
  if (!form || !word || !lookup) return;

  const providers = {
    'merriam-webster': {
      label: 'Merriam-Webster',
      configured: true,
      async lookup(headword) {
        const response = await fetch(`/.netlify/functions/merriam-webster?word=${encodeURIComponent(headword)}`, {
          headers: { accept: 'application/json' }
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
  const clearPreview = () => { preview.hidden = true; fieldsMount.replaceChildren(); };
  const setBusy = (busy) => {
    lookup.disabled = busy;
    lookup.textContent = busy ? 'Looking Up…' : 'Look Up';
  };

  lookup.addEventListener('click', async () => {
    clearPreview();
    const headword = String(word.value || '').trim();
    if (!headword) { showStatus('Enter a Word or phrase first, then look it up.'); word.focus(); return; }
    const provider = providers[source.value];
    if (!provider?.configured) {
      showStatus(`${provider?.label || 'This source'} is not connected yet. Your Draft has not been changed.`);
      return;
    }
    setBusy(true);
    showStatus(`Looking up “${headword}”…`);
    try {
      const data = await provider.lookup(headword);
      if (!data.found) {
        const suffix = data.suggestions?.length ? ` Suggestions: ${data.suggestions.join(', ')}.` : '';
        showStatus(`No exact Merriam-Webster entry was returned for “${headword}”.${suffix} Your Draft has not been changed.`);
        return;
      }
      renderPreview(data);
    } catch (error) {
      const message = String(error?.message || '');
      showStatus(message.includes('API keys are not available')
        ? 'Merriam-Webster is connected, but its API keys are not available to this deploy context yet.'
        : 'The Merriam-Webster lookup could not be completed. Your Draft has not been changed.');
    } finally { setBusy(false); }
  });

  const mapping = [
    ['Part of Speech','pos'], ['Definition','definition'], ['Synonym(s)','synonyms'],
    ['Example Sentence','example'], ['IPA','ipa']
  ];
  function renderPreview(data = {}) {
    fieldsMount.replaceChildren();
    mapping.forEach(([label,key]) => {
      const value = String(data[key] || '').trim(); if (!value) return;
      const row = document.createElement('label'); row.className='reference-preview-field';
      row.innerHTML=`<input type="checkbox" data-reference-key="${key}" checked><span class="reference-preview-label"></span><span class="reference-preview-value"></span>`;
      row.querySelector('.reference-preview-label').textContent=label;
      row.querySelector('.reference-preview-value').textContent=value;
      row.dataset.value=value; row.dataset.formName=label; fieldsMount.appendChild(row);
    });
    if (data.related) {
      const note = document.createElement('div');
      note.className = 'reference-related-note';
      note.innerHTML = '<strong>Related words</strong><span></span>';
      note.querySelector('span').textContent = data.related;
      fieldsMount.appendChild(note);
    }
    if (!fieldsMount.querySelector('.reference-preview-field')) { showStatus('No usable suggestions were returned. Your Draft has not been changed.'); return; }
    status.hidden=true; preview.hidden=false;
  }
  apply?.addEventListener('click', () => {
    fieldsMount.querySelectorAll('.reference-preview-field').forEach(row => {
      if (!row.querySelector('input[type="checkbox"]')?.checked) return;
      const target=form.elements.namedItem(row.dataset.formName); if (target) target.value=row.dataset.value || '';
    });
    clearPreview(); showStatus('Selected suggestions applied to the Draft. Review or edit them before saving.');
  });
  cancel?.addEventListener('click', clearPreview);
})();
