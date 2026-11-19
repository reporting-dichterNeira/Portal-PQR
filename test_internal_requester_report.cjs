const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const sheets=[];const XLSX={utils:{book_new:()=>({}),aoa_to_sheet:rows=>{sheets.push(rows);return{}},book_append_sheet(){},encode_col:()=> 'Z'},writeFile(){}};
 const c=vm.createContext({window:{XLSX},XLSX});
 for(const file of ['audits','history','reports'])vm.runInContext(fs.readFileSync(`docs/assets/${file}.js`,'utf8'),c);
 return {reports:c.window.PQRReports,history:c.window.PQRHistory,sheets};
}
const ticket={id:'internal',code:'PQR-INT-2026-0018',scope:'internal',requestType:'PQR',requesterName:'María Comercial',requesterEmail:'private@example.invalid',client:'KO tradicional',country:'Guatemala',createdAt:'2026-10-27T15:09:00Z',status:'Radicado',commercial:'shared-account'};
test('both management tables display the declared requester for PQR, RDG and EDC',()=>{
 const {reports,history}=setup();
 for(const requestType of ['PQR','RDG','EDC'])for(const view of ['overview','details']){
  const resolved=history.resolve({...ticket,requestType},{});
  const html=reports.render([resolved],[{id:'shared-account',name:'Cuenta compartida'}],{}, {view,scope:'internal'});
  assert.match(html,/<th>Comercial \/ solicitante<\/th>/);assert.match(html,/<td>María Comercial<\/td>/);
  assert.doesNotMatch(html,/private@example.invalid|Cuenta compartida/);
 }
});
test('names are escaped, missing names are explicit and external tables remain unchanged',()=>{
 const {reports}=setup();
 for(const view of ['overview','details']){
  const html=reports.render([{...ticket,requesterName:'<img src=x onerror=alert(1)>'}],[],{},{view});
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img src=x/);
  assert.match(reports.render([{...ticket,requesterName:'  '}],[],{},{view}),/<td>No indicado<\/td>/);
  assert.doesNotMatch(reports.render([{...ticket,scope:'external'}],[],{},{view}),/Comercial \/ solicitante|María Comercial/);
 }
});
test('column and empty-state colspan are retained when filters remove all internal rows',()=>{
 const {reports}=setup();
 for(const [view,columns] of [['overview',7],['details',8]]){
  const html=reports.render([ticket],[],{},{view,country:'Perú',scope:'internal'});
  assert.match(html,/<th>Comercial \/ solicitante<\/th>/);assert.match(html,new RegExp(`colspan="${columns}"`));assert.doesNotMatch(html,/<td>María Comercial<\/td>/);
 }
 assert.match(reports.render([],[],{},{scope:'internal'}),/<th>Comercial \/ solicitante<\/th>/);
});
test('Excel exports the internal requester without exposing contact email or losing client names',()=>{
 const {reports,sheets}=setup();
 reports.excelCases([ticket,{...ticket,id:'other',scope:'external',commercialName:'Comercial de cliente'},{...ticket,id:'formula',requesterName:'=SUM(A1:A2)'}]);
 assert.equal(sheets[0][0][3],'Comercial / solicitante');assert.equal(sheets[0][1][3],'María Comercial');
 assert.equal(sheets[0][2][3],'Comercial de cliente');assert.equal(sheets[0][3][3],"'=SUM(A1:A2)");
 assert.doesNotMatch(JSON.stringify(sheets),/private@example.invalid/);
});


test('internal status and requester filters combine with type; Excel contains only matching rows',()=>{
 const {reports,sheets}=setup();
 const tickets=[{...ticket,pdv:'000123',description:'Detalle PQR'}, {...ticket,id:'rdg',requestType:'RDG',status:'Cerrado'}, {...ticket,id:'another',requesterName:'Otro comercial'}, {...ticket,id:'closed',status:'Cerrado'}];
 const filters={status:'Radicado',requester:'María Comercial',type:'PQR'};
 const chosen=reports.filterTickets(tickets,filters);
 assert.deepEqual(chosen.map(t=>t.id),['internal']);
 reports.excelCases(chosen);
 const [headers,row]=sheets[0];
 assert.equal(sheets[0].length,2);assert.equal(row[headers.indexOf('ID PDV')],'000123');assert.equal(row[headers.indexOf('Descripción')],'Detalle PQR');
 assert.equal(row[headers.indexOf('Estado')],'Radicado');assert.equal(row[headers.indexOf('Comercial / solicitante')],'María Comercial');
 for(const html of [reports.listFilters(tickets,{},filters,{scope:'internal'}),reports.internalListFilters(tickets,filters)]) {
  assert.match(html,/Comercial \/ solicitante/);assert.match(html,/>Estado</);assert.match(html,/1 de 4 solicitudes/);
 }
 assert.match(reports.listFilters([],{}, {},{scope:'internal'}),/Comercial \/ solicitante/);
 assert.doesNotMatch(reports.listFilters([{...ticket,scope:'external'}],{},{}),/Comercial \/ solicitante/);
});

test('requester options escape user input, deduplicate and allow missing names',()=>{
 const {reports}=setup();
 const tickets=[{...ticket,requesterName:' <img src=x> '},{...ticket,requesterName:'<img src=x>'},{...ticket,requesterName:' '}];
 const html=reports.internalListFilters(tickets,{requester:'<img src=x>'});
 assert.doesNotMatch(html,/<img/);assert.equal((html.match(/value="&lt;img src=x&gt;"/g)||[]).length,1);assert.match(html,/No indicado/);
 assert.equal(reports.filterTickets(tickets,{requester:'No indicado'}).length,1);
});


test('several internal statuses form a union and combine with country and requester in exports',()=>{
 const {reports,sheets}=setup();
 const data=[{...ticket,status:'Radicado',pdv:'000001'},{...ticket,id:'review',status:'En Validación',pdv:'000002'},{...ticket,id:'closed',status:'Cerrado'},{...ticket,id:'other-country',country:'Honduras',status:'Radicado'}];
 const filters={status:['Radicado','En Validación'],country:'Guatemala',requester:'María Comercial'};
 const selected=reports.filterTickets(data,filters);assert.deepEqual(selected.map(t=>t.id),['internal','review']);
 reports.excelCases(selected);assert.equal(sheets[0].length,3);const h=sheets[0][0];assert.deepEqual(Array.from(sheets[0].slice(1),r=>r[h.indexOf('Estado')]),['Radicado','En revisión']);
 for(const html of [reports.listFilters(data,{},filters,{scope:'internal'}),reports.internalListFilters(data,filters),reports.render(data,[],{},{...filters,scope:'internal'})]) {
  assert.match(html,/2 estados seleccionados/);assert.match(html,/type="checkbox"[^>]*value="Radicado" checked/);assert.match(html,/type="checkbox"[^>]*value="En Validación" checked/);
 }
});

test('unchecking and selecting all statuses clears restrictions without losing other filters',()=>{
 const {reports}=setup();let current=reports.toggleStatus('all','Radicado',true);current=reports.toggleStatus(current,'En Validación',true);
 assert.deepEqual(Array.from(current),['Radicado','En Validación']);current=reports.toggleStatus(current,'Radicado',false);assert.deepEqual(Array.from(current),['En Validación']);
 assert.equal(reports.toggleStatus(current,'En Validación',false),'all');assert.equal(reports.toggleStatus(current,'all',true),'all');
 assert.equal(reports.filterTickets([ticket,{...ticket,country:'Honduras'}],{status:'all',country:'Guatemala'}).length,1);
});
