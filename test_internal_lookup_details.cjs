const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('docs/assets/production.js','utf8');
const render=app.slice(app.indexOf('  function renderPublicLookup()'),app.indexOf('  function syncIntakeKind('));
async function lookup(data){
 const output={innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';this.textContent='';}};
 const form={elements:{code:{value:'RDG-INT-2026-0017'}},isConnected:true,reportValidity(){throw Error('Unexpected invalid form');}};
 const root={innerHTML:''};
 const nodes={'#app':root,'#ticket-lookup-form':form,'#lookup-result':output};
 const context=vm.createContext({document:{},window:{PQRNavigation:{publicHeader:()=>'',publicTabs:()=>''}},
  $:key=>nodes[key],esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  requestLabels:{PQR:'PQR',RDG:'Redigitación',EDC:'Edición'},fmt:v=>v||'—',lock(){},internalAPI:{lookup:async()=>({data})}});
 vm.runInContext(render+';renderPublicLookup();',context);
 await form.onsubmit({preventDefault(){}});
 return {form,output,root};
}
const ticket={code:'RDG-INT-2026-0017',requestType:'RDG',status:'Pendiente de Redigitación',pdv:'000123',requesterName:'María Comercial',description:'Corregir auditoría\nConservar los soportes.',createdAt:'2026-10-27',updatedAt:'2026-10-28'};
test('tracking renders submitted PDV, requester and multiline request for all internal types',async()=>{
 for(const requestType of ['PQR','RDG','EDC']){
  const {output,root}=await lookup({...ticket,requestType});
  for(const label of ['ID de PDV','Comercial / solicitante','Solicitud / detalle'])assert.ok(output.innerHTML.includes(label));
  for(const value of [ticket.pdv,ticket.requesterName,ticket.description,ticket.status])assert.ok(output.innerHTML.includes(value));
  assert.doesNotMatch(root.innerHTML,/sin nombres|únicamente el estado/);
 }
});
test('untrusted request text and names are escaped; unrelated private fields never render',async()=>{
 const {output}=await lookup({...ticket,pdv:'<script>bad()</script>',requesterName:'<img src=x onerror=bad()>',description:'<svg onload=bad()> & "quoted"',requesterEmail:'secret@example.invalid',response:'PRIVATE_RESPONSE',timeline:'PRIVATE_TIMELINE',uploadPaths:['PRIVATE_ATTACHMENT']});
 assert.doesNotMatch(output.innerHTML,/<script|<img|<svg|secret@example.invalid|PRIVATE_/);
 assert.match(output.innerHTML,/&lt;svg onload=bad\(\)&gt; &amp; &quot;quoted&quot;/);
});
test('older tickets show clear fallbacks and unknown tickets reveal no details',async()=>{
 const missing=await lookup({...ticket,pdv:null,requesterName:' ',description:''});
 assert.equal((missing.output.innerHTML.match(/No indicado/g)||[]).length,2);
 assert.match(missing.output.innerHTML,/Sin detalle registrado/);
 const unknown=await lookup(null);assert.match(unknown.output.innerHTML,/No encontramos un ticket interno/);
 assert.doesNotMatch(unknown.output.innerHTML,/ID de PDV|Comercial \/ solicitante/);
 const known=await lookup(ticket);known.form.elements.code.oninput();assert.equal(known.output.innerHTML,'');
});
