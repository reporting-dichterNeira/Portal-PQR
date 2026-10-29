const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function setup(){
 const controls=Object.fromEntries(['refresh-batch-suggestions','confirm-batch-suggestions','batch-suggestion-status','toggle-unmatched-suggestions','batch-match-summary'].map(id=>[id,{disabled:false,textContent:'',setAttribute(k,v){this[k]=v;}}]));
 const tickets=['found','missing','pending','emptyFound'].map(id=>({id,pdv:'123'}));
 const rows=tickets.map(t=>({dataset:{batchRow:t.id},hidden:false,input:{value:t.id==='found'?'999':''},card:{innerHTML:''},
  querySelector(selector){return selector==='[name="auditOriginal"]'?this.input:selector==='[data-audit-suggestion]'?this.card:null;}}));
 const review={scrollTop:220};let fail=false;
 const form={isConnected:true,querySelector:selector=>selector==='.batch-review'?review:controls[selector.slice(1)],querySelectorAll:()=>rows,addEventListener(){}};
 const context=vm.createContext({window:{},analystBatchBusy:false,fmt:v=>v,db:{rpc:async()=>fail?{error:Error('offline')}:{data:tickets.map(t=>({...t,ticketId:t.id,status:t.id==='missing'?'not_found':t.id==='pending'?'pending':'found',auditId:'456'}))}}});
 vm.runInContext(fs.readFileSync('docs/assets/analyst-batch.js','utf8'),context);
 const app=fs.readFileSync('docs/assets/production.js','utf8');vm.runInContext(app.slice(app.indexOf('  function bindBatchSuggestions('),app.indexOf('  function analystBatchForm(')),context);
 context.form=form;context.tickets=tickets;vm.runInContext('bindBatchSuggestions(form,tickets)',context);await new Promise(setImmediate);
 return {rows,controls,form,review,tickets,fail:()=>{fail=true}};
}
test('unmatched filter counts true no-matches, excludes pending and preserves all values/selection',async()=>{
 const h=await setup(),button=h.controls['toggle-unmatched-suggestions'];
 assert.equal(button.textContent,'Ver sin cruce (1)');assert.equal(button.disabled,false);
 button.onclick();assert.deepEqual(h.rows.map(r=>r.hidden),[true,false,true,true]);assert.equal(button.textContent,'Ver todas (4)');assert.equal(h.review.scrollTop,0);
 assert.match(h.controls['batch-match-summary'].textContent,/dictamen se aplicará a las 4/);
 h.rows[1].input.value='12345';button.onclick();assert.ok(h.rows.every(r=>!r.hidden));assert.equal(h.rows[1].input.value,'12345');assert.equal(h.tickets.length,4);
});
test('confirmation still covers the full selection and manual IDs survive while rows are hidden',async()=>{
 const h=await setup();h.controls['toggle-unmatched-suggestions'].onclick();h.controls['confirm-batch-suggestions'].onclick();
 assert.equal(h.rows[0].input.value,'999');assert.equal(h.rows[3].input.value,'456');assert.equal(h.rows[1].input.value,'');
 h.form.showAllBatchRows();assert.ok(h.rows.every(r=>!r.hidden));
});
test('failed refresh restores all rows without classifying errors as no-match or clearing edits',async()=>{
 const h=await setup();h.controls['toggle-unmatched-suggestions'].onclick();h.rows[1].input.value='12345';h.fail();
 await h.controls['refresh-batch-suggestions'].onclick();assert.ok(h.rows.every(r=>!r.hidden));assert.equal(h.rows[1].input.value,'12345');
 assert.equal(h.controls['toggle-unmatched-suggestions'].disabled,true);assert.equal(h.controls['toggle-unmatched-suggestions'].textContent,'Ver sin cruce (0)');
});
