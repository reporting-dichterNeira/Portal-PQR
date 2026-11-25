begin;
update pqr_private.consolidated_mail_config set enabled=false where singleton;
select set_config('pqr.test.gt',gen_random_uuid()::text,true),set_config('pqr.test.hn',gen_random_uuid()::text,true),set_config('pqr.test.validation',gen_random_uuid()::text,true);
insert into public.pqr_tickets(id,code,commercial_id,status,data)
select current_setting('pqr.test.'||x.key)::uuid,'RDG-TEST-'||x.key,(select id from public.pqr_profiles where role='comercial' limit 1),'Pendiente de Redigitación',
 jsonb_build_object('id',current_setting('pqr.test.'||x.key),'code','RDG-TEST-'||x.key,'scope','internal','requestType','RDG','country',x.country,'client','KO tradicional','pdv','000001','directRedigitation',true,'status','Pendiente de Redigitación','createdAt',now(),'timeline','[]'::jsonb,'redigitador',(select id::text from public.pqr_profiles where role='redigitador' and active limit 1))
from(values('gt','Guatemala'),('hn','Honduras'),('validation','Guatemala'))x(key,country);
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where role='redigitador' and active limit 1),true),set_config('request.headers','{}',true);
select public.pqr_action('assign_redigit',current_setting('pqr.test.gt')::uuid,'{"redigitType":"Campo"}');
select public.pqr_action('assign_redigit',current_setting('pqr.test.hn')::uuid,'{"redigitType":"Campo"}');
select public.pqr_action('assign_redigit',current_setting('pqr.test.validation')::uuid,jsonb_build_object('redigitType','Validación','personId',(select id from public.pqr_staff where role='redigitador' and active limit 1)));
select public.pqr_action('redigit',current_setting('pqr.test.validation')::uuid,'{"audit":"99999999191901","notes":"Prueba de Validación"}');
do $$ begin
 assert (select status='Pendiente de Verificación' and not(data?'closedAt') from public.pqr_tickets where id=current_setting('pqr.test.validation')::uuid),'Direct validation must await PQR';
 begin perform public.pqr_action('redigit',current_setting('pqr.test.gt')::uuid,'{"audit":"99999999191902","notes":"No debe permitir saltar Campo"}');raise exception 'BYPASS ALLOWED';exception when others then if sqlerrm='BYPASS ALLOWED' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where username='campogt'),true);
set local role authenticated;
do $$ begin
 assert (select count(*)=1 from public.pqr_tickets where id in(current_setting('pqr.test.gt')::uuid,current_setting('pqr.test.hn')::uuid,current_setting('pqr.test.validation')::uuid)),'Campo must see only own country and assigned cases';
 begin perform public.pqr_action('field_complete',current_setting('pqr.test.hn')::uuid,'{"audit":"99999999191903","notes":"No debe confirmar otro país"}');raise exception 'CROSS COUNTRY ALLOWED';exception when others then if sqlerrm='CROSS COUNTRY ALLOWED' then raise;end if;end;
end $$;
select public.pqr_action('field_complete',current_setting('pqr.test.gt')::uuid,'{"audit":"99999999191904","notes":"Redigitación completada en prueba"}');
reset role;
do $$ begin assert (select status='Pendiente de aprobación de Validación' and not(data?'closedAt') from public.pqr_tickets where id=current_setting('pqr.test.gt')::uuid),'Field must await Validation';end $$;
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where role='validador' and active limit 1),true);
do $$ begin
 begin perform public.pqr_action('verify',current_setting('pqr.test.gt')::uuid,'{"ok":"yes","comment":"Intento de saltar Validación"}');raise exception 'BYPASS ALLOWED';exception when others then if sqlerrm='BYPASS ALLOWED' then raise;end if;end;
 begin perform public.pqr_action('field_review',current_setting('pqr.test.gt')::uuid,'{"ok":"yes","comment":"Analista no puede aprobar Validación"}');raise exception 'WRONG ROLE ALLOWED';exception when others then if sqlerrm='WRONG ROLE ALLOWED' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where role='redigitador' and active limit 1),true);
select public.pqr_action('field_review',current_setting('pqr.test.gt')::uuid,'{"ok":"no","comment":"Revisar el ajuste nuevamente"}');
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where username='campogt'),true);
select public.pqr_action('field_complete',current_setting('pqr.test.gt')::uuid,'{"audit":"99999999191905","notes":"Segunda corrección de prueba"}');
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where role='validador' and active limit 1),true);
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where role='redigitador' and active limit 1),true);
select public.pqr_action('field_review',current_setting('pqr.test.gt')::uuid,'{"ok":"yes","comment":"Trabajo de Campo aprobado por Validación"}');
do $$ begin assert (select status='Pendiente de Verificación' and data->>'fieldApprovedAudit'=data->>'audit' and not(data?'closedAt') from public.pqr_tickets where id=current_setting('pqr.test.gt')::uuid),'Validation approval must await analyst closure';end $$;
select set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where role='validador' and active limit 1),true);
select public.pqr_action('verify',current_setting('pqr.test.gt')::uuid,'{"ok":"yes","comment":"Aprobado por Analistas de PQR"}');
do $$ begin assert (select status='Cerrado' and data?'closedAt' from public.pqr_tickets where id=current_setting('pqr.test.gt')::uuid),'Only PQR closes';end $$;
rollback;
select 'Flujo Validación → Campo → Validación → Analistas: OK; aislamiento RLS y bloqueo de cierre anticipado' result;

