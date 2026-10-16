const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/assets/production.js','utf8');
const dictate=source.slice(source.indexOf('  function dictate('),source.indexOf('  function assignRedigit('));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function formFor(ticket,payload){
 const calls=[],dialogs=[];
 const form={elements:{area:{value:''},tipology:{value:''},areaOther:{value:''}}};
 const ctx=vm.createContext({state:{tips:['Insumos'],tipAreas:{Insumos:'Comercial'}},combinedArea:'OPS Campo/Validación',standardAreas:['Comercial','IT'],esc,
  staffName:()=> 'Analista',options:values=>values.map(v=>`<option>${esc(v)}</option>`).join(''),
  modal:(title,html)=>dialogs.push({title,html}),$:selector=>selector==='#action-form'?form:{classList:{toggle(){}},textContent:''},
  formData:()=>({...payload}),submit:async(_form,task)=>task(),action:async(name,id,data)=>{calls.push({name,id,data});}
 });
 vm.runInContext(dictate,ctx);ctx.dictate(ticket);
 return {calls,dialogs,form};
}
const ticket={id:'case',code:'PQR-2026-1234',manualEntry:true,externalTicketId:'TK-0001',pdv:'',description:'',validatorPersonId:'staff'};
const base={decision:'yes',area:'Comercial',tipology:'Insumos',auditOriginal:'123',response:'Respuesta completa'};
test('dictamen manual muestra PDV y descripción requeridos para todos los resultados',()=>{
 const p=formFor(ticket,base),html=p.dialogs[0].html;
 assert.match(html,/Ticket de origen: TK-0001/);
 assert.match(html,/name="pdv"[^>]*data-numeric required maxlength="80"/);
 assert.match(html,/name="description" required minlength="8" maxlength="12000"/);
 assert.match(html,/name="auditOriginal"[^>]*required/);assert.match(html,/name="response" required minlength="5"/);
 for(const decision of ['no','yes','redigit'])assert.ok(html.includes(`value="${decision}"`));
 const ordinary=formFor({...ticket,manualEntry:false},base).dialogs[0].html;
 assert.doesNotMatch(ordinary,/name="pdv"|name="description"/);
});
test('dictamen bloquea omisiones y valores inválidos antes de invocar el servidor',async()=>{
 for(const decision of ['no','yes','redigit'])for(const extra of [{},{pdv:'123'},{description:'Texto completo'},
  {pdv:'abc',description:'Texto completo'},{pdv:'1'.repeat(81),description:'Texto completo'},
  {pdv:'123',description:'corta'},{pdv:'123',description:' '.repeat(20)},{pdv:'123',description:'x'.repeat(12001)}]){
   const p=formFor(ticket,{...base,decision,...extra});
   await assert.rejects(p.form.onsubmit({preventDefault(){}}),/Completa/);assert.equal(p.calls.length,0);
 }
});
test('dictamen envía valores completos normalizados, conserva ceros y rellena el formulario existente',async()=>{
 for(const decision of ['no','yes','redigit']){
  const p=formFor(ticket,{...base,decision,pdv:' 00123 ',description:' Descripción completa de la solicitud. '});
  await p.form.onsubmit({preventDefault(){}});
  assert.equal(p.calls[0].name,'dictate');assert.equal(p.calls[0].id,'case');
  assert.equal(p.calls[0].data.pdv,'00123');assert.equal(p.calls[0].data.description,'Descripción completa de la solicitud.');
 }
 const html=formFor({...ticket,pdv:'0001',description:'</textarea><script>injection</script>',externalTicketId:'<img src=x>'},base).dialogs[0].html;
 assert.match(html,/value="0001"/);assert.match(html,/&lt;\/textarea&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img/);
});
test('referencia visible y exportada como texto sin alterar Comercial ni el radicado',()=>{
 const real=require('./docs/assets/vendor/xlsx.full.min.js');let buffer;
 const XLSX={...real,writeFile:book=>{buffer=real.write(book,{type:'buffer',bookType:'xlsx'});}};
 const ctx=vm.createContext({window:{XLSX},XLSX,Date,Intl});
 vm.runInContext(fs.readFileSync('docs/assets/reports.js','utf8'),ctx);
 ctx.window.PQRReports.excelCases([{...ticket,externalTicketId:'0000123'},{...ticket,code:'PQR-2',externalTicketId:'=SUM(A1:A2)'}]);
 const book=real.read(buffer,{type:'buffer'}),rows=real.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
 const index=rows[0].indexOf('ID de ticket de origen');assert.ok(index>=0);
 assert.equal(rows[1][index],'0000123');assert.equal(rows[1][1],ticket.code);assert.equal(rows[1][3],'No indicado');
 assert.equal(rows[2][index],"'=SUM(A1:A2)");
 const html=ctx.window.PQRReports.render([{...ticket,externalTicketId:'<script>ref</script>'}],[],{},{view:'details'});
 assert.match(html,/Ticket de origen: &lt;script&gt;ref/);assert.doesNotMatch(html,/<script>/);
});
test('migración conserva autorización, núcleo no público y aplicación atómica al dictaminar',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261016145732_manual_pqr_fast_intake.sql','utf8');
 assert.match(sql,/v_actor.role not in \('validador','gerente'\)/);
 assert.match(sql,/if v_pdv<>'' and/);assert.match(sql,/length\(v_description\)>12000/);
 assert.match(sql,/externalTicketId/);assert.match(sql,/if v_data->>'manualEntry'='true' then/);
 assert.match(sql,/v_detail !~ '\^\[0-9\]\{1,80\}\$'/);assert.match(sql,/length\(v_name\) not between 8 and 12000/);
 assert.match(sql,/intakeCompletedAt/);assert.match(sql,/Información de radicación completada/);
 assert.match(sql,/array_length\(string_to_array\(definition,anchor\),1\)<>2/);
 assert.match(sql,/revoke all on function public.pqr_action_legacy\(text,uuid,jsonb\) from public, anon, authenticated/);
 assert.doesNotMatch(sql,/alter policy|alter table|create policy/i);
});
