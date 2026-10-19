// Negative-only production smoke check: never creates a valid ticket or file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../docs/assets/production.js',import.meta.url),'utf8');
const base=source.match(/const URL = '([^']+)'/)[1],key=source.match(/const KEY = '([^']+)'/)[1];
const headers={apikey:key,'Content-Type':'application/json'};
async function rpc(name,body){const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body)});return{status:response.status,data:await response.json()};}
for(const code of ['PQR-2026-0019','PQR-INT-2026-9999-0123456789ABCDEF',"' OR 1=1 --"]){
 const r=await rpc('pqr_lookup_internal',{p_code:code});assert.equal(r.status,200);assert.equal(r.data,null);
}
const invalid=await rpc('pqr_submit_internal',{p_request_id:crypto.randomUUID(),p_data:{kind:'INVALID'}});
assert.equal(invalid.status,200);assert.equal(typeof invalid.data.error,'string');assert.equal(invalid.data.id,undefined);
const rows=await fetch(base+'/rest/v1/pqr_tickets?select=code&limit=1',{headers});assert.ok([401,403].includes(rows.status),'Anonymous table SELECT must be denied');
const manual=await rpc('pqr_create_manual_scoped',{p_data:{scope:'internal'}});assert.ok([401,403].includes(manual.status),'Anonymous manual creation must be denied');
const file=await fetch(base+'/storage/v1/object/pqr-adjuntos/'+crypto.randomUUID()+'/'+crypto.randomUUID()+'-unauthorized.png',{
 method:'POST',headers:{apikey:key,'Content-Type':'image/png','x-upsert':'false'},body:new Uint8Array([137,80,78,71])});
assert.notEqual(file.status,200,'No file may be uploaded without its exact scoped capability');
const error=await file.json();assert.ok([400,401,403].includes(file.status));assert.ok(error.error||error.message);
console.log('PUBLIC_API_SMOKE_OK: lookup isolated, invalid intake rejected, table/manual/upload denied');
