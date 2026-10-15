const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({window:{}});
for(const file of ['audits','history','reports'])vm.runInContext(fs.readFileSync(`docs/assets/${file}.js`,'utf8'),context);
const h=context.window.PQRHistory,r=context.window.PQRReports;
const source={row:99,values:{ID:1,'ID de auditoría':'123','ID PDV':'0012',Estudio:'KO',Mes:'SEPTIEMBRE','Fecha de solicitud':'2026-10-01T00:00:00',Status:'CERRADO',Procede:'SI',Tipificacion:'Disponibilidad','Adjudicable a':'OPS Campo | Validación','Quien responde el PQR':'Analista de ejemplo','País campo':'Peru'}};
const row={ID_de_audito:'123',ID_de_PDV:'0012',Ola:'AGO 2026',Survey:'ko_moderno_co_202608',pais:'Colombia',nombre_usuario:'Auditor de ejemplo',Validador:'Validador de ejemplo',ciudad:'Bogotá',region:'Centro'};
test('mes y estudio de Databricks prevalecen; sin cruce, Excel; nunca fecha de radicación',()=>{
 const found=h.normalize(source,[row]),missing=h.normalize(source,[]);
 assert.equal(found.reportingMonth,'2026-08');assert.equal(found.monthSource,'Databricks');assert.equal(found.client,'KO moderno');
 assert.equal(missing.reportingMonth,'2026-09');assert.equal(missing.client,'KO');assert.equal(missing.excelMonth,'SEPTIEMBRE');
 assert.equal(h.normalize(source,[row,{...row,Ola:'SEP 2026'}]).reportingMonth,'2026-09');
 assert.equal(h.month('SEP 2026'),'2026-09');assert.equal(h.month('2026-13'),'');assert.equal(h.month('sin mes'),'');
});
test('columnas desplazadas se advierten, sin crear un nombre de analista numérico',()=>{
 const shifted=h.normalize({...source,values:{...source.values,'ID de auditoría':'PER_021','Quien responde el PQR':8765432}},[]);
 assert.equal(shifted.auditOriginal,'8765432');assert.equal(shifted.analystName,'');assert.equal(shifted.qualityFlags.length,1);
 assert.equal(h.auditCandidate({'ID de auditoría':'123 y 456'}),'');
 assert.equal(h.country('Guatemala ABVO'),'Guatemala');
});
test('corrección manual tiene procedencia y no muta la fuente ni simula un cruce',()=>{
 const original=h.normalize(source,[]),lookup={loaded:true,entries:{123:{rows:[]}}};
 const t=h.resolve(original,lookup,{patch:{client:'KO tradicional',auditCity:'Lima',reviewed:true},updated_at:'2026-10-15',reason:'Fuente confirmada'});
 assert.equal(original.client,'KO');assert.equal(t.client,'KO tradicional');assert.equal(t.auditData.ciudad,'Lima');assert.equal(t.matchStatus,'not_found');assert.equal(t.hasManualData,true);
 assert.ok(t.dataIssues.some(i=>i.includes('Auditor')));assert.ok(!t.dataIssues.includes('Sin datos'));
 assert.equal(h.resolve(original,lookup,{patch:{auditOriginal:'456'}}).auditOriginal,'456');
});
test('filtros globales combinan origen, país, estudio, mes, estado y analista en ambas hojas',()=>{
 const a=h.resolve(h.normalize(source,[]),{}),b={...a,id:'second',origin:'platform',reportingMonth:'2026-10'};
 const f={origin:'historical',country:'Perú',month:'2026-09',study:'KO',status:'Cerrado',analyst:'Analista de ejemplo'};
 assert.equal(r.filterTickets([a,b],f).length,1);
 for(const view of ['overview','details','pending']){
   const html=r.render([a,b],[],{}, {...f,view});assert.match(html,/manager-month-filter/);assert.match(html,/manager-origin-filter/);assert.match(html,/Datos por completar/);
 }
 const s=r.summarize([a]);assert.equal(s.avgClosure,null);assert.equal(s.validators[0].name,'Analista de ejemplo');assert.equal(s.validators[0].active,null);
 assert.equal(r.summarize([{...a,area:'No Aplica'}]).adjudicable,0);
});
test('histórico queda fuera de usuarios, tickets y correos; RLS y permisos mínimos',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261015204849_pqr_historical_reporting.sql','utf8');
 assert.doesNotMatch(sql,/insert into public\.(pqr_tickets|pqr_profiles|pqr_notifications|pqr_mail_events)/i);
 assert.match(sql,/enable row level security/);assert.match(sql,/security invoker/);assert.doesNotMatch(sql,/security definer/i);
 assert.match(sql,/update\(patch,reason\)/);assert.match(sql,/new.updated_by=auth.uid\(\)/);
 assert.match(sql,/old.history/);assert.match(sql,/unique\(source_hash,source_sheet,source_row\)/);
});
test('lector paginado no trunca históricos a mil y escritura usa concurrencia optimista',()=>{
 const code=fs.readFileSync('docs/assets/production.js','utf8');assert.match(code,/range\(offset,offset\+499\)/);assert.match(code,/if\(data.length<500\)return rows/);
 assert.match(code,/\.eq\('updated_at',old.updated_at\)/);assert.match(code,/historicalIds:batch.filter/);
});
test('paginación real recupera 1.438 casos sin truncar ni repetir filas',async()=>{
 const code=fs.readFileSync('docs/assets/production.js','utf8'),calls=[];
 const data=Array.from({length:1438},(_,id)=>({id}));
 const ctx=vm.createContext({db:{from:()=>({select:()=>({order:()=>({range:async(a,b)=>{calls.push([a,b]);return {data:data.slice(a,b+1),error:null};}})})})}});
 vm.runInContext(code.slice(code.indexOf('  async function readAll('),code.indexOf('  function renderLogin(')),ctx);
 const rows=await ctx.readAll('fixture','id');assert.equal(rows.length,1438);assert.equal(new Set(rows.map(r=>r.id)).size,1438);assert.deepEqual(calls,[[0,499],[500,999],[1000,1499]]);
});
test('Excel incorpora procedencia, mes y analista histórico sin duplicar hitos del flujo',()=>{
 const sheets=[],XLSX={utils:{book_new:()=>({}),aoa_to_sheet:rows=>{sheets.push(rows);return {};},book_append_sheet:()=>{},encode_col:()=>''},writeFile:()=>{}};
 const ctx=vm.createContext({window:{XLSX},XLSX});vm.runInContext(fs.readFileSync('docs/assets/reports.js','utf8'),ctx);
 const t=h.resolve(h.normalize(source,[]),{});ctx.window.PQRReports.excelCases([t]);
 const [headers,values]=sheets[0];for(const field of ['Origen','Mes de auditoría','ID original Excel','Información pendiente'])assert.ok(headers.includes(field));
 assert.equal(values[headers.indexOf('Analista de PQR')],'Analista de ejemplo');assert.equal(values[headers.indexOf('Mes de auditoría')],'2026-09');
 assert.ok(!headers.includes('Fecha/hora dictamen'));
});
test('un mismo analista no se duplica por tener PQR históricas y de plataforma',()=>{
 const historical=h.normalize(source,[]),live={...historical,origin:'platform',validatorPersonId:'staff-id',analystName:''};
 const s=r.summarize([historical,live],[],{validators:[{id:'staff-id',name:'Analista de ejemplo',active:true}]});
 assert.equal(s.validators.length,1);assert.equal(s.validators[0].assigned,2);
 const stats=context.window.PQRAudits.stats([{...historical,auditData:{}}],{loaded:true,entries:{123:{rows:[]}}});
 assert.equal(stats.auditors.length,0);assert.equal(stats.cities.length,0);
});
