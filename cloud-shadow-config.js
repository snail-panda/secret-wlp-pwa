/* WLP Supabase Shadow Mode v0-B — manual cloud shadow configuration.
   No automatic sync. No cloud data is ever written back into WLP in this phase. */
(() => {
  'use strict';

  window.WLPCloudShadowConfig = Object.freeze({
    phase: 'v0-B',
    manifestVersion: 1,
    automaticSync: false,
    writeBackToWLP: false,
    supabaseUrl: '',
    publishableKey: '',
    uploadBatchSize: 300,
    fetchPageSize: 1000
  });
})();
