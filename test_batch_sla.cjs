const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({window:{},Date,BigInt,crypto:{randomUUID:()=> 'request-1'}});
for(const name of ['bulk','sla'])vm.runInContext(fs.readFileSync('docs/assets/'+name+'.js','utf8'),c);
const bulk=c.window.PQRBulk,sla=c.window.PQRSLA,iso=value=>new Date(value).toISOString();
test('consecutivos preservan prefijos, ceros y números mayores al límite seguro',()=>{
 assert.deepEqual(Array.from(bulk.generate(' TK-0098 ',4)),['TK-0098','TK-0099','TK-0100','TK-0101']);
 assert.deepEqual(Array.from(bulk.generate('9007199254740992',2)),['9007199254740992','9007199254740993']);
 for(const [id,n] of [['abc',3],['1',0],['1',101],['1',1.2],['a'.repeat(100)+'1',2]])assert.throws(()=>bulk.generate(id,n));
 assert.equal(bulk.generate('1',100).length,100);
});
test('IDs editados se conservan, se recortan y no admiten duplicados ni vacíos',()=>{
 assert.deepEqual(Array.from(bulk.validate(['7001',' 9990 ','7003'])),['7001','9990','7003']);
 for(const ids of [[],['1',''],['TK-A','tk-a'],['1'.repeat(101)]])assert.throws(()=>bulk.validate(ids));
 assert.equal(bulk.bogotaInput('2026-10-19T05:30:00Z'),'2026-10-19T00:30');
 const html=bulk.receipt({tickets:[{externalTicketId:'<x>',code:'PQR-1'}]},s=>s.replaceAll('<','&lt;').replaceAll('>','&gt;'));
 assert.match(html,/&lt;x&gt;/);assert.doesNotMatch(html,/<x>/);
});
test('48 horas de lunes a viernes: fin de semana, medianoche y cambios de año',()=>{
 for(const [start,end] of [
  ['2026-10-19T10:00:00-05:00','2026-10-21T10:00:00-05:00'],
  ['2026-10-23T10:00:00-05:00','2026-10-27T10:00:00-05:00'],
  ['2026-10-24T12:00:00-05:00','2026-10-28T00:00:00-05:00'],
  ['2026-10-25T23:59:00-05:00','2026-10-28T00:00:00-05:00'],
  ['2026-10-22T00:00:00-05:00','2026-10-24T00:00:00-05:00'],
  ['2026-12-31T12:00:00-05:00','2027-01-04T12:00:00-05:00']
 ]){assert.equal(iso(sla.addHours(start)),iso(end));assert.equal(sla.between(start,end),48*3600000);}
 assert.ok(Number.isNaN(sla.addHours('invalid')));
 // No exclusion of nights or holidays was requested.
 assert.equal(sla.between('2026-12-24T22:00-05:00','2026-12-25T06:00-05:00'),8*3600000);
});
test('reloj no descuenta sábados/domingo y conserva las etapas de reapertura, verificación y redigitación',()=>{
 const friday='2026-10-23T10:00:00-05:00',end=sla.addHours(friday);
 assert.equal(sla.clock(end,Date.parse('2026-10-24T00:00-05:00')).text,sla.clock(end,Date.parse('2026-10-25T23:59-05:00')).text);
 assert.equal(sla.clock(end,Date.parse('2026-10-26T00:00-05:00')).text,'Restan 34 h 00 min hábiles');
 const t={receivedAt:'received',createdAt:'created',assignedAt:'assigned',reopenedAt:'reopened',redigitAt:'returned',redigitRequestedAt:'requested',status:'Radicado'};
 assert.equal(sla.start(t,'validador'),'reopened');delete t.reopenedAt;
 assert.equal(sla.start(t,'validador'),'received');delete t.receivedAt;
 assert.equal(sla.start(t,'validador'),'assigned');t.status='Pendiente de Verificación';
 assert.equal(sla.start(t,'validador'),'returned');assert.equal(sla.start(t,'redigitador'),'requested');
});
test('horas hábiles coinciden con un cálculo independiente a intervalos de media hora',()=>{
 const base=Date.parse('2026-10-19T00:00-05:00'),half=1800000;
 for(let offset=0;offset<7*48;offset+=13){
  const start=base+offset*half,end=start+(48*16+offset)*half;
  let expected=0;for(let at=start;at<end;at+=half){const d=new Date(at-5*3600000).getUTCDay();if(d!==0&&d!==6)expected+=Math.min(half,end-at);}
  assert.equal(sla.between(start,end),expected);assert.equal(sla.between(end,start),-expected);
 }
});
test('formulario envía lista editada y fecha recibida, mismo request en reintento; no permite enviar sin preparar',async()=>{
 const controls=Object.fromEntries(['client','country','clientOther','receivedAt','count','firstTicketId'].map(k=>[k,{value:''}]));
 Object.assign(controls.client,{value:'KO moderno'});controls.country.value='Chile';controls.receivedAt.value='2026-10-19T09:00';controls.count.value='3';controls.firstTicketId.value='7001';
 const create={disabled:true},error={},status={},generate={},other={classList:{toggle(){}}};let inputs=[];
 const preview={set innerHTML(html){this.html=html;inputs=[...html.matchAll(/data-bulk-ticket[^>]+value="([^"]+)"/g)].map(m=>({value:m[1]}));},get innerHTML(){return this.html;}};
 const selectors={'#bulk-preview':preview,'#bulk-error':error,'#bulk-status':status,'#bulk-create':create,'#bulk-generate':generate,'#bulk-other-client':other};
 const form={elements:controls,reportValidity:()=>true,querySelector:s=>selectors[s],querySelectorAll:s=>s==='[data-bulk-ticket]'?inputs:[...Object.values(controls),...inputs,create,generate]};
 c.document={querySelector:()=>form};let calls=[],success=0,html;
 bulk.open({allowed:true,clients:['KO moderno'],countries:['Chile'],esc:s=>s,modal:(_,s)=>html=s,save:async(id,payload)=>{calls.push({id,payload});if(calls.length===1)throw new Error('network');return {tickets:[]};},onSuccess:async()=>success++});
 assert.match(html,/Fecha y hora de recepción/);assert.doesNotMatch(html,/name="channel"|name="source"/);
 await form.onsubmit({preventDefault(){}});assert.equal(calls.length,0);
 generate.onclick();assert.deepEqual(inputs.map(i=>i.value),['7001','7002','7003']);inputs[1].value='9999';
 await form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});
 assert.equal(success,1);assert.equal(calls[0].id,calls[1].id);assert.equal(calls[0].payload.scope,'external');assert.equal(calls[0].payload.receivedAt,'2026-10-19T09:00-05:00');
 assert.deepEqual(Array.from(calls[0].payload.tickets,t=>t.externalTicketId),['7001','9999','7003']);
 controls.count.value='4';controls.count.oninput();assert.equal(create.disabled,true);
 await form.onsubmit({preventDefault(){}});assert.equal(calls.length,2);
 inputs[1].value='7001';controls.count.value='3';await form.onsubmit({preventDefault(){}});assert.match(error.textContent,/repetidos/);assert.equal(calls.length,2);
});
test('integración conserva límite de roles/ámbito, fecha exportada y reloj compartido',()=>{
 const app=fs.readFileSync('docs/assets/production.js','utf8'),index=fs.readFileSync('docs/index.html','utf8'),reports=fs.readFileSync('docs/assets/reports.js','utf8');
 assert.match(app,/type === 'new-batch-pqr' && canCreateManualPqr\(\)/);assert.match(app,/pqr_create_manual_batch/);
 assert.match(app,/window.PQRSLA.clock/g);assert.doesNotMatch(app,/Plazo SLA · 24 h|\+ 86400000/);
 assert.match(app,/Plazo SLA · 48 h/);assert.match(reports,/Fecha\/hora recepción \(Bogotá\)/);
 for(const name of ['sla','bulk'])assert.ok(index.indexOf('assets/'+name+'.js')<index.indexOf('assets/production.js'));
 const sql=fs.readFileSync('supabase/migrations/20261019170118_client_bulk_intake.sql','utf8');
 assert.match(sql,/role not in \('validador','gerente'\)/);assert.match(sql,/security invoker/);assert.match(sql,/enable row level security/);assert.match(sql,/payload_hash<>fingerprint/);
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/create_manual_pqr/);assert.match(sql,/receivedAt/);
});
