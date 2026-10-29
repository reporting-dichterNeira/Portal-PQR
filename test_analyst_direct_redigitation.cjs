const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/assets/production.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function portal(role,workspace='external') {
 const calls=[],dialogs=[],notices=[];
 const form={elements:{attachments:{},client:{value:'KO tradicional'},clientOther:{value:''}}};
 const context=vm.createContext({workspace,state:{me:{id:'analyst',role}},
  modal:(title,html)=>dialogs.push({title,html}),$:()=>form,options:()=>'',clients:[],countries:[],
  attachmentField:()=>'<input type="file" name="attachments" multiple>',bindAttachmentSelection(){},
  checkedAttachments:()=>[],submit:async(_,task)=>task(),uploadAttachments:async()=>[],
  formData:()=>({pdv:'00123',auditOriginal:'998877',description:'Corregir captura de precios'}),
  alert:text=>notices.push(text),db:{rpc:async(name,args)=>{calls.push({name,args});return{data:{id:'new',code:'RDG-2026-0123'}};}}
 });
 vm.runInContext(section('  const manualPqrRoles','  let state')+section('  async function createAnalystRedigitation','  async function createManualPqr')+section('  function newTicket(','  function editManualPqr('),context);
 return{context,calls,dialogs,notices,form};
}
for(const workspace of ['internal','external']) test(`Analistas envía RDG desde ${workspace} con auditoría y adjuntos propios`,async()=>{
 const p=portal('validador',workspace);
 assert.match(vm.runInContext('analystRedigitationButton()',p.context),/new-analyst-redigitation/);
 vm.runInContext('newTicket("RDG",false,true)',p.context);
 assert.match(p.dialogs[0].html,/directamente al equipo de Redigitación/);
 assert.match(p.dialogs[0].html,/name="auditOriginal"[^>]*required/);
 assert.match(p.dialogs[0].html,/name="pdv"[^>]*required/);
 assert.match(p.dialogs[0].html,/Motivo de la redigitación/);
 await p.form.onsubmit({preventDefault(){}});
 assert.equal(p.calls[0].name,'pqr_create_analyst_redigitation');
 assert.equal(p.calls[0].args.p_data.scope,workspace);
 assert.equal(p.calls[0].args.p_data.auditOriginal,'998877');
 assert.match(p.notices[0],/RDG-2026-0123 enviado/);
 p.context.ticket={analystDirect:true,createdBy:'analyst'};
 assert.equal(vm.runInContext('canAddAttachments(ticket)',p.context),true);
 p.context.ticket.createdBy='another';
 assert.equal(vm.runInContext('canAddAttachments(ticket)',p.context),false);
});
test('Otros roles no abren este formulario y el acceso de Analistas no habilita EDC ni PQR manual interna',()=>{
 for(const role of ['gerente','admin','comercial','redigitador']) {
  const p=portal(role);vm.runInContext('newTicket("RDG",false,true)',p.context);
  assert.equal(p.dialogs.length,0);assert.equal(vm.runInContext('analystRedigitationButton()',p.context),'');
 }
 const p=portal('validador','internal');
 vm.runInContext('newTicket("EDC",false,true);newTicket("PQR",true)',p.context);
 assert.equal(p.dialogs.length,0);
});
