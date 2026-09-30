/* WLP Supabase Shadow Mode v0-A — local scanner configuration.
   Cloud transport is intentionally unavailable in this phase. */
(() => {
  'use strict';

  window.WLPCloudShadowConfig = Object.freeze({
    phase: 'v0-A',
    manifestVersion: 1,
    cloudEnabled: false,
    allowCloudReads: false,
    allowCloudWrites: false,
    supabaseUrl: '',
    publishableKey: ''
  });
})();
