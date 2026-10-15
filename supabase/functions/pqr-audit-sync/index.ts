import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

// Only a digest is deployed. Raw receiver key lives in its own Databricks scope.
const ingestTokenHash = '59521d91b88a97821a58596354b94ab952b6b91076680173e6e32b54aff9d352';
const fields = ['ID_de_audito','ID_de_PDV','Ola','pais','segmento','canal','Fecha_del_audito','FechaInicioValidacion','Survey','ciudad','region','nombre_usuario','Validador','Estado'];
const idPattern = /^\d{1,30}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body:object,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
async function digest(token:string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function safeRows(value:unknown,audit:string) {
  if (!Array.isArray(value) || value.length>20) throw Error('INVALID_RECORDS');
  return value.map(row=>{
    if (!row || typeof row!=='object' || fields.some(f=>!Object.hasOwn(row,f))) throw Error('INVALID_FIELDS');
    const clean = Object.fromEntries(fields.map(f=>{
      const v=row[f];
      if (v!==null && (typeof v!=='string'||v.length>1000)) throw Error('INVALID_VALUE');
      return [f,v];
    }));
    if (clean.ID_de_audito!==audit || !/\d{4}$/.test(clean.Ola||'') || Number(clean.Ola.slice(-4))<2026 || !/ko|lindley/i.test(clean.Survey||'')) throw Error('OUT_OF_SCOPE');
    return clean;
  });
}
Deno.serve(async request=>{
  if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  const token=request.headers.get('x-pqr-sync-token')||'';
  if(!/^[0-9a-f]{64}$/.test(ingestTokenHash))return reply({error:'NOT_CONFIGURED'},503);
  if(token.length<40 || token.length>256 || await digest(token)!==ingestTokenHash)return reply({error:'UNAUTHORIZED'},401);
  let input;
  try {
    const text=await request.text();
    if(text.length>1500000)return reply({error:'PAYLOAD_TOO_LARGE'},413);
    input=JSON.parse(text);
  } catch {return reply({error:'INVALID_JSON'},400);}
  if(!['manifest','publish'].includes(input?.action))return reply({error:'INVALID_ACTION'},400);
  try {
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    if(input.action==='manifest'){
      const after=input.after||'';
      if(typeof after!=='string'||(after&&!idPattern.test(after)))return reply({error:'INVALID_CURSOR'},400);
      const {data,error}=await admin.rpc('pqr_databricks_targets',{p_after:after});
      if(error)throw Error('TARGETS_FAILED');
      const ids=(data||[]).map(row=>row.audit_id);
      return reply({ids,next:ids.length===100?ids.at(-1):null});
    }
    if(!uuid.test(input.runId||''))return reply({error:'INVALID_RUN'},400);
    const entries=input.entries;
    if(!Array.isArray(entries)||!entries.length||entries.length>100)return reply({error:'INVALID_BATCH'},400);
    let rows;
    const at=new Date().toISOString();
    try {
      rows=entries.map(entry=>{
        if(!entry || typeof entry.auditId!=='string'||!idPattern.test(entry.auditId))throw Error('INVALID_ID');
        return {audit_id:entry.auditId,records:safeRows(entry.rows,entry.auditId),checked_at:at,run_id:input.runId};
      });
    } catch {return reply({error:'INVALID_AUDIT_DATA'},400);}
    const ids=rows.map(row=>row.audit_id);
    if(new Set(ids).size!==ids.length)return reply({error:'DUPLICATE_IDS'},400);
    const {data:allowed,error:targetError}=await admin.rpc('pqr_databricks_targets',{p_ids:ids});
    if(targetError)throw Error('TARGETS_FAILED');
    const permitted=new Set((allowed||[]).map(row=>row.audit_id));
    if(ids.some(id=>!permitted.has(id)))return reply({error:'AUDIT_NOT_LINKED_TO_ACTIVE_TICKET'},409);
    // One atomic upsert per batch. Failed batches preserve the previous cache.
    const {error:writeError}=await admin.from('pqr_audit_cache').upsert(rows,{onConflict:'audit_id'});
    if(writeError)throw Error('CACHE_WRITE_FAILED');
    return reply({ok:true,count:rows.length,checkedAt:at});
  } catch {
    console.error('pqr-audit-sync: SYNC_FAILED');
    return reply({error:'SYNC_FAILED'},500);
  }
});
