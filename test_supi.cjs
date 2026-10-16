const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const real=require('./docs/assets/vendor/xlsx.full.min.js');
let exported;
const ctx=vm.createContext({window:{XLSX:{...real,writeFile:book=>{exported=real.write(book,{type:'buffer',bookType:'xlsx'});}}}});
ctx.XLSX=ctx.window.XLSX;
for(const file of ['audits','history','reports'])vm.runInContext(fs.readFileSync(`docs/assets/${file}.js`,'utf8'),ctx);
const a=ctx.window.PQRAudits,h=ctx.window.PQRHistory;
const at='2026-10-16T14:22:48Z';
const t={id:'fixture-supi',code:'PQR-HIS-2026-07-1',origin:'historical',requestType:'PQR',country:'Chile',client:'KO moderno',auditOriginal:'123',audit:'456',reportingMonth:'2026-07',monthSource:'Excel',status:'Cerrado',applies:'Aplica'};
const row={VISITA:'123',FOLIO:'000123',AUDITOR:'Auditor SUPI',COORDINADOR:'Coordinador SUPI',DIA:'2026-08-30T00:00:00',NUMERO_SEMANA:'36',DIA_SEMANA:'domingo',CADENA:'Cadena',DIRECCION:'Dirección',COMUNA:'Comuna A',INICIO:'09:00:00',FIN:'10:00:00',DURACION:'1:00:00',CLIENTE:'EMBONOR',ESTUDIO:'OSA BEBESTIBLES 2',ESTADO:'2','ID ESTUDIO':'525'};
const lookup={...a.empty(),loaded:true,checkedAt:at,supiCheckedAt:at,entries:{'supi:123':{rows:[row],at},'supi:456':{rows:[{...row,VISITA:'456',AUDITOR:'Otro auditor'}],at},123:{rows:[{ID_de_audito:'123',nombre_usuario:'Auditor Databricks',Survey:'ko_trad_2026'}],at}}};

test('SUPI solo Chile moderno; los IDs se separan de Databricks',()=>{
 assert.equal(a.source(t),'SUPI');
 assert.equal(a.source({...t,client:'KO tradicional'}),'Databricks');
 assert.equal(a.source({...t,country:'Perú'}),'Databricks');
 assert.equal(a.source({...t,client:'KO',auditFallback:{canal:'MODERNO'}}),'SUPI');
 assert.equal(a.match(t,lookup).rows[0].AUDITOR,'Auditor SUPI');
 assert.equal(a.match({...t,client:'KO tradicional'},lookup).rows[0].nombre_usuario,'Auditor Databricks');
 assert.equal(a.match(t,{entries:{123:lookup.entries[123]}}).status,'pending');
 assert.equal(a.match({...t,auditOriginal:'999'},{...lookup,entries:{'supi:999':{rows:[],at}}}).status,'not_found');
 assert.equal(a.match({...t,auditOriginal:''},lookup).status,'missing_id');
});
test('SUPI no inventa Ola, validador, ciudad ni región y no cambia fuentes',()=>{
 const original=JSON.stringify(t),raw=JSON.stringify(row),resolved=h.resolve(t,lookup);
 assert.equal(resolved.reportingMonth,'2026-07');assert.equal(resolved.monthSource,'Excel');
 assert.equal(resolved.studySource,'SUPI');assert.equal(resolved.auditSource,'SUPI');assert.equal(resolved.client,'KO moderno');
 assert.equal(resolved.pdv,'000123');assert.equal(resolved.auditData.nombre_usuario,'Auditor SUPI');
 assert.equal(resolved.auditData.coordinador,'Coordinador SUPI');assert.equal(resolved.auditData.comuna,'Comuna A');
 for(const f of ['Ola','Validador','ciudad','region','Survey'])assert.equal(resolved.auditData[f],undefined);
 const s=a.stats([resolved,{...resolved,requestType:'RDG'},{...resolved,requestType:'EDC'}],lookup);
 assert.equal(s.total,1);assert.equal(s.found,1);assert.equal(s.supiFound,1);
 assert.equal(s.validators.length,0);assert.equal(s.cities.length,0);assert.equal(s.regions.length,0);
 assert.equal(s.coordinators[0].name,'Coordinador SUPI');assert.equal(s.communes[0].name,'Comuna A · Chile');
 assert.equal(s.auditors[0].name,'Auditor SUPI');assert.equal(JSON.stringify(t),original);assert.equal(JSON.stringify(row),raw);
 const corrected=h.resolve(t,lookup,{patch:{reportingMonth:'2026-09',auditAuditor:'Manual'},reason:'Corrección autorizada'});
 assert.equal(corrected.reportingMonth,'2026-09');assert.equal(corrected.monthSource,'Manual');assert.equal(corrected.auditData.nombre_usuario,'Manual');
});
test('detalle muestra las 17 columnas, original y nueva, con procedencia y HTML seguro',()=>{
 const html=a.detail(h.resolve(t,lookup),lookup);
 assert.equal(a.supiFields.length,17);
 assert.match(html,/Auditoría original · 123/);assert.match(html,/Nueva auditoría · 456/);
 assert.match(html,/Otro auditor/);assert.match(html,/Coordinador SUPI/);assert.match(html,/OSA BEBESTIBLES 2/);
 assert.match(html,/Último corte de SUPI/);assert.match(html,/comuna no es una ciudad/);
 assert.doesNotMatch(html,/Sin integración/);
 assert.match(a.detail(t,{entries:{'supi:123':{rows:[{...row,COMUNA:'<script>x</script>'}],at}}}),/&lt;script&gt;/);
});
test('tablas SUPI exportan XLSX real y distinguen campos de procedencia',()=>{
 const resolved=h.resolve(t,lookup);
 assert.equal(a.exportTable([resolved],lookup,'coordinators'),1);
 let book=real.read(exported,{type:'buffer'}),values=real.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
 assert.ok(values.some(r=>r[0]==='Coordinador SUPI'&&r[1]===1));
 ctx.window.PQRReports.excelCases([resolved]);
 book=real.read(exported,{type:'buffer'});values=real.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
 const [headers,data]=values;
 assert.equal(data[headers.indexOf('Origen de auditoría')],'SUPI');
 assert.equal(data[headers.indexOf('Coordinador SUPI')],'Coordinador SUPI');
 assert.equal(data[headers.indexOf('Comuna SUPI')],'Comuna A');
 assert.equal(data[headers.indexOf('Validador de auditoría')],'');
});

const production=fs.readFileSync('docs/assets/production.js','utf8');
const refresh=production.slice(production.indexOf('  async function refreshAudits('),production.indexOf('  function showError('));
async function runRefresh({role='gerente',fail=false,mixed=false,changed=false,logout=false,cut=true,dbCase=true}={}) {
 const calls=[],state={me:{id:'actor',role}};
 const auditLookup={...a.empty(),entries:{'supi:123':{rows:[{...row,AUDITOR:'Anterior'}],at:'2026-10-15T14:00:00Z'}}};
 let stateReads=0;
 const db={from:table=>{
   calls.push(table);
   const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:cut?{checked_at:at,run_id:changed&&++stateReads>1?'other':'run'}:null,error:fail?{}:null}),in:async(_key,ids)=>{
     if(logout)state.me=null;
     return {data:ids.filter(id=>id==='123').map(id=>({audit_id:id,records:[row],checked_at:at,run_id:mixed?'other':'run'})),error:fail?{}:null};
   }};return q;
 },functions:{invoke:async()=>{calls.push('databricks');return{data:{source:'scheduled',entries:{'123':lookup.entries[123]}},error:null};}}};
 const context=vm.createContext({window:{PQRAudits:a},state,auditLookup,db,$:()=>null,dashboard:()=>{},managerTickets:()=>dbCase?[t,{...t,country:'Perú',client:'KO tradicional',id:'other'}]:[t]});
 vm.runInContext(refresh,context);await context.refreshAudits();return {auditLookup,calls,state};
}
test('lector privado: sesión, aislamiento de proveedor, corte coherente y conservación ante fallos',async()=>{
 for(const role of ['comercial','validador','redigitador'])assert.equal((await runRefresh({role})).calls.length,0);
 const valid=await runRefresh();assert.equal(valid.auditLookup.entries['supi:123'].rows[0].AUDITOR,'Auditor SUPI');
 assert.equal(valid.auditLookup.entries['supi:456'].rows.length,0);assert.equal(valid.auditLookup.entries['123'].rows[0].nombre_usuario,'Auditor Databricks');
 for(const fail of [{fail:true},{mixed:true},{changed:true}]){
  const failed=await runRefresh(fail);assert.equal(failed.auditLookup.entries['supi:123'].rows[0].AUDITOR,'Anterior');
  assert.match(failed.auditLookup.error,/SUPI/);assert.ok(failed.calls.includes('databricks'));
 }
 const missing=await runRefresh({cut:false});assert.equal(missing.auditLookup.entries['supi:123'],undefined);
 const logout=await runRefresh({logout:true});assert.equal(logout.auditLookup.entries['supi:123'].rows[0].AUDITOR,'Anterior');assert.ok(!logout.calls.includes('databricks'));
});
test('migración: caché independiente, RLS, secreto por referencia, actualización atómica y agenda UTC',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261016141931_pqr_supi_chile_cache.sql','utf8');
 assert.match(sql,/conn_string_id %L/);assert.doesNotMatch(sql,/Password=|User=|SECURITY DEFINER/i);
 assert.match(sql,/v\.DIA>=''2026-01-01'' AND es\.id_estudio=525/);
 assert.match(sql,/pqr_supi_audit_cache enable row level security/);assert.match(sql,/pqr_supi_sync_state enable row level security/);
 assert.match(sql,/\('admin','gerente'\)/);assert.match(sql,/pqr_supi_case|pqr_is_supi_case/);
 assert.match(sql,/on commit drop/);assert.match(sql,/SUPI_REFRESH_FAILED/);assert.match(sql,/pg_try_advisory_xact_lock/);
 assert.match(sql,/'0 11,19 \* \* \*'/);assert.match(sql,/revoke all on function pqr_private\.refresh_supi\(\) from public, anon, authenticated, service_role/);
 for(const [field] of a.supiFields){
  const physical=field==='ID ESTUDIO'?'ID_ESTUDIO':field;
  assert.ok(sql.includes(`'${field}',s."${physical}"`),`Missing explicit foreign column: ${field}`);
 }
 assert.match(sql,/r->>'ID ESTUDIO' is distinct from '525'/);assert.match(sql,/r->>'DIA' is null/);
 const repair=fs.readFileSync('supabase/migrations/20261016143527_pqr_supi_complete_columns.sql','utf8');
 assert.match(repair,/rename column "ID ESTUDIO" to "ID_ESTUDIO"/);
 assert.match(repair,/create or replace function pqr_private\.refresh_supi/);
 assert.ok(repair.includes(sql.slice(sql.indexOf('declare cut'),sql.indexOf('-- pg_cron uses UTC'))));
});
