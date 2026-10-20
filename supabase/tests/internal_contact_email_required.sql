-- Invalid submissions must never create tickets, receipts, mail or consume serials.
begin;
do $$
declare k text; email text; result jsonb; tickets bigint; events bigint; receipts bigint; serial bigint;
begin
 select count(*) into tickets from public.pqr_tickets;
 select count(*) into events from public.pqr_mail_events;
 select count(*) into receipts from pqr_private.internal_receipts;
 select last_value into serial from pqr_private.internal_code_seq;
 foreach k in array array['PQR','RDG','EDC'] loop
  foreach email in array array[null,'','   ','not-an-email','a@b','a@example.com,b@example.com']::text[] loop
   perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
   execute 'set local role anon';
   result:=public.pqr_submit_internal(gen_random_uuid(),jsonb_build_object('kind',k,
    'requesterName','QA rollback correo requerido','requesterEmail',email,'client','KO moderno','country','Chile',
    'pdv','12345','auditOriginal','9999912345','description','Prueba de validación, no debe crear tickets.','files','[]'::jsonb));
   execute 'reset role';
   assert result->>'error'=case when coalesce(btrim(email),'')='' then 'El correo de contacto es obligatorio' else 'Correo de contacto inválido' end,result::text;
  end loop;
 end loop;
 assert (select count(*) from public.pqr_tickets)=tickets;
 assert (select count(*) from public.pqr_mail_events)=events;
 assert (select count(*) from pqr_private.internal_receipts)=receipts;
 assert (select last_value from pqr_private.internal_code_seq)=serial;
 assert not has_table_privilege('anon','public.pqr_tickets','select');
 assert not (select prosecdef from pg_proc where oid='public.pqr_submit_internal(uuid,jsonb)'::regprocedure);
end $$;
select 'REQUIRED_EMAIL_ALL_INTERNAL_TYPES_OK_NO_RECORDS_CREATED' as verification;
rollback;
