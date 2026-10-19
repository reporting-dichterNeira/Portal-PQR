const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('docs/assets/production.js','utf8'),nav=fs.readFileSync('docs/assets/navigation.js','utf8');
test('tarjetas nativas seleccionables: no envían el formulario y conservan la semántica accesible',()=>{
 const c=vm.createContext({window:{}});vm.runInContext(nav,c);const n=c.window.PQRNavigation;
 const html=n.intakeChoices();assert.equal((html.match(/type="button"/g)||[]).length,3);
 for(const kind of ['PQR','RDG','EDC'])assert.ok(html.includes('data-intake-kind="'+kind+'"'));
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);assert.match(html,/aria-label="Elige el tipo de solicitud"/);
 assert.match(n.publicHeader(),/href="#gestion"/);assert.match(n.publicHeader(),/href="#inicio"/);
 assert.match(n.icon('lock'),/aria-hidden="true"/);
});
test('selección de tarjeta y desplegable conserva requisitos PQR, RDG y EDC',()=>{
 const buttons=['PQR','RDG','EDC'].map(kind=>({dataset:{intakeKind:kind},attrs:{},setAttribute(k,v){this.attrs[k]=v}}));
 const labels=Object.fromEntries(['#public-audit-label','#public-pdv-label'].map(key=>[key,{firstChild:{textContent:''}}]));
 const form={elements:{kind:{value:'PQR'},auditOriginal:{},pdv:{}}};
 const c=vm.createContext({form,$:key=>labels[key],document:{querySelectorAll:()=>buttons}});
 vm.runInContext(app.slice(app.indexOf('  function syncIntakeKind('),app.indexOf('  function renderPublicInternal()')),c);
 for(const [kind,audit,pdv] of [['PQR',false,true],['RDG',true,true],['EDC',true,false]]){
  form.elements.kind.value=kind;vm.runInContext('syncIntakeKind(form)',c);
  assert.equal(form.elements.auditOriginal.required,audit);assert.equal(form.elements.pdv.required,pdv);
  for(const b of buttons)assert.equal(b.attrs['aria-pressed'],String(b.dataset.intakeKind===kind));
 }
 assert.equal(labels['#public-pdv-label'].firstChild.textContent,'ID de PDV (opcional)');
 assert.match(app,/form.elements.kind.onchange=\(\)=>syncIntakeKind\(form\)/);
 assert.match(app,/form.elements.kind.value=button.dataset.intakeKind;syncIntakeKind\(form\)/);
});
test('formulario dividido sin perder campos, acumulación de adjuntos, errores ni protección de datos',()=>{
 const intake=app.slice(app.indexOf('  function renderPublicInternal()'),app.indexOf('  function options('));
 for(const name of ['requesterName','requesterEmail','kind','client','clientOther','country','pdv','auditOriginal','description'])assert.ok(intake.includes('name="'+name+'"'));
 assert.equal((intake.match(/<fieldset class="intake-section full">/g)||[]).length,3);
 assert.match(intake,/bindAttachmentSelection\(form\)/);assert.match(intake,/checkedAttachments\(form.elements.attachments\)/);
 assert.match(intake,/id="public-intake-error"[^>]*role="alert"/);assert.match(intake,/id="upload-progress"[^>]*role="status"/);
 assert.match(intake,/No compartas contraseñas/);assert.match(intake,/internalAPI.submit\(requestId,payload\)/);
 const css=fs.readFileSync('docs/assets/ui.css','utf8'),html=fs.readFileSync('docs/index.html','utf8');
 assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/:focus-visible/);
 assert.match(html,/assets\/ui.css/);
});
