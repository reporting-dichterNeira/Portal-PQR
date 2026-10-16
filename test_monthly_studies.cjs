const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({window:{}});
for(const file of ['audits','history','reports'])vm.runInContext(fs.readFileSync(`docs/assets/${file}.js`,'utf8'),ctx);
const {PQRHistory:h,PQRReports:r,PQRAudits:a}=ctx.window;
const plain=v=>JSON.parse(JSON.stringify(v));
const base={id:'case',requestType:'PQR',origin:'historical',auditOriginal:'123',client:'KO PA',excelStudy:'KO PA',auditFallback:{canal:'MODERNO'},country:'Panamá',reportingMonth:'2026-07',status:'Cerrado',createdAt:'2026-10-01',applies:'Aplica'};
test('Survey unifica abreviaturas y separadores sin adivinar KO genérico',()=>{
 for(const value of ['ko_mod_co_202607','KO MODERNO','ko-moderno-pa','ko mod'])assert.equal(h.study(value),'KO moderno');
 for(const value of ['ko_trad_cr_202607','KO tradicional','ko-trad-hn','ko trad'])assert.equal(h.study(value),'KO tradicional');
 assert.equal(h.study('lindley_pe_202609','TRADICIONAL'),'Lindley');
 assert.equal(h.study('KO'),'');assert.equal(h.study('KO HN'),'');assert.equal(h.study('Otro estudio','MODERNO'),'');
});
test('Survey es prioritario; si no cruza, Canal del Excel separa KO sin mutar fuentes',()=>{
 const row={Survey:'ko_trad_pa_202607',Ola:'JUL 2026',pais:'Panamá'};
 const found=h.resolve(base,{entries:{123:{rows:[row]}}});
 assert.equal(found.client,'KO tradicional');assert.equal(found.studySource,'Databricks');assert.equal(base.client,'KO PA');
 for(const lookup of [{},{loaded:true,entries:{123:{rows:[]}}},{entries:{123:{rows:[row,row]}}}]){
   const fallback=h.resolve(base,lookup);assert.equal(fallback.client,'KO moderno');assert.equal(fallback.studySource,'Excel');
 }
 assert.equal(h.resolve({...base,excelStudy:'LINDLEY'},{}).client,'Lindley');
 assert.equal(h.resolve(base,{}, {patch:{client:'KO tradicional'}}).studySource,'Manual');
 assert.equal(h.resolve(base,{}, {patch:{client:'KO tradicional'}}).client,'KO tradicional');
 const unknown=h.resolve({...base,client:'KO',excelStudy:'KO',auditFallback:{}},{});assert.equal(unknown.client,'');assert.equal(unknown.studySource,'Sin clasificación');
 assert.equal(r.summarize([unknown]).total,1);
});
test('filtro solo ofrece tres estudios; ambos paneles muestran el evolutivo',()=>{
 const tickets=[h.resolve(base,{})];
 for(const view of ['overview','details','pending']){
   const html=r.render(tickets,[],{}, {view});
   const filter=html.match(/<select id="manager-study-filter">(.*?)<\/select>/s)[1];
   assert.equal((filter.match(/<option /g)||[]).length,4);
   for(const name of ['KO moderno','KO tradicional','Lindley'])assert.ok(filter.includes(`>${name}</option>`));
   assert.ok(!filter.includes('KO PA'));
   if(view!=='pending'){assert.match(html,/Evolutivo mensual de PQR/);assert.match(html,/Sin dictamen/);assert.match(html,/aria-label="Evolutivo mensual/);}
 }
 assert.equal(a.stats(tickets,{}).surveys[0].name,'KO moderno');
});
test('evolutivo usa mes de Ola, incluye cero meses intermedios y no mezcla RDG/EDC',()=>{
 const rows=r.monthlyTrend([base,{...base,id:'2',applies:'No Aplica'},{...base,id:'3',reportingMonth:'2026-09',applies:''},{...base,id:'4',requestType:'RDG'},{...base,id:'5',requestType:'EDC'}]);
 assert.deepEqual(plain(rows),[
   {month:'2026-07',total:2,aplica:1,noAplica:1,pending:0},
   {month:'2026-08',total:0,aplica:0,noAplica:0,pending:0},
   {month:'2026-09',total:1,aplica:0,noAplica:0,pending:1}
 ]);
 for(const row of rows)assert.equal(row.total,row.aplica+row.noAplica+row.pending);
 assert.equal(r.monthlyTrend([{...base,reportingMonth:'',origin:'platform'}])[0].month,'2026-10');
 assert.equal(r.monthlyTrend([{...base,reportingMonth:''}])[0].month,'Sin mes');
 assert.equal(r.monthlyTrend([]).length,0);
});
test('el evolutivo se calcula después de todos los filtros y no cambia fuentes',()=>{
 const tickets=[base,{...base,id:'2',country:'Perú',client:'Lindley',reportingMonth:'2026-08',applies:'No Aplica'},{...base,id:'3',origin:'platform',applies:''}];
 const before=JSON.stringify(tickets);
 const filtered=r.filterTickets(tickets,{country:'Panamá',study:'KO PA',origin:'historical',month:'2026-07'});
 assert.deepEqual(plain(r.monthlyTrend(filtered)),[{month:'2026-07',total:1,aplica:1,noAplica:0,pending:0}]);
 assert.equal(JSON.stringify(tickets),before);
 const html=r.render([],[],{}, {view:'overview'});assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/No hay PQR para esta selección/);
});
