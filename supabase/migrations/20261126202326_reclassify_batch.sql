begin;
set local lock_timeout='5s';
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.pqr_reclassify(uuid,jsonb)'::regprocedure);
 anchor:=$a$if coalesce(t.data->>'auditOriginal','') !~ '^[0-9]{1,80}$' then$a$;
 assert strpos(definition,anchor)>0,'Unexpected audit guard';
 definition:=replace(definition,anchor,$a$if (kind='EDC' or coalesce(t.data->>'auditOriginal','')<>'') and coalesce(t.data->>'auditOriginal','') !~ '^[0-9]{1,80}$' then$a$);
 execute definition;
end $$;
create function public.pqr_reclassify_batch(p_items jsonb,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.pqr_profiles%rowtype; t public.pqr_tickets%rowtype; item jsonb; n integer; seen integer:=0; scope text; result jsonb;
begin
 select * into actor from pqr_private.current_actor();
 if actor.id is null or (actor.role<>'validador' and not exists(select 1 from public.pqr_profiles where id=auth.uid() and active and role='universal')) then raise exception 'Solo Analistas PQR y Universal pueden reclasificar' using errcode='42501'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Selección inválida'; end if;
 if coalesce(p_data->>'requestType','') not in ('RDG','EDC') or coalesce(p_data->>'redigitType','') not in ('Validación','Campo') or length(btrim(coalesce(p_data->>'reason',''))) not between 5 and 12000 or (p_data->>'requestType'='EDC' and p_data->>'redigitType'<>'Validación') then raise exception 'Completa clasificación, destino y motivo'; end if;
 n:=jsonb_array_length(p_items);
 if n not between 1 and 100 or (select count(distinct x->>'id') from jsonb_array_elements(p_items)x)<>n or exists(select 1 from jsonb_array_elements(p_items)x where jsonb_typeof(x) is distinct from 'object' or nullif(x->>'expectedUpdatedAt','') is null) then raise exception 'Selecciona entre 1 y 100 casos distintos'; end if;
 for t in select q.* from public.pqr_tickets q join jsonb_array_elements(p_items)x on q.id=(x->>'id')::uuid order by q.id for update of q loop
  seen:=seen+1;
  select x into item from jsonb_array_elements(p_items)x where (x->>'id')::uuid=t.id;
  if t.deleted_at is not null or t.status not in ('Radicado','En Validación','Reabierto') or coalesce(t.data->>'requestType','PQR')<>'PQR' then raise exception '% ya no permite reclasificación',t.code; end if;
  if t.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then raise exception '% cambió. Actualiza la bandeja y revisa la selección',t.code; end if;
  if scope is null then scope:=coalesce(t.data->>'scope','external'); elsif scope<>coalesce(t.data->>'scope','external') then raise exception 'No mezcles bandejas'; end if;
 end loop;
 if seen<>n then raise exception 'Alguno de los casos ya no está disponible'; end if;
 for t in select q.* from public.pqr_tickets q join jsonb_array_elements(p_items)x on q.id=(x->>'id')::uuid order by q.id loop
  result:=public.pqr_reclassify(t.id,p_data);
 end loop;
 return jsonb_build_object('count',n,'requestType',p_data->>'requestType','destination',p_data->>'redigitType');
end $$;
revoke all on function public.pqr_reclassify_batch(jsonb,jsonb) from public,anon;
grant execute on function public.pqr_reclassify_batch(jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
