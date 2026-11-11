const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
function setup(){
 const calls=[];const context=vm.createContext({window:{},URL,Headers,fetch:async(input,init)=>{calls.push({input,init});return{};}});
 vm.runInContext(fs.readFileSync('docs/assets/universal.js','utf8'),context);
 return{u:context.window.PQRUniversal,calls};
}
test('Only three profiles can be chosen; every new identity and reset starts at the menu',()=>{
 const {u}=setup(),identity={id:'a',role:'universal',active:true,name:'Universal'};
 assert.equal(u.identity(identity).role,'universal');
 for(const role of ['validador','redigitador','gerente']){u.choose(role);assert.equal(u.identity(identity).role,role);}
 for(const role of ['admin','comercial','campo','universal',''])assert.throws(()=>u.choose(role));
 assert.equal(identity.role,'universal');
 assert.equal(u.identity({...identity,id:'b'}).role,'universal');
 u.choose('gerente');assert.equal(u.identity({id:'c',role:'comercial'}).role,'comercial');
 u.reset();assert.equal(u.identity(identity).role,'universal');
});
test('Role header is tab-local and sent only to this project data endpoints, never Auth or a different host',async()=>{
 const {u,calls}=setup();u.identity({id:'a',role:'universal'});u.choose('redigitador');
 for(const endpoint of ['rest','functions','storage'])await u.fetchWithProfile(`https://niwkegxwwwoahcbsoujy.supabase.co/${endpoint}/v1/test`,{headers:{Authorization:'Bearer test'}});
 for(const c of calls){assert.equal(c.init.headers.get('x-pqr-profile'),'redigitador');assert.equal(c.init.headers.get('Authorization'),'Bearer test');}
 calls.length=0;
 await u.fetchWithProfile('https://niwkegxwwwoahcbsoujy.supabase.co/auth/v1/token',{});
 await u.fetchWithProfile('https://example.com/rest/v1/test',{});
 assert.ok(calls.every(c=>!c.init.headers));
 u.reset();await u.fetchWithProfile('https://niwkegxwwwoahcbsoujy.supabase.co/rest/v1/test',{headers:{'x-pqr-profile':'admin'}});
 assert.equal(calls.at(-1).init.headers.get('x-pqr-profile'),null);
 const otherTab=setup();assert.equal(otherTab.u.identity({id:'a',role:'universal'}).role,'universal');
});
test('The menu has three named actions and changing profile cannot expose the administration form',()=>{
 const {u}=setup();const html=u.menu({name:'Universal'},s=>s,()=>'<svg/>');
 assert.equal((html.match(/data-profile=/g)||[]).length,3);
 assert.match(html,/Analistas de PQR/);assert.match(html,/Redigitación/);assert.match(html,/Gerencia/);
 assert.doesNotMatch(html,/Administración|data-profile="admin"/);
 const source=fs.readFileSync('docs/assets/production.js','utf8');
 assert.ok(source.indexOf("selectedIdentity.role==='universal'")<source.indexOf("db.from('pqr_tickets')"));
 assert.match(source,/universal-menu/);assert.match(source,/Cambiar perfil/);
 assert.match(source,/version!==loadVersion/);
});
