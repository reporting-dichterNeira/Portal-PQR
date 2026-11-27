begin;
do $test$
declare actor uuid; person uuid; outsider uuid; ids uuid[]:=array[gen_random_uuid(),gen_random_uuid()]; i integer; items jsonb; payload jsonb; result jsonb; before_data jsonb;
begin
 select id into strict actor from public.pqr_profiles where active and role='validador' limit 1;
 select id into strict person from public.pqr_staff where active and role='redigitador' limit 1;
 select id into strict outsider from public.pqr_profiles where active and role='comercial' limit 1;
 perform set_config('pqr.mail.group_pending','1',true);
 for i in 1..2 loop
  insert into public.pqr_tickets(id,code,status,data) values(ids[i],'PQR-TEST-'||ids[i]::text,'Radicado',jsonb_build_object('id',ids[i],'code','PQR-TEST-'||ids[i]::text,'scope','internal','publicInternal',true,'requesterName','QA reclasificación rollback','requestType','PQR','client','KO tradicional','country','Guatemala','pdv',i::text,'auditOriginal','','description','Corrección de clasificación de prueba','status','Radicado','timeline','[]'::jsonb));
 end loop;
 select jsonb_agg(jsonb_build_object('id',id,'expectedUpdatedAt',updated_at)) into items from public.pqr_tickets where id=any(ids);
 payload:=jsonb_build_object('requestType','EDC','redigitType','Validación','personId',person,'reason','Se cargaron como PQR por error');
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.pqr_reclassify_batch(items,payload);raise exception 'OUTSIDER ALLOWED';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select data into before_data from public.pqr_tickets where id=ids[1];
 begin
  perform public.pqr_reclassify_batch(jsonb_set(items,'{1,expectedUpdatedAt}',to_jsonb((now()-interval '1 day')::text)),payload);
  raise exception 'STALE ALLOWED';
 exception when others then if sqlerrm='STALE ALLOWED' then raise;end if;end;
 assert (select data=before_data from public.pqr_tickets where id=ids[1]);
 result:=public.pqr_reclassify_batch(items,payload);
 assert result->>'count'='2';
 assert (select bool_and(data->>'requestType'='EDC' and data->>'originalRequestType'='PQR' and code='PQR-TEST-'||id::text and status='Pendiente de Redigitación' and data->>'reclassificationReason'='Se cargaron como PQR por error') from public.pqr_tickets where id=any(ids));
 -- Retrying the old selection must be rejected, not repeat the history or notices.
 begin perform public.pqr_reclassify_batch(items,payload);raise exception 'RETRY ALLOWED';exception when others then if sqlerrm='RETRY ALLOWED' then raise;end if;end;
 -- Every reclassified edition must still require its audit before resolution.
 perform set_config('request.jwt.claim.sub',(select id::text from public.pqr_profiles where active and role='redigitador' order by created_at limit 1),true);
 begin
  perform public.pqr_action('edit_complete',ids[1],'{"edited":"yes","comment":"Edición de prueba completada"}');
  raise exception 'CLOSED WITHOUT AUDIT';
 exception when others then
  if sqlerrm='CLOSED WITHOUT AUDIT' then raise;end if;
  assert sqlerrm like '%ID de auditoría original%',sqlerrm;
 end;
 result:=public.pqr_action('edit_complete',ids[1],'{"edited":"yes","comment":"Edición de prueba completada","auditOriginal":"001234567"}');
 assert result->>'status'='Cerrado' and result->>'auditOriginal'='001234567';
end $test$;
rollback;
select 'OK: PQR a edición sin auditoría en lote; conserva radicados y permisos; resolver exige auditoría; prueba revertida' result;
