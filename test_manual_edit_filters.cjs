const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/assets/production.js','utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture={id:'manual',manualEntry:true,requestType:'PQR',createdBy:'creator',client:'KO moderno',country:'Chile',createdAt:'2026-10-01',status:'Radicado',recordUpdatedAt:'2026-10-16T15:00:00.123456Z',code:'PQR-2026-0058',externalTicketId:'<script>mal</script>',pdv:'',description:''};
function harness(role='validador'){
 const dialogs=[],calls=[],metrics=[],tables=[];
 const form={elements:{client:{},clientOther:{}}},view={innerHTML:'',filters:'',querySelector(){return{insertAdjacentHTML:(_,html)=>view.filters=html}}};
 const state={me:{id:'creator',role},tickets:[fixture,{...fixture,id:'other',client:'Lindley',country:'Perú',createdAt:'2026-09-01',status:'Cerrado',validatorPersonId:'v1'}],staff:{validators:[{id:'v1',name:'Ana'}],redigitators:[]}};
 const c=vm.createContext({window:{PQRScopes:{label:()=> 'PQR de clientes'}},workspace:'external',scopeTickets:()=>state.tickets,state,esc,clients:['KO moderno','KO tradicional','Lindley','Otros'],countries:['Chile','Perú'],
  analystFilters:{country:'all',study:'all',month:'all',origin:'all',type:'all',status:'all',analyst:'all'},
  requestType:t=>t.requestType||'PQR',staffName:(_,id)=>id==='v1'?'Ana':'',
  $:sel=>sel==='#edit-manual-form'?form:sel==='#view'?view:sel==='#view h1'?{}:null,
  modal:(title,html)=>dialogs.push({title,html}),header:()=>'',metric:(label,n)=>{metrics.push([label,n]);return''},ticketTable:cases=>{tables.push(cases);return''},
  formData:()=>({externalTicketId:' REF-2 ',pdv:' 00123 ',description:' descripción corregida ',client:'KO tradicional',country:'Perú',reason:' Estudio mal digitado ',status:'Cerrado'}),
  submit:async(_,fn)=>fn(),db:{rpc:async(name,args)=>{calls.push({name,args});return {error:null}}}});
 vm.runInContext(fs.readFileSync('docs/assets/reports.js','utf8'),c);c.PQRReports=c.window.PQRReports;
 vm.runInContext(part('  const manualPqrRoles','  let state')+part('  function editManualPqr(','  function detail(')+part('  function analyst()','  function redigitator()'),c);
 return {c,dialogs,calls,form,state,view,metrics,tables};
}
test('corregir una radicación manual conserva versión, limita campos y escapa valores',async()=>{
 const h=harness();h.c.ticket=fixture;vm.runInContext('editManualPqr(ticket)',h.c);
 assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0].title,/Editar radicación/);assert.doesNotMatch(h.dialogs[0].html,/<script>/);
 assert.match(h.dialogs[0].html,/Motivo de la corrección/);assert.doesNotMatch(h.dialogs[0].html,/name="pdv"[^>]*required/);
 await h.form.onsubmit({preventDefault(){}});
 assert.equal(h.calls[0].name,'pqr_edit_manual');assert.equal(h.calls[0].args.p_expected_updated_at,fixture.recordUpdatedAt);
 assert.equal(h.calls[0].args.p_data.pdv,'00123');assert.equal(h.calls[0].args.p_data.client,'KO tradicional');assert.ok(!('status'in h.calls[0].args.p_data));
});
test('corrección mantiene requisitos tras dictamen y permisos por creador/rol',()=>{
 const h=harness();h.c.ticket={...fixture,status:'Cerrado',applies:'Aplica'};vm.runInContext('editManualPqr(ticket)',h.c);
 assert.match(h.dialogs[0].html,/name="pdv"[^>]*required/);assert.match(h.dialogs[0].html,/name="description"[^>]*required minlength="8"/);
 for(const role of ['gerente','comercial','redigitador','admin']){const p=harness(role);p.c.ticket={...fixture,createdBy:'another'};vm.runInContext('editManualPqr(ticket)',p.c);assert.equal(p.dialogs.length,0);}
 const own=harness('gerente');own.c.ticket=fixture;vm.runInContext('editManualPqr(ticket)',own.c);assert.equal(own.dialogs.length,1);
 for(const ticket of [{...fixture,manualEntry:false},{...fixture,deletedAt:'2026-10-16'},{...fixture,requestType:'EDC'}]){h.c.ticket=ticket;assert.equal(vm.runInContext('canEditManualPqr(ticket)',h.c),false);}
});
test('siete filtros combinables, contadores y tabla usan el mismo segmento y opciones completas',()=>{
 const h=harness();vm.runInContext('analyst()',h.c);
 for(const key of ['country','study','month','origin','type','status','analyst'])assert.match(h.view.filters,new RegExp(`id="analyst-${key}-filter"`));
 vm.runInContext('analystFilters.country="Perú"; analystFilters.study="Lindley"; analystFilters.month="2026-09"; analystFilters.analyst="Ana"; analystFilters.status="Cerrado"; analyst()',h.c);
 assert.equal(h.tables.at(-1).length,1);assert.equal(h.tables.at(-1)[0].id,'other');assert.deepEqual(h.metrics.at(-4),['Total',1]);
 assert.match(h.view.filters,/Chile/);assert.match(h.view.filters,/KO moderno/);assert.match(h.view.filters,/1 de 2 solicitudes/);
 vm.runInContext('analystFilters.origin="historical"; analyst()',h.c);assert.equal(h.tables.at(-1).length,0);
 assert.match(h.view.filters,/históricos de Excel se consultan en Gerencia/);
});
test('Gerencia puede reabrir correcciones de indicadores desde ambas tablas',()=>{
 const h=harness('gerente');
 for(const view of ['overview','details']){
  const html=h.c.PQRReports.render([{...fixture,origin:'platform',hasManualData:true}],[],{validators:[],redigitators:[]},{view,currentUserId:'creator'});
  assert.match(html,/data-action="complete-data"[^>]*>Editar datos/);assert.match(html,/data-action="edit-manual-pqr"/);
  const other=h.c.PQRReports.render([{...fixture,hasManualData:true}],[],{validators:[],redigitators:[]},{view,currentUserId:'another'});
  assert.doesNotMatch(other,/data-action="edit-manual-pqr"/);
 }
});
