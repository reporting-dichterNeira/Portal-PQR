const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const provider = import('./supabase/functions/pqr-audits/databricks.mjs');
const browser = vm.createContext({window:{}});
vm.runInContext(fs.readFileSync('docs/assets/audits.js','utf8'),browser);
vm.runInContext(fs.readFileSync('docs/assets/reports.js','utf8'),browser);
const audits = browser.window.PQRAudits;
const t = {id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',code:'PQR-2026-0001',requestType:'PQR',auditOriginal:'123',audit:'456',country:'Perú',client:'Lindley',status:'Cerrado',applies:'Aplica'};
const at='2026-10-15T14:00:00Z';
const row={ID_de_audito:'123',nombre_usuario:'Auditor A',Validador:'Validador X',ciudad:'LIMA',pais:'Peru',region:'Centro',canal:'Tradicional',Survey:'lindley_pe_202610'};
const lookup={...audits.empty(),entries:{123:{rows:[row],at},456:{rows:[{...row,ID_de_audito:'456',nombre_usuario:'Auditor B'}],at}},checkedAt:at};

test('IDs como texto, consulta fija y rechazo de inyección SQL',async()=>{
  const {auditId,buildQuery,idsForTickets}=await provider;
  assert.equal(auditId('9007199254740993'),'9007199254740993');
  assert.equal(auditId('123; DROP TABLE x'),'');
  assert.throws(()=>buildQuery(["1' OR 1=1 --"]));
  assert.throws(()=>buildQuery([]));
  assert.throws(()=>buildQuery(Array(101).fill('1')));
  const sql=buildQuery(['123','456']);
  assert.match(sql,/TRY_CAST\(RIGHT\(`Ola`,4\) AS INT\) >= 2026/);
  assert.match(sql,/LOWER\(Survey\) LIKE '%ko%'/);
  assert.match(sql,/hive_metastore\.storeview\.slv_sv_ceres_ag_export/);
  assert.deepEqual(idsForTickets([t,t]),['123','456']);
});
test('Sin datos solo después de consulta exitosa y ambigüedad sin atribución arbitraria',()=>{
  assert.equal(audits.match(t,audits.empty()).status,'pending');
  assert.equal(audits.match(t,{entries:{123:{rows:[],at}}}).label,'Sin datos');
  assert.equal(audits.match({...t,auditOriginal:''},lookup).status,'missing_id');
  assert.equal(audits.match(t,{entries:{123:{rows:[row,row],at}}}).status,'ambiguous');
  assert.equal(audits.stats([t],{entries:{123:{rows:[row,row],at}}}).auditors.length,0);
});
test('rankings por original, no por nueva; excluyen RDG/EDC y cuentan PQR sin multiplicarlas',()=>{
  const s=audits.stats([t,{...t,id:'another'},{...t,requestType:'RDG'},{...t,requestType:'EDC'}],lookup);
  assert.equal(s.total,2);assert.equal(s.found,2);
  assert.equal(s.auditors[0].name,'Auditor A');assert.equal(s.auditors[0].count,2);assert.equal(s.auditors[0].audits,1);
  assert.equal(s.validators[0].name,'Validador X');assert.equal(s.cities[0].name,'LIMA · Peru');
});
test('detalles de ambas auditorías, botones en ambas hojas y HTML seguro',()=>{
  const detail=audits.detail(t,lookup);
  assert.match(detail,/Auditoría original · 123/);assert.match(detail,/Nueva auditoría · 456/);
  assert.match(detail,/Auditor A/);assert.match(detail,/Auditor B/);
  assert.match(audits.detail(t,{entries:{123:{rows:[{...row,ciudad:'<script>bad</script>'}],at}}}),/&lt;script&gt;/);
  assert.match(audits.render([t],lookup),/no una tasa de error/);
  for(const view of ['overview','details']){
    const html=browser.window.PQRReports.render([t],[],{},{view,auditLookup:lookup});
    assert.match(html,/Ver auditoría/);assert.match(html,/Auditores con más PQR/);assert.match(html,/Con datos/);
  }
});

test('parseo completo, no encontrados y datos parciales no pasan como resultado válido',async()=>{
  const {FIELDS,parseResult}=await provider;
  const table={resultType:'table',schema:FIELDS.map(name=>({name})),data:[FIELDS.map(f=>row[f]??null)]};
  const parsed=parseResult(table,['123','999']);
  assert.equal(parsed['123'][0].nombre_usuario,'Auditor A');assert.deepEqual(parsed['999'],[]);
  assert.throws(()=>parseResult({...table,truncated:true},['123']),/INCOMPLETE/);
  assert.throws(()=>parseResult({...table,schema:[]},['123']),/INVALID/);
});
test('clúster: solo lectura, contexto propio destruido, sin iniciar el clúster',async()=>{
  const {queryCluster,FIELDS}=await provider;
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,body:options.body&&JSON.parse(options.body)});
    const response=url.includes('clusters/get')?{state:'RUNNING'}:url.includes('contexts/create')?{id:'ctx'}:url.includes('commands/execute')?{id:'cmd'}:url.includes('commands/status')?{status:'Finished',results:{resultType:'table',schema:FIELDS.map(name=>({name})),data:[]}}:{};
    return {ok:true,json:async()=>response};
  };
  const r=await queryCluster({clusterId:'test-cluster',token:'fixture-not-real',ids:['123'],fetchImpl});
  assert.deepEqual(r['123'],[]);
  assert.match(calls.find(c=>c.url.includes('commands/execute')).body.command,/^SELECT DISTINCT/);
  assert.ok(calls.at(-1).url.includes('contexts/destroy'));
  assert.ok(!calls.some(c=>c.url.includes('/start')));
  await assert.rejects(queryCluster({clusterId:'test',token:'fixture-not-real',ids:['123'],fetchImpl:async()=>({ok:true,json:async()=>({state:'TERMINATED'})})}),/CLUSTER_STOPPED/);
});
test('error y timeout cancelan el comando y liberan el contexto',async()=>{
  const {queryCluster}=await provider;
  for(const fail of ['error','timeout']){
    const calls=[];let clock=0;
    const fetchImpl=async(url)=>{calls.push(url);return{ok:true,json:async()=>url.includes('clusters/get')?{state:'RUNNING'}:url.includes('contexts/create')?{id:'ctx'}:url.includes('commands/execute')?{id:'cmd'}:url.includes('commands/status')?{status:fail==='error'?'Error':'Running'}:{}}};
    await assert.rejects(queryCluster({clusterId:'test',token:'fixture-not-real',ids:['123'],fetchImpl,sleep:async()=>{clock+=50000;},now:()=>clock}),fail==='error'?/QUERY_FAILED/:/QUERY_TIMEOUT/);
    assert.ok(calls.at(-1).includes('contexts/destroy'));
    if(fail==='timeout')assert.ok(calls.some(c=>c.includes('commands/cancel')));
  }
});

function endpoint({role='gerente',active=true,available=true,validSession=true,queryError=false,pending=false}={}){
  let handler;const queries=[];
  const client={auth:{getUser:async()=>({data:{user:validSession?{id:'user'}:null}})},from:table=>{
    const builder={select:()=>builder,eq:()=>builder,in:(_key,ids)=>{queries.push(ids);return table==='pqr_audit_cache'?Promise.resolve({data:pending?[]:[{audit_id:'123',records:[],checked_at:at}],error:queryError?{}:null}):builder;},is:async()=>({data:available?[{id:t.id,data:t}]:[]}),single:async()=>({data:{role,active}})};
    return builder;
  }};
  const context=vm.createContext({Response,Request,Date,Map,Set,console,createClient:()=>client,
    Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}},
    idsForTickets:tickets=>tickets.flatMap(ticket=>[ticket.auditOriginal,ticket.audit]),
    queryCluster:async()=>{if(queryError)throw new Error('DATABRICKS_UNAVAILABLE');return{'123':[],'456':[]};},
  });
  const code=fs.readFileSync('supabase/functions/pqr-audits/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(stripTypeScriptTypes(code),context);
  const invoke=(body={ticketIds:[t.id]},headers={})=>handler(new Request('https://example.test',{method:'POST',headers:{origin:'https://reporting-dichterneira.github.io',authorization:'Bearer fixture-not-real',...headers},body:JSON.stringify(body)}));
  return {invoke,queries};
}
test('endpoint: exige sesión activa y rol gerencia/admin; no permite consultas arbitrarias',async()=>{
  for(const role of ['comercial','validador','redigitador'])assert.equal((await endpoint({role}).invoke()).status,403);
  assert.equal((await endpoint({validSession:false}).invoke()).status,401);
  assert.equal((await endpoint({active:false}).invoke()).status,403);
  assert.equal((await endpoint().invoke(undefined,{origin:'https://other.test'})).status,403);
  assert.equal((await endpoint().invoke({ids:['123'],sql:'SELECT * FROM other'})).status,400);
  assert.equal((await endpoint({available:false}).invoke()).status,403);
  const p=endpoint();const r=await p.invoke();assert.equal(r.status,200);
  const body=await r.json();assert.deepEqual(body.entries,{'123':{rows:[],at}});assert.equal(body.source,'scheduled');assert.deepEqual(p.queries[0],[t.id]);
  const pending=await (await endpoint({pending:true}).invoke()).json();assert.deepEqual(pending.entries,{});assert.equal(pending.checkedAt,null);
  const failed=await endpoint({queryError:true}).invoke();assert.equal(failed.status,503);assert.ok(!(await failed.json()).entries);
  assert.equal(audits.match(t,{...audits.empty(),loaded:true}).label,'Pendiente de sincronización');
});
