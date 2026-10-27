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
