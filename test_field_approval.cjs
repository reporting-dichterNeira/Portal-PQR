const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('docs/assets/production.js','utf8');
const c=vm.createContext({state:{me:{isUniversal:false}},esc:String,canEditManualPqr:()=>false,requestType:t=>t.requestType||'RDG'});
vm.runInContext(app.slice(app.indexOf('  function ticketActions('),app.indexOf('  function analyst()')),c);
const ticket={id:'test',fieldAccountId:'field',requestType:'RDG'};
test('Field response is reviewed only by Validation and cannot be closed by analysts yet',()=>{
 const waiting={...ticket,status:'Pendiente de aprobación de Validación'};
 assert.match(c.ticketActions(waiting,'redigitador'),/field-review/);
 assert.doesNotMatch(c.ticketActions(waiting,'validador'),/verify|dictate/);
 assert.equal(c.ticketActions(waiting,'campo'),'');
 const approved={...ticket,status:'Pendiente de Verificación'};
 assert.match(c.ticketActions(approved,'validador'),/data-action="verify"/);
 assert.doesNotMatch(c.ticketActions(approved,'redigitador'),/field-review/);
 assert.match(c.ticketActions({...ticket,status:'Devuelto'},'campo'),/field-complete/);
});
test('Database enforces approval for the same resulting audit before analyst closure',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261124220000_field_validation_approval.sql','utf8');
 assert.match(sql,/fieldApprovedAudit.*is distinct from.*audit/);
 assert.match(sql,/actor.role is distinct from 'redigitador'/);
 assert.match(sql,/for update/);
 assert.match(sql,/field_review.*review_field/);
 assert.match(app,/Enviar a revisión de Validación/);
});
