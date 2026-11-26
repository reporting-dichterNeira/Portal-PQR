begin;
do $test$
declare analyst uuid; redigitator uuid; person uuid; worker uuid; ids uuid[]:=array[gen_random_uuid(),gen_random_uuid()]; i integer; d jsonb; result jsonb; items jsonb;
begin
 select id into strict analyst from public.pqr_profiles where active and role='validador' order by created_at limit 1;
 select id into strict redigitator from public.pqr_profiles where active and role='redigitador' order by created_at limit 1;
 select id into strict person from public.pqr_staff where active and role='validador' limit 1;
 select id into strict worker from public.pqr_staff where active and role='redigitador' limit 1;
 perform set_config('pqr.mail.group_pending','1',true);
 for i in 1..2 loop
  insert into public.pqr_tickets(id,code,status,data) values(ids[i],'PQR-TEST-'||ids[i]::text,'Radicado',jsonb_build_object('id',ids[i],'code','PQR-TEST-'||ids[i]::text,'scope','internal','publicInternal',true,'requesterName','QA prueba rollback','requestType','PQR','client','KO tradicional','country','Guatemala','pdv','00001','description','Prueba sin auditoría original','status','Radicado','timeline','[]'::jsonb));
 end loop;
 perform set_config('request.jwt.claim.sub',analyst::text,true);
 perform public.pqr_action('assign_validator',ids[1],jsonb_build_object('personId',person));
 foreach i in array array[1,2] loop
  begin
   perform public.pqr_action('dictate',ids[1],jsonb_build_object('decision',case when i=1 then 'yes' else 'no' end,'auditOriginal','','response','Respuesta de prueba','tipology','Confunde SKU','area','Validación'));
   raise exception 'CLOSE WITHOUT AUDIT';
  exception when others then if sqlerrm='CLOSE WITHOUT AUDIT' then raise;end if;end;
 end loop;
 result:=public.pqr_action('dictate',ids[1],'{"decision":"redigit","auditOriginal":"","response":"Redigitación requerida","tipology":"Confunde SKU","area":"Validación"}');
 assert result->>'status'='Pendiente de Redigitación' and coalesce(result->>'auditOriginal','')='';
 select jsonb_build_array(jsonb_build_object('id',id,'expectedUpdatedAt',updated_at,'auditOriginal','')) into items from public.pqr_tickets where id=ids[2];
 result:=public.pqr_analyst_batch('dictate',items,jsonb_build_object('personId',person,'decision','redigit','response','Misma respuesta sin auditoría','tipology','Confunde SKU','area','Validación'));
 assert (result->>'count')::integer=1;
 perform set_config('request.jwt.claim.sub',redigitator::text,true);
 perform public.pqr_action('assign_redigit',ids[1],jsonb_build_object('redigitType','Validación','personId',worker));
 begin
  perform public.pqr_action('redigit',ids[1],'{"audit":"999982828282","notes":"Trabajo completado"}');raise exception 'RESOLVE WITHOUT ORIGINAL';
 exception when others then if sqlerrm='RESOLVE WITHOUT ORIGINAL' then raise;end if;end;
 result:=public.pqr_action('redigit',ids[1],'{"auditOriginal":"00123456","audit":"999982828282","notes":"Trabajo completado"}');
 assert result->>'auditOriginal'='00123456' and result->>'status'='Pendiente de Verificación';
 perform public.pqr_action('assign_redigit',ids[2],'{"redigitType":"Campo"}');
 perform set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where active and role='campo' and field_country='Guatemala'),true);
 begin
  perform public.pqr_action('field_complete',ids[2],'{"audit":"999982828283","notes":"Trabajo de Campo"}');raise exception 'FIELD WITHOUT ORIGINAL';
 exception when others then if sqlerrm='FIELD WITHOUT ORIGINAL' then raise;end if;end;
 result:=public.pqr_action('field_complete',ids[2],'{"auditOriginal":"00654321","audit":"999982828283","notes":"Trabajo de Campo"}');
 assert result->>'auditOriginal'='00654321' and result->>'status'='Pendiente de aprobación de Validación';
end $test$;
rollback;
select 'OK: envío individual y múltiple sin auditoría; cierre sin redigitación exige ID; Validación y Campo deben completar original y nueva al resolver; prueba revertida' as result;
