-- All records and notices roll back. No outgoing messages and no real serials consumed.
begin;
create temporary sequence internal_mail_test_seq start 2000000;
do $$ begin
 execute replace(pg_get_functiondef('pqr_private.new_internal_code(text)'::regprocedure),
 'pqr_private.internal_code_seq','pg_temp.internal_mail_test_seq');
end $$;
do $$
declare k text; payload jsonb; receipt jsonb; request uuid; v_ticket uuid; v_event uuid; n bigint; expected text[]; projection jsonb;
begin
 assert not has_table_privilege('anon','public.pqr_mail_events','select');
 assert not has_table_privilege('authenticated','public.pqr_mail_events','insert');
 assert not has_table_privilege('anon','pqr_private.internal_mail_routes','select');
 assert not has_table_privilege('authenticated','pqr_private.internal_mail_routes','select');
 assert not has_table_privilege('service_role','public.pqr_tickets','select');
 assert not has_function_privilege('anon','public.pqr_mail_ticket(uuid)','execute');
 assert not has_function_privilege('authenticated','public.pqr_mail_ticket(uuid)','execute');
 assert has_function_privilege('service_role','public.pqr_mail_ticket(uuid)','execute');
 assert (select count(*) from pqr_private.internal_mail_routes where route_key='pqr')=4;
 assert (select count(*) from pqr_private.internal_mail_routes where route_key='redigit')=2;
 foreach k in array array['PQR','RDG','EDC'] loop
  payload:=jsonb_build_object('kind',k,'requesterName','QA rollback correos','requesterEmail','qa@example.invalid',
  'client','KO moderno','country','Chile','pdv','12345','auditOriginal','9999912345','description','Prueba transaccional de correo sin envío real.','files','[]'::jsonb);
  request:=gen_random_uuid();
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
  execute 'set local role anon';
  receipt:=public.pqr_submit_internal(request,payload);
  assert receipt->>'error' is null,receipt::text;
  assert public.pqr_submit_internal(request,payload)=receipt,'Reintentar no genera nuevos correos';
  execute 'reset role';
  v_ticket:=(receipt->>'id')::uuid;
  select array_agg(email order by email) into expected from pqr_private.internal_mail_routes where route_key=case when k='PQR' then 'pqr' else 'redigit' end;
  assert (select array_agg(e.recipient_email order by e.recipient_email) from public.pqr_mail_events e
   where e.ticket_id=v_ticket and e.event_type=case when k='PQR' then 'new_pqr' else 'new_redigit' end)=expected;
  assert (select count(*) from public.pqr_mail_events e where e.ticket_id=v_ticket and event_type='received' and recipient_email='qa@example.invalid')=1;
  assert not exists(select 1 from public.pqr_mail_events e where e.ticket_id=v_ticket and recipient_profile_id is not null);
  select e.id into v_event from public.pqr_mail_events e where e.ticket_id=v_ticket limit 1;
  execute 'set local role service_role';
  projection:=public.pqr_mail_ticket(v_event);
  execute 'reset role';
  assert projection->'data' ? 'scope';
  assert not (projection->'data' ?| array['description','requesterEmail','editComment','attachments']);
  update public.pqr_tickets set status='No Aplica',data=data||jsonb_build_object('status','No Aplica','closedAt',now()) where pqr_tickets.id=v_ticket;
  update public.pqr_tickets set status='No Aplica' where pqr_tickets.id=v_ticket;
  assert (select count(*) from public.pqr_mail_events e where e.ticket_id=v_ticket and event_type='closed' and recipient_email='qa@example.invalid')=1,'Actualizar sin cambio no duplica cierre';
  update public.pqr_tickets set status='Reabierto' where pqr_tickets.id=v_ticket;
  update public.pqr_tickets set status='Cerrado' where pqr_tickets.id=v_ticket;
  assert (select count(*) from public.pqr_mail_events e where e.ticket_id=v_ticket and event_type='closed')=2,'Un nuevo cierre tras reapertura sí genera aviso';
  -- Reclassifying this transactional fixture as client suppresses all new emails.
  update public.pqr_tickets set data=data||'{"scope":"external"}'::jsonb,
   commercial_id=(select p.id from public.pqr_profiles p where p.role='comercial' limit 1) where pqr_tickets.id=v_ticket;
  select count(*) into n from public.pqr_mail_events e where e.ticket_id=v_ticket;
  update public.pqr_tickets set status='Reabierto' where pqr_tickets.id=v_ticket;
  update public.pqr_tickets set status='Cerrado' where pqr_tickets.id=v_ticket;
  assert (select count(*) from public.pqr_mail_events e where e.ticket_id=v_ticket)=n;
  assert (select public.pqr_mail_ticket(e.id) from public.pqr_mail_events e where e.ticket_id=v_ticket limit 1) is null;
 end loop;
 payload:=payload||'{"requesterEmail":""}'::jsonb;
 receipt:=public.pqr_submit_internal(gen_random_uuid(),payload);
 assert receipt->>'error'='El correo de contacto es obligatorio',receipt::text;
end $$;
select 'INTERNAL_MAIL_ROUTES_ACK_AND_COMPLETION_OK' as verification;
rollback;
