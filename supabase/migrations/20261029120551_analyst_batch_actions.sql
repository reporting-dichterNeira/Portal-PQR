-- Reuses existing workflow/notifications. The whole selection commits or rolls back.
begin;
set local lock_timeout='5s';
create function pqr_private.analyst_batch(p_operation text,p_items jsonb,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; r public.pqr_tickets%rowtype; person uuid; scope text;
 n integer; seen integer:=0; payload jsonb; result jsonb; results jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.pqr_profiles where id=auth.uid() and active and role='validador') then
  raise exception 'Solo Analistas de PQR pueden gestionar la selección';
 end if;
 if p_operation is null or p_operation not in ('assign','dictate') or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Solicitud múltiple inválida'; end if;
 n:=jsonb_array_length(p_items);
 if n not between 1 and 100 then raise exception 'Selecciona entre 1 y 100 PQR'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) is distinct from 'object'
  or nullif(x->>'id','') is null or nullif(x->>'expectedUpdatedAt','') is null)
  or (select count(distinct x->>'id') from jsonb_array_elements(p_items) x)<>n then raise exception 'Selección inválida o repetida'; end if;
 person:=(p_data->>'personId')::uuid;
 if person is null or not exists(select 1 from public.pqr_staff where id=person and active and role='validador') then raise exception 'Selecciona un analista activo'; end if;
 if p_operation='dictate' and (coalesce(p_data->>'decision','') not in ('no','yes','redigit')
  or length(btrim(coalesce(p_data->>'response',''))) not between 5 and 12000
  or length(btrim(coalesce(p_data->>'tipology',''))) not between 1 and 150
  or length(btrim(coalesce(p_data->>'area',''))) not between 1 and 100) then raise exception 'Completa el dictamen común'; end if;
 -- Stable UUID order avoids deadlocks between overlapping selections. Validate every row first.
 for r in select t.* from public.pqr_tickets t
  join jsonb_array_elements(p_items) x on t.id=(x->>'id')::uuid order by t.id for update of t loop
  seen:=seen+1;
  select x into item from jsonb_array_elements(p_items) x where (x->>'id')::uuid=r.id;
  if r.deleted_at is not null or coalesce(r.data->>'requestType',case when r.code like 'RDG-%' or r.data->>'directRedigitation'='true' then 'RDG' when r.code like 'EDC-%' then 'EDC' else 'PQR' end)<>'PQR'
   or r.status not in ('Radicado','En Validación','Reabierto') then raise exception '% ya no está pendiente de asignación o dictamen. Actualiza la bandeja',r.code; end if;
  if r.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then raise exception '% cambió desde que abriste la bandeja. Actualiza y revisa la selección',r.code; end if;
  if scope is null then scope:=coalesce(r.data->>'scope','external');
  elsif scope<>coalesce(r.data->>'scope','external') then raise exception 'No mezcles PQR internas y de clientes'; end if;
  if p_operation='dictate' then
   if btrim(coalesce(item->>'auditOriginal','')) !~ '^[0-9]{1,80}$' then raise exception '%: completa su ID de auditoría',r.code; end if;
   if r.data->>'manualEntry'='true' and (btrim(coalesce(item->>'pdv',r.data->>'pdv','')) !~ '^[0-9]{1,80}$'
    or length(btrim(coalesce(item->>'description',r.data->>'description',''))) not between 8 and 12000) then raise exception '%: completa su PDV y descripción',r.code; end if;
  end if;
 end loop;
 if seen<>n then raise exception 'Una PQR ya no existe o no está disponible. Actualiza la bandeja'; end if;
 for r in select t.* from public.pqr_tickets t join jsonb_array_elements(p_items) x on t.id=(x->>'id')::uuid order by t.id loop
  select x into item from jsonb_array_elements(p_items) x where (x->>'id')::uuid=r.id;
  result:=public.pqr_action('assign_validator',r.id,jsonb_build_object('personId',person));
  if p_operation='dictate' then
   payload:=jsonb_build_object('decision',p_data->>'decision','tipology',btrim(p_data->>'tipology'),'area',btrim(p_data->>'area'),
    'response',btrim(p_data->>'response'),'auditOriginal',btrim(item->>'auditOriginal'));
   if r.data->>'manualEntry'='true' then payload:=payload||jsonb_build_object('pdv',btrim(coalesce(item->>'pdv',r.data->>'pdv')),'description',btrim(coalesce(item->>'description',r.data->>'description'))); end if;
   result:=public.pqr_action('dictate',r.id,payload);
  end if;
  results:=results||jsonb_build_array(jsonb_build_object('id',r.id,'code',r.code,'status',result->>'status'));
 end loop;
 return jsonb_build_object('count',n,'operation',p_operation,'tickets',results);
end $$;
revoke all on function pqr_private.analyst_batch(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function pqr_private.analyst_batch(text,jsonb,jsonb) to authenticated;
create function public.pqr_analyst_batch(p_operation text,p_items jsonb,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.analyst_batch(p_operation,p_items,p_data) $$;
revoke all on function public.pqr_analyst_batch(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pqr_analyst_batch(text,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
