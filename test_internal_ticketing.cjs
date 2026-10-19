const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('docs/assets/production.js','utf8');
function helpers(){const c=vm.createContext({window:{}});for(const name of ['scopes','navigation'])vm.runInContext(fs.readFileSync('docs/assets/'+name+'.js','utf8'),c);return c.window;}
test('portal oficial separa clientes, internos e históricos; formulario y consulta no exigen sesión',()=>{
 const {PQRScopes:scopes,PQRNavigation:nav}=helpers();
 const cases=[{id:'old'},{id:'client',scope:'external'},{id:'internal',scope:'internal'}];
 assert.deepEqual(Array.from(scopes.select(cases,'internal'),t=>t.id),['internal']);
 assert.deepEqual(Array.from(scopes.select(cases,'external'),t=>t.id),['old','client']);
 assert.equal(scopes.eligible('comercial'),false);
 for(const role of ['validador','redigitador','gerente','admin'])assert.equal(scopes.eligible(role),true);
 const load=app.slice(app.indexOf('  async function load()'),app.indexOf('  async function readAll('));
 for(const route of ['#consultar-ticket','#solicitud-interna'])assert.ok(load.indexOf("location.hash==='"+route+"'")<load.indexOf('db.auth.getSession()'));
 assert.match(app,/\.\.\.scopeTickets\(\),\.\.\.\(workspace==='external'\?state.historical:\[\]\)/);
 for(const href of ['#clientes','#gestion','#solicitud-interna','#consultar-ticket'])assert.ok(nav.home().includes('href="'+href+'"'));
 assert.doesNotMatch(nav.home()+nav.loginInfo('internal'),/ficticios|simulad|franja amarilla|local/i);
 assert.match(nav.publicTabs('lookup'),/href="#consultar-ticket" aria-current="page"/);
});
test('API pública aislada de la sesión y capacidades solo para los adjuntos del envío',async()=>{
 const calls=[],uploads=[];
 const createClient=(url,key,config)=>{
  calls.push({url,key,config});
  return {rpc:async(name,args)=>({data:name==='pqr_lookup_internal'?{status:'Radicado'}:{error:'Demasiados envíos'},error:null}),
   storage:{from:()=>({upload:async(...args)=>{uploads.push(args);return{error:null}}})}};
 };
 const c=vm.createContext({window:{supabase:{createClient}},
  URL:'https://project.example',KEY:'public',attachmentBucket:'pqr-adjuntos',attachmentTypes:{png:'image/png'}});
 const section=app.slice(app.indexOf('  // Public intake'),app.indexOf('  const $ ='));
 vm.runInContext(section,c);
 assert.equal(calls[0].config.auth.persistSession,false);assert.equal(calls[0].config.auth.autoRefreshToken,false);
 const lookup=await vm.runInContext('internalAPI.lookup("PQR-INT-2026-0001-ABCDEF0123456789")',c);assert.equal(lookup.data.status,'Radicado');
 const submit=await vm.runInContext('internalAPI.submit("request",{})',c);assert.equal(submit.data,null);assert.match(submit.error.message,/Demasiados/);
 c.fixture={uploadPaths:['ticket/one-foto.png','ticket/two-foto.png']};c.files=[{name:'a.png'},{name:'b.png'},{name:'c.png'}];
 const failures=await vm.runInContext('uploadInternalAttachments(fixture,files,null)',c);
 assert.equal(uploads.length,2);assert.equal(uploads[0][0],'ticket/one-foto.png');assert.equal(uploads[1][0],'ticket/two-foto.png');assert.equal(uploads[0][2].upsert,false);assert.deepEqual(Array.from(failures),['c.png']);
});
test('menú inicial ofrece dos accesos: ticketera abierta y gestión con cuenta',()=>{
 const nav=helpers().PQRNavigation,html=nav.home();
 assert.equal((html.match(/<article class="entry-card /g)||[]).length,2);
 assert.match(html,/<h2>Ticketera<\/h2>/);assert.match(html,/<h2>Gestión de analistas<\/h2>/);
 assert.match(html,/href="#solicitud-interna">Ir a la ticketera/);
 assert.match(html,/href="#gestion">Entrar a gestión de analistas/);
 assert.equal(nav.homeRoute('#internas'),true);assert.equal(nav.homeRoute('#gestion'),false);
 assert.match(app,/workspace=\['#internas','#gestion'\]\.includes\(location.hash\)/);
 assert.match(html,/Sin usuario ni contraseña/);assert.match(html,/Requiere el usuario y la contraseña/);
 assert.match(html,/href="#clientes"/);assert.match(html,/href="#consultar-ticket"/);
 assert.doesNotMatch(html,/<form|type="password"/);
 assert.match(nav.loginInfo('internal'),/Volver al menú principal/);
});
test('consulta usa solo seguimiento y envío usa UUID idempotente, sin simulador ni claves privadas',()=>{
 const lookup=app.slice(app.indexOf('  function renderPublicLookup()'),app.indexOf('  function renderPublicInternal()'));
 assert.match(lookup,/internalAPI.lookup\(code\)/);assert.doesNotMatch(lookup,/t\.(?:requesterName|requesterEmail|description|timeline|uploadPaths|response)/);
 assert.match(lookup,/No encontramos un ticket interno/);assert.match(lookup,/role="status" aria-live="polite"/);
 assert.match(app,/requestId=crypto.randomUUID\(\)/);assert.match(app,/internalAPI.submit\(requestId,payload\)/);
 assert.match(app,/payload.files=files.map/);assert.match(app,/payload.scope === 'internal' \? 'pqr_create_manual_scoped' : 'pqr_create_manual'/);
 assert.doesNotMatch(app,/PQRLocal|local-adapter|INT-LOCAL|service_role|SUPABASE_SERVICE_ROLE_KEY/);
 const html=fs.readFileSync('docs/index.html','utf8');for(const name of ['scopes','navigation'])assert.match(html,new RegExp('assets/'+name+'\\.js'));
});
