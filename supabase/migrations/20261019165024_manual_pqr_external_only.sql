-- Manual registration belongs only to clients. Public internal intake is unchanged.
begin;
create or replace function pqr_private.create_manual_scoped(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.pqr_profiles where id=auth.uid() and active and role in ('validador','gerente')) then
  raise exception 'Cuenta no autorizada';
 end if;
 if coalesce(p_data->>'scope','external') <> 'external' then
  raise exception 'La radicación manual solo está disponible en PQR de clientes';
 end if;
 return pqr_private.create_manual_pqr(p_data);
end $$;
revoke all on function pqr_private.create_manual_scoped(jsonb) from public,anon;
grant execute on function pqr_private.create_manual_scoped(jsonb) to authenticated;
-- Private, recoverable record of the explicitly requested correction.
create table if not exists pqr_private.ticket_scope_transfers (
 operation text not null,
 ticket_id uuid not null references public.pqr_tickets(id),
 old_code text not null,
 new_code text not null,
 before_snapshot jsonb not null,
 moved_at timestamptz not null default now(),
 reason text not null,
 primary key(operation,ticket_id)
);
alter table pqr_private.ticket_scope_transfers enable row level security;
revoke all on pqr_private.ticket_scope_transfers from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
