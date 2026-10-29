const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/assets/analyst-batch.js','utf8'),context);
const {suggestionHtml:html,suggestionValue:value}=context.window.PQRAnalystBatch;
const ticket={id:'one',pdv:'00123'},s={ticketId:'one',status:'found',pdv:'00123',auditId:'987654',auditDate:'2026-10-27 08:00:00',ola:'OCTUBRE 2026',checkedAt:'2026-10-29T11:00:00Z'};
test('suggestion requires explicit confirmation, retains manually entered IDs on confirm-all and checks PDV identity',()=>{
 assert.equal(value(ticket,s,'',undefined,true),'987654');
 assert.equal(value(ticket,s,'123456',undefined,true),null);
 assert.equal(value(ticket,s,'123456',undefined,false),'987654');
 assert.equal(value(ticket,s,'','99999',false),null);
 assert.equal(value(ticket,{...s,ticketId:'another'},''),null);
 for(const status of ['pending','not_found','unsupported','missing_pdv','expired'])assert.equal(value(ticket,{...s,status},''),null);
 assert.equal(ticket.pdv,'00123');assert.equal(s.auditId,'987654');
});
test('suggestion card shows audit date, cut and 60-day scope; source text is escaped',()=>{
 const rendered=html({...s,auditDate:'<img onerror=bad()>',ola:'<svg>','checkedAt':'cut'},v=>v);
 assert.match(rendered,/ID sugerido: 987654/);assert.match(rendered,/Últimos 60 días/);assert.match(rendered,/Corte: cut/);
 assert.match(rendered,/Confirmar sugerencia/);assert.match(rendered,/&lt;img/);assert.doesNotMatch(rendered,/<img|<svg/);
 for(const status of ['pending','not_found','unsupported','missing_pdv','expired']){
  const card=html({...s,status});assert.match(card,/manualmente/);assert.doesNotMatch(card,/data-confirm-suggestion/);
 }
 assert.doesNotMatch(html({...s,auditId:"1' OR TRUE"}),/data-confirm-suggestion/);
});
