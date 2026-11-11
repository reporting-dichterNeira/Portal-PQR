-- Universal chooses one permitted role per request; no shared profile role is mutated.
begin;
set local lock_timeout='5s';
alter table public.pqr_profiles drop constraint pqr_profiles_role_check;
alter table public.pqr_profiles add constraint pqr_profiles_role_check check(role in ('admin','gerente','validador','redigitador','comercial','universal'));
create function pqr_private.current_actor() returns setof public.pqr_profiles
language plpgsql stable security definer set search_path='' as $$
declare actor public.pqr_profiles%rowtype; chosen text;
begin
 select * into actor from public.pqr_profiles where id=auth.uid() and active;
 if not found then return; end if;
 if actor.role='universal' then
  chosen:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-pqr-profile';
  if chosen is null or chosen not in ('validador','redigitador','gerente') then return; end if;
  actor.role:=chosen;
 end if;
 return next actor;
end $$;
revoke all on function pqr_private.current_actor() from public,anon,authenticated,service_role;
create or replace function public.pqr_role() returns text language sql stable security definer set search_path='' as $$
 select role from pqr_private.current_actor()
$$;
revoke all on function public.pqr_role() from public,anon;
grant execute on function public.pqr_role() to authenticated;

do $patch$
declare definition text; anchor text:=$old$select * into v_actor from public.pqr_profiles where id = auth.uid() and active = true;$old$;
begin
 definition:=pg_get_functiondef('public.pqr_action_legacy(text, uuid, jsonb)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: public.pqr_action_legacy'; end if;
 definition:=replace(definition,anchor,$new$select * into v_actor from pqr_private.current_actor();$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select * into v_actor from public.pqr_profiles where id = auth.uid() and active = true;$old$;
begin
 definition:=pg_get_functiondef('public.pqr_complete_edit(uuid, boolean, text)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: public.pqr_complete_edit'; end if;
 definition:=replace(definition,anchor,$new$select * into v_actor from pqr_private.current_actor();$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select * into v_actor from public.pqr_profiles where id=auth.uid() and active;$old$;
begin
 definition:=pg_get_functiondef('pqr_private.create_manual_pqr(jsonb)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: pqr_private.create_manual_pqr'; end if;
 definition:=replace(definition,anchor,$new$select * into v_actor from pqr_private.current_actor();$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select * into v_actor from public.pqr_profiles where id=auth.uid() and active;$old$;
begin
 definition:=pg_get_functiondef('pqr_private.edit_manual_pqr(uuid, timestamp with time zone, jsonb)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: pqr_private.edit_manual_pqr'; end if;
 definition:=replace(definition,anchor,$new$select * into v_actor from pqr_private.current_actor();$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select * into actor from public.pqr_profiles where id=auth.uid() and active;$old$;
begin
 definition:=pg_get_functiondef('pqr_private.create_manual_batch(uuid, jsonb)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: pqr_private.create_manual_batch'; end if;
 definition:=replace(definition,anchor,$new$select * into actor from pqr_private.current_actor();$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select 1 from public.pqr_profiles where id=auth.uid() and active and role$old$;
begin
 definition:=pg_get_functiondef('pqr_private.create_manual_scoped(jsonb)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: pqr_private.create_manual_scoped'; end if;
 definition:=replace(definition,anchor,$new$select 1 from pqr_private.current_actor() where role$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select 1 from public.pqr_profiles where id=auth.uid() and active and role$old$;
begin
 definition:=pg_get_functiondef('pqr_private.analyst_batch(text, jsonb, jsonb)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: pqr_private.analyst_batch'; end if;
 definition:=replace(definition,anchor,$new$select 1 from pqr_private.current_actor() where role$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select 1 from public.pqr_profiles where id=auth.uid() and active and role$old$;
begin
 definition:=pg_get_functiondef('pqr_private.suggest_audits(uuid[])'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: pqr_private.suggest_audits'; end if;
 definition:=replace(definition,anchor,$new$select 1 from pqr_private.current_actor() where role$new$);
 execute definition;
end $patch$;

do $patch$
declare definition text; anchor text:=$old$select * into actor from public.pqr_profiles where id=auth.uid() and active and role='validador';$old$;
begin
 definition:=pg_get_functiondef('pqr_private.create_analyst_redigitation(jsonb)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected role lookup: pqr_private.create_analyst_redigitation'; end if;
 definition:=replace(definition,anchor,$new$select * into actor from pqr_private.current_actor();$new$);
 definition:=replace(definition,$old$if not found then raise exception 'Solo Analistas$old$,$new$if not found or actor.role<>'validador' then raise exception 'Solo Analistas$new$);
 execute definition;
end $patch$;

notify pgrst,'reload schema';
commit;
