/* G4-1 Study Hub source/Writer ownership seam. Reads only existing Mirror metadata.
 * Never installs a DB, enrolls a Session, or changes user data. Separate from
 * the E7b Journal's tested serialization/commit/Resume implementation.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
else root.WLPG4StudySourceRouting=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
const DB='wlp-cloud-v1',KEY='authority_mirror';
const fail=m=>{throw Error('G4 Study source HOLD: '+m);};
const decision=(mode,reason)=>Object.freeze({mode,reason});
function classify(meta){
 if(!meta)return decision('legacy','no-canonical-authority-mirror');
 const source=String(meta.installSource||'');
 if(source==='g4-first-browser-source-only-v1'){
   if(meta.normalStudyEnabled!==false||meta.normalAutoSyncEnabled!==false)
     return decision('hold','new-mirror-safety-flags-inconsistent');
   if(!meta.userId||!meta.deviceKey||!meta.candidateKey||!Number.isSafeInteger(Number(meta.headVersion)))
     return decision('hold','new-mirror-identity-missing');
   return decision('new-g4-mirror','verified-install-needs-native-writer');
 }
 if(source.startsWith('g4-')||meta.normalStudyEnabled===false||meta.normalAutoSyncEnabled===false)
   return decision('hold','unsupported-or-protected-mirror-generation');
 // An established E7a mirror continues through the original Study Hub path.
 return decision('legacy','existing-e7a-authority');
}
async function inspect({indexedDB}={}){
 if(!indexedDB?.open)return decision('hold','idb-api-unavailable');
 try{
   if(typeof indexedDB.databases==='function'){
     const names=await indexedDB.databases();
     if(!Array.isArray(names))return decision('hold','idb-inventory-invalid');
     if(!names.some(x=>x?.name===DB))return decision('legacy','no-canonical-db');
   }
   const db=await new Promise((yes,no)=>{
     const req=indexedDB.open(DB);let absent=false;
     req.onupgradeneeded=()=>{absent=true;try{req.transaction.abort();}catch(_){}};
     req.onsuccess=()=>{
       if(absent){req.result.close();yes(null);}else yes(req.result);
     };
     req.onerror=()=>absent?yes(null):no(req.error||Error('Existing Mirror cannot be opened'));
     req.onblocked=()=>no(Error('Mirror blocked by another tab'));
   });
   if(!db)return decision('legacy','canonical-db-not-created');
   try{
     if(!db.objectStoreNames.contains('sync_meta'))
       return decision('hold','existing-canonical-schema-incomplete');
     const meta=await new Promise((yes,no)=>{
       let tx;
       try{
         tx=db.transaction('sync_meta','readonly');
         const req=tx.objectStore('sync_meta').get(KEY);let record;
         req.onsuccess=()=>{record=req.result||null;};
         req.onerror=()=>{try{tx.abort();}catch(_){}};
         tx.oncomplete=()=>yes(record);
         tx.onabort=()=>no(tx.error||Error('Authority metadata read failed'));
         tx.onerror=()=>no(tx.error||Error('Authority metadata transaction failed'));
       }catch(e){no(e);}
     });
     return classify(meta);
   }finally{db.close();}
 }catch(error){return decision('hold',String(error?.message||error));}
}
return Object.freeze({inspect,classify});
});
