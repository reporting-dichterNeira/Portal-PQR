-- No business writes or sequence consumption. All checks roll back.
begin;
do $$
declare actor uuid; actor_role text; rejected boolean; before_count bigint; seq bigint;
begin
 select count(*) into before_count from public.pqr_tickets;
 select last_value into seq from public.pqr_code_seq;
 foreach actor_role in array array['validador','gerente'] loop
  select id into actor from public.pqr_profiles where active and role=actor_role limit 1;
  assert actor is not null;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  rejected:=false;
  begin
   perform public.pqr_create_manual_scoped('{"scope":"internal","client":"Lindley","country":"Perú"}');
  exception when raise_exception then rejected:=sqlerrm like '%solo está disponible en PQR de clientes%'; end;
  assert rejected,'La pestaña manual interna antigua debe fallar antes de crear un ticket';
  execute 'reset role';
 end loop;
 assert (select count(*) from public.pqr_tickets)=before_count;
 assert (select last_value from public.pqr_code_seq)=seq;
 assert not has_table_privilege('anon','pqr_private.ticket_scope_transfers','select');
 assert not has_table_privilege('authenticated','pqr_private.ticket_scope_transfers','select');
 assert (select relrowsecurity from pg_class where oid='pqr_private.ticket_scope_transfers'::regclass);
 assert not has_function_privilege('anon','public.pqr_create_manual_scoped(jsonb)','execute');
 assert has_function_privilege('anon','public.pqr_submit_internal(uuid,jsonb)','execute');
 assert has_function_privilege('anon','public.pqr_lookup_internal(text)','execute');
 assert has_function_privilege('authenticated','public.pqr_create_manual(jsonb)','execute');
end $$;
select 'MANUAL_EXTERNAL_ONLY_AND_PRIVATE_AUDIT_OK' as verification;
rollback;
