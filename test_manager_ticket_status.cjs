const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/assets/reports.js','utf8'),c);const report=c.window.PQRReports;
test('separa cerrados, abiertos con gestión y pendientes sin gestión',()=>{
 const cases=[{status:'Cerrado'},{status:'No Aplica'},{status:'Radicado'}, {status:'Radicado',validatorPersonId:'a'}, {status:'En Validación'}, {status:'Pendiente de Redigitación',requestType:'RDG'}, {status:'Pendiente de Redigitación',requestType:'EDC',redigitAssignedAt:'2026-11-12'}, {status:'Pendiente de Redigitación',requestType:'PQR'}, {status:'Reabierto'}];
 const s=report.summarize(cases);assert.equal(s.closed,2);assert.equal(s.pending,2);assert.equal(s.managedOpen,5);assert.equal(s.closed+s.pending+s.managedOpen,cases.length);
});

test('cuenta el tipo de solicitud, incluidos tipos heredados y filtros',()=>{
 const cases=[{status:'Radicado',requestType:'PQR',country:'Guatemala'},{status:'Cerrado',code:'RDG-INT-2026-0001',country:'Guatemala'},{status:'Radicado',code:'EDC-INT-2026-0002',country:'Honduras'}];
 const all=report.summarize(cases);assert.equal(all.total,3);assert.equal(all.pqr,1);assert.equal(all.redigitations,1);assert.equal(all.edits,1);
 const filtered=report.summarize(report.filterTickets(cases,{country:'Guatemala'}));assert.equal(filtered.total,2);assert.equal(filtered.pqr,1);assert.equal(filtered.redigitations,1);assert.equal(filtered.edits,0);
});
