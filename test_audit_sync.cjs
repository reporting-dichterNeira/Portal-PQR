const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const key='fixture-only-'.repeat(5);
const runId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const fields=['ID_de_audito','ID_de_PDV','Ola','pais','segmento','canal','Fecha_del_audito','FechaInicioValidacion','Survey','ciudad','region','nombre_usuario','Validador','Estado'];
const row=Object.fromEntries(fields.map(f=>[f,null]));
Object.assign(row,{ID_de_audito:'123',Ola:'OCT 2026',Survey:'ko_trad',pais:'Perú'});
function receiver({allowed=['123','456'],writeError=false}={}){
  let handler;const writes=[];
  const client={rpc:async(_name,args)=>({data:allowed.filter(id=>!args.p_ids||args.p_ids.includes(id)).map(audit_id=>({audit_id}))}),
    from:()=>({upsert:async rows=>{writes.push(rows);return {error:writeError?{}:null};}})};
  let code=fs.readFileSync('supabase/functions/pqr-audit-sync/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  code=code.replace(/const ingestTokenHash = '[^']+';/,`const ingestTokenHash = '${createHash('sha256').update(key).digest('hex')}';`);
  const context=vm.createContext({Response,Request,TextEncoder,crypto:webcrypto,console,createClient:()=>client,Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}}});
  vm.runInContext(stripTypeScriptTypes(code),context);
  return {writes,invoke:(body,secret=key)=>handler(new Request('https://example.test',{method:'POST',headers:{'x-pqr-sync-token':secret},body:JSON.stringify(body)}))};
}
const batch=(rows=[row],auditId='123')=>({action:'publish',runId,entries:[{auditId,rows}]});
test('receptor exige clave exclusiva; manifiesto solo IDs, nunca SQL o tickets',async()=>{
  const r=receiver();
  assert.equal((await r.invoke({action:'manifest'},'')).status,401);
  assert.equal((await r.invoke({action:'sql',sql:'SELECT *'})).status,400);
  const result=await (await r.invoke({action:'manifest'})).json();
  assert.deepEqual(result,{ids:['123','456'],next:null});assert.equal(r.writes.length,0);
});
test('publica datos completos, no encontrado y conserva coincidencias múltiples',async()=>{
  const r=receiver();
  for(const rows of [[row],[],[row,{...row,Validador:'Segundo'}]])assert.equal((await r.invoke(batch(rows))).status,200);
  assert.equal(r.writes[1][0].records.length,0);assert.equal(r.writes[2][0].records.length,2);
  assert.ok(Date.parse(r.writes[0][0].checked_at));assert.equal(r.writes[0][0].run_id,runId);
});
test('rechaza IDs no vinculados, duplicados, datos parciales y fuera del alcance',async()=>{
  const r=receiver({allowed:['456']});assert.equal((await r.invoke(batch())).status,409);assert.equal(r.writes.length,0);
  for(const body of [batch([{...row,Ola:'DIC 2025'}]),batch([{...row,Survey:'other'}]),batch([{...row,ID_de_audito:'456'}]),batch([{ID_de_audito:'123'}]),batch(Array(21).fill(row)),batch([row],"1' OR TRUE"),{...batch(),runId:'not-uuid'}, {...batch(),entries:[...batch().entries,...batch().entries]}]){
    const check=receiver();assert.equal((await check.invoke(body)).status,400);assert.equal(check.writes.length,0);
  }
});
test('fallos de base no se convierten en datos vacíos ni exponen secretos',async()=>{
  const r=receiver({writeError:true});const response=await r.invoke(batch());
  assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'SYNC_FAILED'});
});
test('programación independiente 6 y 14 Bogotá, solo Reporting Cluster',()=>{
  const job=JSON.parse(fs.readFileSync('databricks/pqr_audit_sync_job.json'));
  assert.equal(job.schedule.quartz_cron_expression,'0 0 6,14 * * ?');assert.equal(job.schedule.timezone_id,'America/Bogota');
  assert.equal(job.tasks[0].existing_cluster_id,'1115-192254-jqnbpmi');assert.equal(job.max_concurrent_runs,1);
  const reader=fs.readFileSync('supabase/functions/pqr-audits/index.ts','utf8');
  assert.ok(!reader.includes('DATABRICKS_TOKEN'));assert.ok(!reader.includes('queryCluster'));
});
