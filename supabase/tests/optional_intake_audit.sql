begin;
create or replace function pqr_private.new_internal_code(p_kind text) returns text language plpgsql set search_path='' as $$ begin return p_kind||'-TEST-'||gen_random_uuid()::text; end $$;
alter table pqr_private.submission_groups alter column code set default ('ENV-TEST-'||gen_random_uuid()::text);
do $test$
declare kind text; payload jsonb; result jsonb; single_result jsonb; request uuid; ticket uuid; redigitator uuid; worker uuid; audit text; baseline bigint;
begin
 select count(*) into baseline from public.pqr_tickets;
 select id into strict redigitator from public.pqr_profiles where active and role='redigitador' limit 1;
 select id into strict worker from public.pqr_staff where active and role='redigitador' limit 1;
 foreach kind in array array['PQR','RDG','EDC'] loop
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
  delete from pqr_private.internal_rate_limits where key like 'internal-batch:global:%';
  request:=gen_random_uuid();
  payload:=jsonb_build_object('kind',kind,'requesterName','Prueba auditoría opcional','requesterEmail','qa@example.invalid','client','KO tradicional','country','Guatemala','pdv','000123','description','Detalle de prueba sin auditoría','priority','0','auditOriginal','');
  single_result:=public.pqr_submit_internal(gen_random_uuid(),payload);
  assert not single_result ? 'error',single_result::text;
  result:=public.pqr_submit_internal_batch(request,(payload-'pdv'-'description'-'priority'-'auditOriginal')||jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('pdv','000124','description','Detalle de prueba sin auditoría','priority','1','auditOriginal',''),jsonb_build_object('pdv','000125','description','Segundo detalle sin auditoría','priority','0'))));
  assert not result ? 'error',result::text;
  assert jsonb_array_length(result->'tickets')=2;
  assert (select count(*)=2 from pqr_private.consolidated_mail_queue where logical_key in ('received:'||(result->>'batchCode'),'team:'||(result->>'batchCode'))),'Grouped mail preserved';
  if kind in ('RDG','EDC') then
   select m.ticket_id into strict ticket from pqr_private.submission_members m where m.request_id=request limit 1;
   perform set_config('request.jwt.claim.sub',redigitator::text,true);
   perform public.pqr_action('assign_redigit',ticket,jsonb_build_object('redigitType','Validación','personId',worker));
   payload:=case when kind='RDG' then '{"audit":"99887766","notes":"Trabajo realizado"}'::jsonb else '{"edited":"yes","comment":"Edición realizada"}'::jsonb end;
   begin
    perform public.pqr_action(case when kind='RDG' then 'redigit' else 'edit_complete' end,ticket,payload);
    raise exception 'RESOLVED WITHOUT AUDIT';
   exception when others then
    if sqlerrm='RESOLVED WITHOUT AUDIT' then raise; end if;
    assert sqlerrm like '%ID de auditoría original%',sqlerrm;
   end;
   result:=public.pqr_action(case when kind='RDG' then 'redigit' else 'edit_complete' end,ticket,payload||'{"auditOriginal":"00123456"}'::jsonb);
   assert result->>'auditOriginal'='00123456';
   assert result->>'status'=case when kind='RDG' then 'Pendiente de Verificación' else 'Cerrado' end;
  end if;
 end loop;
 assert (select count(*)=baseline+9 from public.pqr_tickets);
end $test$;
rollback;
select 'OK: PQR/RDG/EDC individual y Excel sin auditoría; redigitación y edición exigen ID al resolver; correo consolidado preservado; prueba revertida' result;
