const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('docs/assets/production.js','utf8');
const css=fs.readFileSync('docs/assets/ui.css','utf8');
const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/assets/navigation.js','utf8'),ctx);
const nav=ctx.window.PQRNavigation;
test('one compact toolbar for each team view, with no repeated breadcrumbs or explanatory panel',()=>{
 for(const role of ['validador','redigitador','gerente','admin'])for(const scope of ['internal','external']){
  const html=nav.workspaceNav(scope,role);
  assert.equal((html.match(/href="#inicio"/g)||[]).length,1);
  assert.equal((html.match(/href="#solicitud-interna"/g)||[]).length,1);
  assert.equal((html.match(/data-action="workspace"/g)||[]).length,2);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.match(html,new RegExp('data-scope="'+scope+'" class="workspace-tab active"'));
  assert.equal((html.match(/<svg /g)||[]).length,4);
  assert.doesNotMatch(html,/module-context|Ruta de navegación|sin crear cuenta →|No incluye|Gestiona|<p>/);
 }
 assert.doesNotMatch(app,/module-context|PQRNavigation\.context\(|Enviar solicitud interna · sin cuenta ↗/);
 assert.match(app,/PQRNavigation\.workspaceNav\(workspace,me.role\)/);
});
test('Comercial keeps home and public intake access without gaining an internal private queue',()=>{
 const html=nav.workspaceNav('external','comercial');
 assert.doesNotMatch(html,/data-action="workspace"/);
 assert.match(html,/PQR de clientes/);
 assert.match(html,/aria-label="Inicio"/);
 assert.match(html,/aria-label="Nueva solicitud interna sin cuenta"/);
 assert.match(app,/workspace==='internal'&&!window.PQRScopes.eligible\(role\)/);
});
test('visual navigation uses responsive controls and visible keyboard focus',()=>{
 assert.match(css,/\.workspace-toolbar\{display:grid/);
 assert.match(css,/\.workspace-tab\[data-scope=internal\]\.active/);
 assert.match(css,/\.workspace-toolbar a:focus-visible/);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/\.workspace-create span\{display:none\}/);
});
