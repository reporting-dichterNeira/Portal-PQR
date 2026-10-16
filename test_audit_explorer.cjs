const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const real=require('./docs/assets/vendor/xlsx.full.min.js');
let exported;
const XLSX={...real,writeFile:(book,file)=>{exported={file,buffer:real.write(book,{type:'buffer',bookType:'xlsx'})};}};
const ctx=vm.createContext({window:{XLSX}});
for(const file of ['audits','history','reports'])vm.runInContext(fs.readFileSync(`docs/assets/${file}.js`,'utf8'),ctx);
const {PQRAudits:a,PQRReports:r}=ctx.window;
const tickets=Array.from({length:13},(_,i)=>({id:`t-${i}`,code:`PQR-2026-${i}`,requestType:'PQR',auditOriginal:String(i+1),country:'Perú',client:'Lindley',origin:'historical',reportingMonth:'2026-09',status:'Cerrado',applies:i===0?'':i%2?'Aplica':'No Aplica'}));
const lookup={...a.empty(),loaded:true,checkedAt:'2026-10-16T11:00:00Z',entries:Object.fromEntries(tickets.map((t,i)=>[t.auditOriginal,{at:'2026-10-16T11:00:00Z',rows:[{ID_de_audito:t.auditOriginal,pais:'Perú',nombre_usuario:`Auditor ${i}`,Validador:`Validador ${i}`,ciudad:`Ciudad ${i}`,region:`Región ${i}`,canal:`Canal ${i}`,Survey:'lindley_pe_202609'}]}]))};
test('seis botones cerrados de inicio, una sola categoría desplegada',()=>{
 const closed=a.render(tickets,lookup);
 assert.equal((closed.match(/aria-expanded="false"/g)||[]).length,6);assert.doesNotMatch(closed,/class="bar-chart"/);assert.doesNotMatch(closed,/class="audit-ranking-table"/);
 for(const key of ['auditors','validators','cities','regions','channels','surveys']){
   const html=a.render(tickets,lookup,key);
   assert.equal((html.match(/aria-expanded="true"/g)||[]).length,1);
   assert.match(html,new RegExp(`id="audit-dimension-${key}"[^>]*aria-expanded="true"`));
   assert.equal((html.match(/class="bar-chart"/g)||[]).length,1);
   assert.equal((html.match(/class="audit-ranking-table"/g)||[]).length,1);
   assert.match(html,/Exportar tabla \(Excel\)/);
 }
 assert.doesNotMatch(a.render(tickets,lookup,'constructor'),/aria-expanded="true"/);
 assert.match(a.render(tickets,{...lookup,loading:true},'validators'),/disabled>Exportar tabla/);
 assert.throws(()=>a.exportTable(tickets,{...lookup,loading:true},'validators'),/termine la lectura/);
});
test('gráfica top 10, tabla completa; datos y desconocidos mantienen su significado',()=>{
 const html=a.renderExplorer(tickets,lookup,'validators');
 assert.equal((html.match(/class="bar-row"/g)||[]).length,10);
 assert.equal((html.match(/<th scope="row">/g)||[]).length,13);
 const empty=a.renderExplorer([],lookup,'validators');assert.match(empty,/disabled>Exportar tabla/);assert.match(empty,/Sin datos vinculados/);
 const unsafe={...lookup,entries:{1:{rows:[{Validador:'<img src=x onerror=alert(1)>'}]}}};
 assert.match(a.renderExplorer([tickets[0]],unsafe,'validators'),/&lt;img/);assert.doesNotMatch(a.renderExplorer([tickets[0]],unsafe,'validators'),/<img/);
 const stats=a.stats([tickets[0],tickets[0],{...tickets[0],requestType:'RDG'},{...tickets[0],requestType:'EDC'}],lookup);
 assert.equal(stats.validators[0].count,2);assert.equal(stats.validators[0].audits,1);assert.equal(stats.validators[0].aplica,0);assert.equal(stats.validators[0].noAplica,0);
});
test('exportación XLSX real incluye los 13 registros y conserva números, filtros y alcance',()=>{
 const before=JSON.stringify(tickets);
 const count=a.exportTable(tickets,lookup,'validators',{country:'Perú',study:'Lindley',month:'2026-09',origin:'historical',status:'Cerrado',analystLabel:'Analista ejemplo'});
 assert.equal(count,13);assert.match(exported.file,/PQR_validadores_.*\.xlsx$/);
 const book=real.read(exported.buffer,{type:'buffer'}),sheet=book.Sheets.Validadores,rows=real.utils.sheet_to_json(sheet,{header:1});
 const header=rows.findIndex(row=>row[0]==='Validador de auditoría');
 assert.equal(rows.length-header-1,13);assert.equal(sheet['!autofilter'].ref,`A${header+1}:F${rows.length}`);
 assert.ok(rows.some(row=>row[0]==='País'&&row[1]==='Perú'));assert.ok(rows.some(row=>row[0]==='Mes de auditoría'&&row[1]==='2026-09'));
 assert.ok(rows.some(row=>row[0]==='Analista de PQR'&&row[1]==='Analista ejemplo'));
 for(const row of rows.slice(header+1)){for(const value of row.slice(1))assert.equal(typeof value,'number');assert.equal(row[1],row[3]+row[4]+row[5]);}
 assert.equal(JSON.stringify(tickets),before);
});
test('filtrar el dashboard cambia tabla y exportación en ambas hojas, sin consultas nuevas',()=>{
 const all=[...tickets,{...tickets[0],id:'other',country:'Chile',origin:'platform',reportingMonth:'2026-10'}];
 const filters={country:'Perú',origin:'historical',month:'2026-09',study:'Lindley',auditDimension:'validators',auditLookup:lookup};
 for(const view of ['overview','details']){
   const html=r.render(all,[],{}, {...filters,view});assert.match(html,/Validadores con más PQR/);assert.match(html,/13 registros/);
 }
 const selected=r.filterTickets(all,filters);assert.equal(a.exportTable(selected,lookup,'validators',filters),13);
 assert.throws(()=>a.exportTable([],lookup,'validators'),/No hay datos/);assert.throws(()=>a.exportTable(tickets,lookup,'__proto__'),/categoría válida/);
 const production=fs.readFileSync('docs/assets/production.js','utf8');
 assert.match(production,/state.me.role === 'gerente' && type === 'audit-dimension'/);
 assert.match(production,/state.me.role === 'gerente' && type === 'export-audit-table'/);
 assert.match(production,/\.outerHTML=window.PQRAudits.renderExplorer/);
});
test('exportador protege nombres que Excel podría interpretar como fórmulas',()=>{
 const malicious={...lookup,entries:{1:{rows:[{Validador:'=HYPERLINK("http://example.test")'}]}}};
 a.exportTable([tickets[0]],malicious,'validators');
 const book=real.read(exported.buffer,{type:'buffer'}),sheet=book.Sheets.Validadores;
 const rows=real.utils.sheet_to_json(sheet,{header:1});assert.ok(rows.at(-1)[0].startsWith("'="));
 assert.ok(!Object.values(sheet).some(cell=>cell?.f));
});
