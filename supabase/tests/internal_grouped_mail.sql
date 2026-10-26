-- Run after the migration. Rollback prevents test emails, tickets and real serial consumption.
begin;
create temporary sequence internal_group_test_seq start 3000000;
do $$ begin
 execute replace(pg_get_functiondef('pqr_private.new_internal_code(text)'::regprocedure),
  'pqr_private.internal_code_seq','pg_temp.internal_group_test_seq');
end $$;
insert into pqr_private.internal_mail_copies(email) values('monitor@example.invalid') on conflict do nothing;
do $$
declare kind text; receipt jsonb; payload jsonb; request_id uuid; ticket uuid; team_event public.pqr_mail_events%rowtype;
 expected text[]; n integer; projection jsonb;
begin
 assert not has_table_privilege('anon','public.pqr_mail_events','select');
 assert not has_table_privilege('authenticated','public.pqr_mail_events','insert');
 assert not has_table_privilege('authenticated','pqr_private.internal_mail_copies','select');
 assert not has_table_privilege('service_role','pqr_private.internal_mail_copies','select');
 assert not has_table_privilege('service_role','public.pqr_tickets','select');
 assert not has_function_privilege('anon','pqr_private.enqueue_team_mail(uuid,text,text)','execute');
 assert not has_function_privilege('authenticated','pqr_private.enqueue_team_mail(uuid,text,text)','execute');
 assert not has_function_privilege('service_role','pqr_private.enqueue_team_mail(uuid,text,text)','execute');
 foreach kind in array array['PQR','RDG','EDC'] loop
  payload:=jsonb_build_object('kind',kind,'requesterName','QA grouped rollback','requesterEmail','requester@example.invalid',
   'client','KO moderno','country','Chile','pdv','12345','auditOriginal','9999912345',
   'description','Prueba transaccional de correos agrupados sin envío real.','files','[]'::jsonb);
  request_id:=gen_random_uuid();
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
  execute 'set local role anon';
  receipt:=public.pqr_submit_internal(request_id,payload);
  assert receipt->>'error' is null,receipt::text;
  assert public.pqr_submit_internal(request_id,payload)=receipt;
  execute 'reset role';
  ticket:=(receipt->>'id')::uuid;
  assert (select count(*) from public.pqr_mail_events where ticket_id=ticket)=2,'One team message and one acknowledgement';
  select * into strict team_event from public.pqr_mail_events where ticket_id=ticket and event_type in ('new_pqr','new_redigit');
  select array_agg(email order by email) into expected from pqr_private.internal_mail_routes
   where route_key=case when kind='PQR' then 'pqr' else 'redigit' end;
  assert team_event.recipient_emails=expected;
  assert 'monitor@example.invalid'=any(team_event.cc_emails);
  assert not ('requester@example.invalid'=any(team_event.recipient_emails));
  assert (select recipient_emails is null and cardinality(cc_emails)=0 from public.pqr_mail_events where ticket_id=ticket and event_type='received');
  execute 'set local role service_role';
  projection:=public.pqr_mail_ticket(team_event.id);
  execute 'reset role';
  assert not (projection->'data' ?| array['description','requesterEmail','editComment','attachments']);
  update public.pqr_tickets set status='No Aplica' where id=ticket;
  assert (select count(*) from public.pqr_mail_events where ticket_id=ticket and event_type='closed')=1;
  assert (select recipient_emails is null and cardinality(cc_emails)=0 from public.pqr_mail_events where ticket_id=ticket and event_type='closed');
  perform pqr_private.enqueue_team_mail(ticket,team_event.event_type,'qa-replay-once');
  perform pqr_private.enqueue_team_mail(ticket,team_event.event_type,'qa-replay-once');
  assert (select count(*) from public.pqr_mail_events where ticket_id=ticket and replay_key='qa-replay-once')=1;
  select count(*) into n from public.pqr_mail_events where ticket_id=ticket;
  update public.pqr_tickets set data=data||'{"scope":"external"}'::jsonb,
   commercial_id=(select id from public.pqr_profiles where role='comercial' limit 1) where id=ticket;
  update public.pqr_tickets set status='Reabierto' where id=ticket;
  update public.pqr_tickets set status='Cerrado' where id=ticket;
  assert (select count(*) from public.pqr_mail_events where ticket_id=ticket)=n,'Clients remain disabled';
  assert pqr_private.enqueue_team_mail(ticket,'new_pqr') is null;
 end loop;
 begin
  insert into public.pqr_mail_events(ticket_id,recipient_email,event_type,recipient_emails,cc_emails)
   values(ticket,'requester@example.invalid','received',array['staff@example.invalid'],array['monitor@example.invalid']);
  raise exception 'Must reject copying requester receipts';
 exception when check_violation then null;
 end;
 assert not pqr_private.mail_addresses_valid(array[E'one@example.invalid\r\nBcc: attack@example.invalid']);
end $$;
select 'GROUPED_INTERNAL_MAIL_PRIVACY_IDEMPOTENCE_OK' as verification;
rollback;
