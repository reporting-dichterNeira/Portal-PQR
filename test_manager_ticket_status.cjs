const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/assets/reports.js','utf8'),c);const report=c.window.PQRReports;
test('separa cerrados, abiertos con gestión y pendientes sin gestión',()=>{
 const cases=[{status:'Cerrado'},{status:'No Aplica'},{status:'Radicado'}, {status:'Radicado',validatorPersonId:'a'}, {status:'En Validación'}, {status:'Pendiente de Redigitación',requestType:'RDG'}, {status:'Pendiente de Redigitación',requestType:'EDC',redigitAssignedAt:'2026-11-12'}, {status:'Pendiente de Redigitación',requestType:'PQR'}, {status:'Reabierto'}];
 const s=report.summarize(cases);assert.equal(s.closed,2);assert.equal(s.pending,2);assert.equal(s.managedOpen,5);assert.equal(s.closed+s.pending+s.managedOpen,cases.length);
});
