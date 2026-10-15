import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

// Session-gated cache reader. Never calls Databricks or starts compute.
const allowedOrigins = new Set(['https://reporting-dichterneira.github.io','http://localhost:8765','http://127.0.0.1:8765']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auditId = value => /^\d{1,30}$/.test(String(value ?? '').trim()) ? String(value).trim() : '';

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  const headers = {'content-type':'application/json','access-control-allow-origin':origin,
    'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
    'access-control-allow-methods':'POST,OPTIONS','cache-control':'no-store','vary':'Origin'};
  const reply = (body:object,status=200) => new Response(JSON.stringify(body),{status,headers});
  if (!allowedOrigins.has(origin)) return new Response('Forbidden',{status:403});
  if (request.method === 'OPTIONS') return reply({});
  if (request.method !== 'POST') return reply({error:'Método no permitido'},405);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if (!token) return reply({error:'Sesión requerida'},401);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{
      global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false},
    });
    const {data:identity,error:authError} = await client.auth.getUser(token);
    if (authError || !identity.user) return reply({error:'Sesión inválida'},401);
    const {data:actor,error:profileError} = await client.from('pqr_profiles').select('role,active').eq('id',identity.user.id).single();
    if (profileError || !actor?.active || !['gerente','admin'].includes(actor.role)) return reply({error:'Consulta reservada a Gerencia y Administración'},403);
    let input;
    try { input = await request.json(); } catch { return reply({error:'Solicitud inválida'},400); }
    const ticketIds = input?.ticketIds ?? [], historicalIds = input?.historicalIds ?? [];
    if (!Array.isArray(ticketIds)||!Array.isArray(historicalIds)||ticketIds.length+historicalIds.length<1||ticketIds.length+historicalIds.length>50||[...ticketIds,...historicalIds].some(id=>typeof id!=='string'||!uuid.test(id))) return reply({error:'Selecciona entre 1 y 50 solicitudes válidas'},400);
    const [live,history,overrides] = await Promise.all([
      ticketIds.length?client.from('pqr_tickets').select('id,data').in('id',ticketIds).is('deleted_at',null):{data:[],error:null},
      historicalIds.length?client.from('pqr_historical_cases').select('id,data').in('id',historicalIds):{data:[],error:null},
      historicalIds.length?client.from('pqr_case_overrides').select('case_id,patch').eq('source','historical').in('case_id',historicalIds):{data:[],error:null},
    ]);
    if(live.error||history.error||overrides.error)return reply({error:'No se pudieron consultar las solicitudes'},500);
    if(live.data?.length!==new Set(ticketIds).size||history.data?.length!==new Set(historicalIds).size)return reply({error:'Una solicitud no existe o no está disponible'},403);
    const tickets=[...(live.data||[]),...(history.data||[]).map(t=>({...t,data:{...t.data,auditOriginal:overrides.data?.find(o=>o.case_id===t.id)?.patch?.auditOriginal||t.data.auditOriginal}}))];
    const ids = [...new Set(tickets.flatMap(t=>[auditId(t.data.auditOriginal),auditId(t.data.audit)]).filter(Boolean))];
    if (!ids.length) return reply({entries:{},source:'scheduled',checkedAt:null});
    // RLS also checks the active role and ticket linkage on the cache itself.
    const {data:cached,error:cacheError} = await client.from('pqr_audit_cache').select('audit_id,records,checked_at').in('audit_id',ids);
    if (cacheError) return reply({error:'No se pudo leer el corte sincronizado. Se conservan los datos anteriores.'},503);
    const entries = Object.fromEntries((cached||[]).map(row=>[row.audit_id,{rows:row.records,at:row.checked_at}]));
    const dates = (cached||[]).map(row=>Date.parse(row.checked_at));
    return reply({entries,source:'scheduled',checkedAt:dates.length?new Date(Math.min(...dates)).toISOString():null});
  } catch {
    console.error('pqr-audits: CACHE_READ_FAILED');
    return reply({error:'No se pudo leer el corte sincronizado. No se han modificado los tickets.'},503);
  }
});
