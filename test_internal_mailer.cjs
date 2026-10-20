const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function setup({direct=true,scope='internal',eventType='received',deleted=false,inactive=false,smtpFail=false,dbFail=false}={}){
 let handler;const sent=[],verify=[];
 const event={id:'event-qa',ticket_id:'ticket-qa',recipient_profile_id:direct?null:'profile-qa',recipient_email:direct?'person@example.invalid':null,event_type:eventType,status:'pending',locked_at:null,attempts:0,next_attempt_at:'2026-01-01'};
 const ticket={id:'ticket-qa',code:'EDC-INT-2026-0009',status:'Cerrado',deleted_at:deleted?'2026-01-01':null,data:{scope,editCompleted:true,editComment:'PRIVATE_COMMENT',description:'PRIVATE_DESCRIPTION',requesterEmail:'person@example.invalid'}};
 const rows={pqr_mail_events:[event],pqr_tickets:[ticket],pqr_profiles:[{id:'profile-qa',active:!inactive}],pqr_contact_emails:[{profile_id:'profile-qa',email:'staff@example.invalid'}]};
 function query(table){let filters=[],update=null,done;const q={
  select(){return q},update(values){update=values;return q},eq(k,v){filters.push(r=>r[k]===v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},order(){return q},limit(){return q},
  run(){if(done)return done; if(dbFail&&table==='pqr_tickets')return done={data:null,error:{message:'database permission error'}};
   const found=rows[table].filter(r=>filters.every(f=>f(r)));if(update)found.forEach(r=>Object.assign(r,update));return done={data:found.map(r=>({...r})),error:null}},
  single:async()=>{const r=q.run();return {...r,data:r.data?.[0]||null}},maybeSingle:async()=>{const r=q.run();return {...r,data:r.data?.[0]||null}},
  then(resolve,reject){return Promise.resolve(q.run()).then(resolve,reject)}
 };return q;}
 let source=fs.readFileSync('supabase/functions/pqr-mailer/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
 source+='\nglobalThis.qaMessage=message; globalThis.qaSend=sendEvent;';
 const rpc=async(name,args)=>{assert.equal(name,'pqr_mail_ticket');assert.equal(args.p_event,event.id);return dbFail?{data:null,error:{message:'database permission error'}}:{data:scope==='internal'?{code:ticket.code,status:ticket.status,deleted_at:ticket.deleted_at,data:{scope,editCompleted:ticket.data.editCompleted}}:null,error:null};};
 const c=vm.createContext({Request,Response,console:{error(){}},createClient:()=>({from:query,rpc}),nodemailer:{createTransport:()=>({verify:async()=>{verify.push(true)},sendMail:async m=>{if(smtpFail)throw Error('SMTP_TEMPORARY');sent.push(m)}})},Deno:{env:{get:n=>({PQR_MAILER_TOKEN:'qa-token',GMAIL_APP_PASSWORD:'qa-password',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-service'}[n])},serve:fn=>handler=fn}});
 vm.runInContext(stripTypeScriptTypes(source),c);
 return {c,event,ticket,sent,verify,send:()=>c.qaSend({...event}),invoke:async(body={},token='qa-token')=>handler(new Request('https://example.invalid',{method:'POST',headers:{'x-pqr-mailer-token':token},body:JSON.stringify(body)}))};
}
test('internal requester receives acknowledgement and completion with public tracking only',async()=>{
 for(const eventType of ['received','closed']){const f=setup({eventType});assert.equal(await f.send(),'sent');assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].bcc[0].address,'person@example.invalid');assert.match(f.sent[0].text,/#consultar-ticket/);
  assert.doesNotMatch(f.sent[0].text,/PRIVATE_COMMENT|PRIVATE_DESCRIPTION|adjuntos/);assert.match(f.sent[0].messageId,/event-qa/);
  assert.match(f.sent[0].subject,eventType==='received'?/Recibimos/:/finalizada/);
 }
});
test('internal team notices go to the private workspace; client email is disabled',async()=>{
 const team=setup({eventType:'new_redigit'});await team.send();assert.match(team.sent[0].text,/#gestion/);
 const client=setup({direct:false,scope:'external',eventType:'closed'});assert.equal(await client.send(),'skipped');assert.equal(client.sent.length,0);assert.equal(client.event.status,'cancelled');
});
test('atomic claim skips duplicate attempts and does not send deleted or inactive cases',async()=>{
 const f=setup();const snapshot={...f.event};assert.equal(await f.c.qaSend(snapshot),'sent');assert.equal(await f.c.qaSend(snapshot),'skipped');assert.equal(f.sent.length,1);
 for(const opts of [{deleted:true},{direct:false,inactive:true,eventType:'closed'}]){const g=setup(opts);assert.equal(await g.send(),'skipped');assert.equal(g.sent.length,0);}
});
test('SMTP and structured database errors remain retryable and informative',async()=>{
 for(const opts of [{smtpFail:true},{dbFail:true}]){const f=setup(opts);assert.equal(await f.send(),'failed');assert.equal(f.event.status,'pending');assert.equal(f.event.locked_at,null);assert.notEqual(f.event.last_error,'[object Object]');assert.ok(Date.parse(f.event.next_attempt_at)>Date.now());}
});
test('direct messages cannot target external cases and reject address injection',async()=>{
 const external=setup({scope:'external'});assert.equal(await external.send(),'skipped');assert.equal(external.event.status,'cancelled');assert.equal(external.sent.length,0);
 const f=setup();f.event.recipient_email='one@example.invalid,another@example.invalid';assert.equal(await f.send(),'failed');assert.equal(f.sent.length,0);
});
test('scheduler authentication stays required and SMTP verification sends no email',async()=>{
 const f=setup();assert.equal((await f.invoke({},'wrong')).status,401);const response=await f.invoke({action:'verify_smtp'});assert.equal(response.status,200);assert.equal(f.verify.length,1);assert.equal(f.sent.length,0);
});
