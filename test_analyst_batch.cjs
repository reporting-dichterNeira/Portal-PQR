const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/assets/analyst-batch.js','utf8'),context);
const batch=context.window.PQRAnalystBatch;
const first={id:'one',code:'PQR-INT-2026-0153',scope:'internal',requestType:'PQR',status:'Radicado',pdv:'00123',auditOriginal:'111',description:'Primera solicitud',recordUpdatedAt:'2026-10-29T11:00:00.000001Z'};
const second={...first,id:'two',code:'PQR-INT-2026-0155',pdv:'00456',auditOriginal:'222',description:'Segunda solicitud',status:'En Validación'};
const common={personId:'analyst',decision:'yes',tipology:'Confunde SKU',area:'Validación',response:'Una misma respuesta para ambas.'};
test('one common response preserves the distinct audit and intake of each ticket',()=>{
 for(const decision of ['yes','no','redigit']){
  const args=batch.prepare([first,second],'dictate',{...common,decision});
  assert.equal(args.p_items[0].auditOriginal,'111');assert.equal(args.p_items[1].auditOriginal,'222');
  assert.equal(args.p_data.response,common.response);assert.equal(args.p_data.decision,decision);
  assert.equal(args.p_items[0].expectedUpdatedAt,first.recordUpdatedAt);
  assert.equal(args.p_items[0].pdv,undefined);assert.equal(first.status,'Radicado');
 }
});
test('assignment needs no audit; all cases still require a valid state and version',()=>{
 const args=batch.prepare([{...first,auditOriginal:''},second],'assign',{personId:'analyst',response:'Ignored'});
 assert.equal(args.p_items[0].auditOriginal,undefined);assert.deepEqual(Object.keys(args.p_data),['personId']);
 for(const altered of [{...first,status:'Cerrado'},{...first,status:'Pendiente de Verificación'},{...first,requestType:'RDG'},{...first,requestType:'EDC'},{...first,recordUpdatedAt:''},{...first,deletedAt:'today'}])assert.throws(()=>batch.prepare([altered],'assign',common));
 assert.equal(batch.eligible({...first,requestType:undefined,code:'RDG-INT-2026-0100'}),false);
});
test('manual radications keep individual PDVs/descriptions and cannot omit completion',()=>{
 const manual={...first,manualEntry:true,pdv:'',description:'',auditOriginal:''};
 assert.throws(()=>batch.prepare([manual],'dictate',common),/auditoría/);
 assert.throws(()=>batch.prepare([manual],'dictate',common,{one:{auditOriginal:'123'}}),/PDV/);
 const args=batch.prepare([manual,{...second,manualEntry:true}],'dictate',common,{one:{pdv:'0099',description:'Solicitud completada uno',auditOriginal:'00333'}});
 assert.equal(args.p_items[0].pdv,'0099');assert.equal(args.p_items[1].pdv,second.pdv);
 assert.equal(args.p_items[0].auditOriginal,'00333');assert.equal(args.p_items[1].description,second.description);
});
test('rejects empty, duplicate, oversized, mixed-scope or incomplete common answers',()=>{
 assert.throws(()=>batch.prepare([],'assign',common));
 assert.throws(()=>batch.prepare([first,first],'assign',common),/repetidas/);
 assert.throws(()=>batch.prepare([first,{...second,scope:'external'}],'assign',common),/bandeja/);
 const hundred=Array.from({length:100},(_,i)=>({...first,id:String(i)}));assert.equal(batch.prepare(hundred,'assign',common).p_items.length,100);
 assert.throws(()=>batch.prepare([...hundred,{...first,id:'overflow'}],'assign',common),/100/);
 for(const patch of [{personId:''},{decision:''},{response:'abc'},{tipology:''},{area:'Otra área',areaOther:''}])assert.throws(()=>batch.prepare([first],'dictate',{...common,...patch}));
 assert.equal(batch.prepare([first],'dictate',{...common,area:'Otra área',areaOther:' Área especial '}).p_data.area,'Área especial');
});
test('selection exists only for analysts, disables completed/other types and drops filtered-out rows',()=>{
 const app=fs.readFileSync('docs/assets/production.js','utf8'),selection=new Set(['hidden','one']);
 const escape=v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const c=vm.createContext({window:{PQRAnalystBatch:batch},analystSelection:selection,listTypes:{},esc:escape,fmt:()=>'',
  requestLabels:{PQR:'PQR',RDG:'Redigitación'},requestType:t=>t.requestType||'PQR',badge:s=>s,staffName:()=>'',due:()=>'',ticketActions:()=>''});
 vm.runInContext(app.slice(app.indexOf('  function ticketTable('),app.indexOf('  function ticketActions('))+
  app.slice(app.indexOf('  function analystBatchTools('),app.indexOf('  function updateAnalystSelection(')),c);
 c.cases=[first,{...second,status:'Cerrado'},{...second,id:'rdg',requestType:'RDG'}];
 const html=vm.runInContext('ticketTable(cases,"validador")',c);
 assert.match(html,/Asignar seleccionadas/);assert.match(html,/Asignar y dictaminar/);
 assert.equal(selection.has('hidden'),false);assert.equal(selection.has('one'),true);
 assert.match(html,/data-batch-ticket="two"[^>]+disabled/);assert.match(html,/data-batch-ticket="rdg"[^>]+disabled/);
 assert.doesNotMatch(vm.runInContext('ticketTable(cases,"redigitador")',c),/data-batch-ticket|analyst-select-visible/);
});
