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

  // Adapter boundary: real providers plug into this map later. API credentials
  // must never be committed to client-side source. Until a secure provider is
  // configured, the shell deliberately stops before any network request.
  const providers = {
    collins: {
      label: 'Collins Dictionary',
      configured: false,
      async lookup(_headword) { throw new Error('provider-not-configured'); }
    }
  };

  const showStatus = (message) => {
    status.textContent = message;
    status.hidden = false;
  };
  const clearPreview = () => { preview.hidden = true; fieldsMount.replaceChildren(); };

  lookup.addEventListener('click', async () => {
    clearPreview();
    const headword = String(word.value || '').trim();
    if (!headword) { showStatus('Enter a Word or phrase first, then look it up.'); word.focus(); return; }
    const provider = providers[source.value];
    if (!provider?.configured) {
      showStatus(`${provider?.label || 'This source'} is ready as the first Reference Source, but no API connection is configured yet. When a key/backend is added, suggestions will appear here for review before anything is applied to the Draft.`);
      return;
    }
    // Future provider result shape: { pos, definition, synonyms, example, ipa }
    try { renderPreview(await provider.lookup(headword)); }
    catch { showStatus('The reference lookup could not be completed. Your Draft has not been changed.'); }
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
    if (!fieldsMount.children.length) { showStatus('No usable suggestions were returned. Your Draft has not been changed.'); return; }
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
