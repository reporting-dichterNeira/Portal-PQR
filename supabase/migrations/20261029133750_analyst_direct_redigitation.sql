-- Analyst-created direct RDG uses the existing redigitator inbox and closing flow.
begin;
set local lock_timeout='5s';
create function pqr_private.create_analyst_redigitation(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor public.pqr_profiles%rowtype; recipient uuid; ticket_id uuid:=gen_random_uuid();
 stamp timestamptz:=now(); code text; ticket jsonb; scope text:=coalesce(p_data->>'scope','external');
 pdv text:=btrim(coalesce(p_data->>'pdv','')); audit text:=btrim(coalesce(p_data->>'auditOriginal',''));
 study text:=btrim(coalesce(p_data->>'client','')); country text:=btrim(coalesce(p_data->>'country',''));
 reason text:=btrim(coalesce(p_data->>'description','')); serial text;
begin
 select * into actor from public.pqr_profiles where id=auth.uid() and active and role='validador';
 if not found then raise exception 'Solo Analistas de PQR pueden enviar esta solicitud'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or scope not in ('internal','external') then raise exception 'Solicitud inválida'; end if;
 if audit !~ '^[0-9]{1,80}$' then raise exception 'ID de auditoría inválido'; end if;
 if pdv !~ '^[0-9]{1,80}$' then raise exception 'ID de PDV inválido'; end if;
 if length(study) not between 1 and 100 or length(country) not between 1 and 100
  or length(reason) not between 8 and 10000 then raise exception 'Completa estudio, país y motivo (8 a 10000 caracteres)'; end if;
 select id into recipient from public.pqr_profiles where active and role='redigitador' order by created_at,id limit 1;
 if recipient is null then raise exception 'No hay cuenta de Redigitación activa'; end if;
 if scope='internal' then code:=pqr_private.new_internal_code('RDG');
 else
  serial:=nextval('public.pqr_code_seq')::text;
  code:='RDG-'||extract(year from stamp at time zone 'America/Bogota')::int||'-'||repeat('0',greatest(0,4-length(serial)))||serial;
 end if;
 ticket:=jsonb_build_object('id',ticket_id,'code',code,'requestType','RDG','scope',scope,
  'commercial',actor.id,'createdBy',actor.id,'requesterName',actor.name,'analystDirect',true,
  'pdv',pdv,'auditOriginal',audit,'client',study,'country',country,'description',reason,'support','',
  'status','Pendiente de Redigitación','createdAt',stamp,'timeline','[]'::jsonb,
  'redigitador',recipient,'redigitRequestedAt',stamp,'directRedigitation',true,'editRequest',false);
 ticket:=public.pqr_event(ticket,actor.name,'Redigitación directa enviada por Analistas de PQR','Auditoría actual: '||audit||'. '||reason);
 insert into public.pqr_tickets(id,code,commercial_id,status,created_at,updated_at,data)
  values(ticket_id,code,actor.id,'Pendiente de Redigitación',stamp,stamp,ticket);
 perform public.pqr_notice(recipient,ticket_id,'Redigitación directa',code||' espera gestión en la bandeja de Redigitación');
 return ticket;
end $$;
revoke all on function pqr_private.create_analyst_redigitation(jsonb) from public,anon;
grant execute on function pqr_private.create_analyst_redigitation(jsonb) to authenticated;
create function public.pqr_create_analyst_redigitation(p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.create_analyst_redigitation(p_data) $$;
revoke all on function public.pqr_create_analyst_redigitation(jsonb) from public,anon;
grant execute on function public.pqr_create_analyst_redigitation(jsonb) to authenticated;

-- Only attachments to the analyst's own direct requests; no ticket UPDATE grant.
create policy pqr_analyst_direct_upload on storage.objects for insert to authenticated
with check (bucket_id='pqr-adjuntos' and array_length(storage.foldername(name),1)=1
 and (select public.pqr_role())='validador' and exists(
  select 1 from public.pqr_tickets t where t.id::text=(storage.foldername(name))[1]
   and t.deleted_at is null and t.data->>'analystDirect'='true' and t.data->>'requestType'='RDG'
   and t.data->>'createdBy'=(select auth.uid())::text));
notify pgrst,'reload schema';
commit;
