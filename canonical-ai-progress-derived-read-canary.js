/* WLP v1.8.6.311 — Progress AI Canonical-event derived route/profile default read diagnostics.
   Production default is implemented in progress.js.
   Query-gated diagnostics: ?wlpAIProgressDerivedReadCanary=1
   Granular rollback: ?wlpLegacyAIProgressDerivedRead=1
   Read-only diagnostics; no route/profile writes. */
(() => {
  'use strict';

  const APP_VERSION = '1.8.6.311-ai-progress-derived-default-read-v1';
  const FLAG = 'wlpAIProgressDerivedReadCanary';
  const active = () => new URLSearchParams(location.search).get(FLAG) === '1';
  if (!active()) return;

  let panel = null;
  let status = null;
  let detail = null;
  let timer = null;

  function makePanel() {
    if (panel) return;
    panel = document.createElement('section');
    panel.id = 'wlp-ai-progress-derived-read-canary';
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = 'position:fixed;z-index:100006;right:8px;top:max(8px,env(safe-area-inset-top));width:min(450px,calc(100vw - 16px));max-height:58vh;overflow:auto;background:#fff;border:1px solid rgba(31,55,39,.24);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2d22';
    panel.innerHTML = '<strong style="display:block;font-size:13px">Progress · AI Canonical-event-derived-state default read</strong><div id="wlp-ai-progress-derived-status" style="margin-top:4px">Waiting for Progress…</div><div id="wlp-ai-progress-derived-detail" style="margin-top:7px;font-size:12px;white-space:pre-wrap;opacity:.86"></div>';
    document.body.appendChild(panel);
    status = panel.querySelector('#wlp-ai-progress-derived-status');
    detail = panel.querySelector('#wlp-ai-progress-derived-detail');
  }

  function show(text, ok = null, lines = '') {
    makePanel();
    status.textContent = text;
    status.style.fontWeight = ok === null ? '500' : '700';
    status.style.color = ok === true ? '#18794e' : ok === false ? '#b42318' : '#1c2d22';
    detail.textContent = lines;
  }

  function inspect() {
    const api = window.WLPProgressStage7;
    if (!api || typeof api.getReadSourceState !== 'function') {
      show('Waiting for Progress read state…', null, 'Read-only diagnostics. No data is changed.');
      return false;
    }
    const state = api.getReadSourceState() || {};
    if (!state.rendered) {
      show('Waiting for Progress render…', null, 'Read-only diagnostics. No data is changed.');
      return false;
    }
    const requested = state.aiDerivedReadCanaryRequested === true;
    const enabled = state.aiDerivedReadCanaryActive === true;
    const failure = String(state.aiDerivedReadCanaryFailure || '');
    const pass = requested && enabled && !failure && state.active === true;
    const counts = state.aiDerivedProfileCounts || {};
    show(
      pass ? 'READY · Progress normal read is using Canonical AI events to derive route/profile.' : 'CHECK · Progress AI derived-state default read is not active.',
      pass,
      `Canonical AI events ${Number(state.aiDerivedCanonicalEvents || 0)}\nCanonical snapshot route ${Number(state.aiDerivedRawCanonicalRouteRecords || 0)} → Progress derived route ${Number(state.aiDerivedRouteRecords || 0)}\nprofile counts ${Number(counts.productionTendencies || 0)}/${Number(counts.reusableConstructions || 0)}/${Number(counts.styleTendencies || 0)}\nProgress source ${String(state.source || '')}${failure ? `\n${failure}` : ''}\nread-only · no route/profile writes`
    );
    return pass;
  }

  function start() {
    makePanel();
    let tries = 0;
    timer = setInterval(() => {
      tries += 1;
      if (inspect() || tries >= 80) {
        clearInterval(timer);
        timer = null;
      }
    }, 125);
    inspect();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();

  window.WLPAIProgressDerivedReadCanary = Object.freeze({ version:1, appVersion:APP_VERSION, isActive:active, inspect });
})();
