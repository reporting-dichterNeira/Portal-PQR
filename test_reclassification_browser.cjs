const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const source=fs.readFileSync('docs/assets/production.js','utf8');
const functions=source.slice(source.indexOf('  function reclassify('),source.indexOf('  function assignRedigit('));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage();await page.setContent('<div id="modal"></div>');await page.addScriptTag({content:`
const $=s=>document.querySelector(s),esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const state={staff:{redigitators:[{id:'person1',name:'Redigitador de prueba',active:true}]}};let workspace='external';const listTypes={redigitador:'all'};
const tickets=[{id:'one',code:'EDC-TEST-1',requestType:'EDC',status:'Pendiente de Redigitación',client:'KO',pdv:'1',country:'Chile'},{id:'two',code:'RDG-TEST-2',requestType:'RDG',status:'Devuelto',client:'KO',pdv:'2',country:'Panamá'},{id:'closed',code:'RDG-CLOSED',requestType:'RDG',status:'Cerrado'}];
const redigitatorTickets=()=>tickets,requestType=t=>t.requestType,requestLabels={EDC:'Edición',RDG:'Redigitación'},PQRReports={filterTickets:x=>x};
window.calls=[];const db={rpc:async(name,args)=>{window.calls.push({name,args});return {data:{assigned:2},error:null}}};
const modal=(title,html)=>{$('#modal').innerHTML='<h1>'+title+'</h1>'+html;},formData=f=>Object.fromEntries(new FormData(f)),submit=async(f,work)=>work(),showError=e=>{window.lastError=e.message};
${functions}
window.openReclass=()=>reclassify(tickets[0]);window.openBatch=()=>redigitBatch();
`});
await page.evaluate(()=>openReclass());await page.selectOption('[name="redigitType"]','Campo');await page.fill('[name="reason"]','Comercial indicó edición pero requiere redigitación');await page.click('#reclassify-form button[type="submit"],#reclassify-form button.primary');assert.equal(await page.evaluate(()=>calls.at(-1).name),'pqr_reclassify');assert.equal(await page.evaluate(()=>calls.at(-1).args.p_data.redigitType),'Campo');
await page.selectOption('[name="requestType"]','EDC');assert.equal(await page.locator('[name="redigitType"]').inputValue(),'Validación');assert.equal(await page.locator('[name="personId"]').getAttribute('required'),'');
await page.evaluate(()=>openBatch());assert.equal(await page.locator('[name="ticket"]').count(),2);await page.click('#redigit-select-all');await page.selectOption('[name="personId"]','person1');await page.click('#redigit-batch-form button[type="submit"]');assert.equal(await page.evaluate(()=>calls.at(-1).name),'pqr_redigit_assign_batch');assert.deepEqual(await page.evaluate(()=>calls.at(-1).args.p_tickets),['one','two']);
await page.selectOption('[name="redigitType"]','Campo');const before=await page.evaluate(()=>calls.length);await page.click('#redigit-batch-form button[type="submit"]');assert.match(await page.evaluate(()=>lastError),/ediciones solo/);assert.equal(await page.evaluate(()=>calls.length),before);
await page.screenshot({path:'tmp/reclassification-batch-verified.png',fullPage:true});console.log('PASS: reclassification routing, edition Validation guard, multi-ticket selection, closed-ticket exclusion, batch payload and Field guard');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
