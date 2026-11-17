begin;
set local lock_timeout='5s';
create table pqr_private.consolidated_mail_config (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 activated_at timestamptz, digest_cutoff timestamptz
);
insert into pqr_private.consolidated_mail_config(singleton) values(true);
create table pqr_private.submission_groups (
 request_id uuid primary key, code text not null unique default ('ENV-'||upper(replace(gen_random_uuid()::text,'-',''))),
 created_at timestamptz not null default now()
);
create table pqr_private.submission_members (
 ticket_id uuid primary key references public.pqr_tickets(id), request_id uuid not null references pqr_private.submission_groups(request_id)
);
create index submission_members_group_idx on pqr_private.submission_members(request_id);
create table pqr_private.consolidated_mail_queue (
 id uuid primary key default gen_random_uuid(), logical_key text not null unique,
 recipients text[] not null check(pqr_private.mail_addresses_valid(recipients) and cardinality(recipients)>0),
 copies text[] not null default '{}' check(pqr_private.mail_addresses_valid(copies)),
 subject text not null, body text not null, created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','submitted','accepted','failed','unknown')),
 http_id bigint, submitted_at timestamptz, http_status integer
);
create index consolidated_mail_pending_idx on pqr_private.consolidated_mail_queue(created_at) where state='pending';
create index consolidated_mail_submitted_idx on pqr_private.consolidated_mail_queue(http_id) where state='submitted';
create table pqr_private.mail_status_changes (
 id bigint generated always as identity primary key, ticket_id uuid not null references public.pqr_tickets(id),
 recipient text not null, code text not null, pdv text, before_status text, status text not null,
 changed_at timestamptz not null default clock_timestamp()
);
create index mail_status_changes_cutoff_idx on pqr_private.mail_status_changes(changed_at,recipient);
alter table pqr_private.consolidated_mail_config enable row level security;
alter table pqr_private.submission_groups enable row level security;
alter table pqr_private.submission_members enable row level security;
alter table pqr_private.consolidated_mail_queue enable row level security;
alter table pqr_private.mail_status_changes enable row level security;
revoke all on pqr_private.consolidated_mail_config,pqr_private.submission_groups,pqr_private.submission_members,pqr_private.consolidated_mail_queue,pqr_private.mail_status_changes from public,anon,authenticated,service_role;

create function pqr_private.finalize_submission(p_request uuid,p_receipt jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare group_code text; ids uuid[]; r public.pqr_tickets%rowtype; recips text[]; copies text[]; n integer; is_batch boolean:=p_receipt ? 'tickets';
begin
 if p_receipt is null or p_receipt ? 'error' then return p_receipt; end if;
 select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(case when is_batch then p_receipt->'tickets' else jsonb_build_array(p_receipt) end) x;
 if cardinality(ids) is null or cardinality(ids) not between 1 and 200 then raise exception 'Comprobante inválido'; end if;
 insert into pqr_private.submission_groups(request_id) values(p_request) on conflict do nothing;
 select code into strict group_code from pqr_private.submission_groups where request_id=p_request;
 insert into pqr_private.submission_members(ticket_id,request_id) select id,p_request from public.pqr_tickets where id=any(ids) and deleted_at is null and data->>'scope'='internal' on conflict(ticket_id) do nothing;
 select count(*) into n from pqr_private.submission_members where request_id=p_request;
 if n<>cardinality(ids) then raise exception 'No se pudo vincular el consolidado'; end if;
 select * into strict r from public.pqr_tickets where id=ids[1];
 if (select enabled from pqr_private.consolidated_mail_config where singleton) then
  if coalesce(r.data->>'requesterEmail','')<>'' then
   insert into pqr_private.consolidated_mail_queue(logical_key,recipients,subject,body)
   values('received:'||group_code,array[lower(btrim(r.data->>'requesterEmail'))], 'Recibimos tu envío · '||n||' PDV · '||group_code,
    'Registramos tu envío de '||n||E' PDV. Cada PDV conserva su ticket individual.\n\nConsolidado: '||group_code||E'\n\nConsulta todos sus estados ingresando este código en:\nhttps://reporting-dichterneira.github.io/Portal-PQR/#consultar-ticket') on conflict(logical_key) do nothing;
  end if;
  select array_agg(email order by email) into recips from pqr_private.internal_mail_routes where route_key=case when r.data->>'requestType'='PQR' then 'pqr' else 'redigit' end;
  select coalesce(array_agg(email order by email),'{}'::text[]) into copies from pqr_private.internal_mail_copies;
  if cardinality(recips)>0 then
   insert into pqr_private.consolidated_mail_queue(logical_key,recipients,copies,subject,body)
   values('team:'||group_code,recips,copies,'Nuevo envío · '||n||' PDV · '||group_code,
    'Se registraron '||n||' solicitudes de tipo '||coalesce(r.data->>'requestType','PQR')||E'.\nConsolidado: '||group_code||E'\n\nEstudio: '||coalesce(r.data->>'client','')||E'\nPaís: '||coalesce(r.data->>'country','')||E'\n\nCada ticket se atiende individualmente en:\nhttps://reporting-dichterneira.github.io/Portal-PQR/#gestion') on conflict(logical_key) do nothing;
  end if;
 end if;
 return p_receipt||jsonb_build_object('batchCode',group_code);
end $$;
revoke all on function pqr_private.finalize_submission(uuid,jsonb) from public,anon,authenticated,service_role;

create function pqr_private.submit_grouped(p_request_id uuid,p_data jsonb,p_batch boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; prev text:=coalesce(current_setting('pqr.mail.group_pending',true),'');
begin
 perform pg_advisory_xact_lock(hashtextextended('pqr-mailgroup:'||p_request_id::text,0));
 perform set_config('pqr.mail.group_pending','1',true);
 if p_batch then result:=pqr_private.submit_internal_batch(p_request_id,p_data); else result:=pqr_private.submit_internal(p_request_id,p_data); end if;
 perform set_config('pqr.mail.group_pending',prev,true);
 return pqr_private.finalize_submission(p_request_id,result);
end $$;
revoke all on function pqr_private.submit_grouped(uuid,jsonb,boolean) from public;
grant execute on function pqr_private.submit_grouped(uuid,jsonb,boolean) to anon,authenticated;
create or replace function public.pqr_submit_internal(p_request_id uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select pqr_private.submit_grouped(p_request_id,p_data,false) $$;
create or replace function public.pqr_submit_internal_batch(p_request_id uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select pqr_private.submit_grouped(p_request_id,p_data,true) $$;

create function pqr_private.lookup_submission(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 if not pqr_private.internal_gate('lookup') then return jsonb_build_object('error','Demasiadas consultas. Espera un minuto.'); end if;
 if v_code !~ '^ENV-[A-F0-9]{32}$' then return null; end if;
 select jsonb_build_object('batchCode',v_code,'tickets',coalesce(jsonb_agg(jsonb_build_object('code',t.code,'requestType',t.data->>'requestType','status',t.status,'createdAt',t.created_at,'updatedAt',t.updated_at,'closedAt',t.data->>'closedAt','pdv',t.data->>'pdv','requesterName',t.data->>'requesterName','description',t.data->>'description') order by t.created_at,t.code),'[]'::jsonb)) into result
 from pqr_private.submission_groups g join pqr_private.submission_members m on m.request_id=g.request_id join public.pqr_tickets t on t.id=m.ticket_id where g.code=v_code and t.deleted_at is null and t.data->>'scope'='internal';
 return result;
end $$;
revoke all on function pqr_private.lookup_submission(text) from public;
grant execute on function pqr_private.lookup_submission(text) to anon,authenticated;
create function public.pqr_lookup_submission(p_code text) returns jsonb language sql security invoker set search_path='' as $$ select pqr_private.lookup_submission(p_code) $$;
revoke all on function public.pqr_lookup_submission(text) from public;
grant execute on function public.pqr_lookup_submission(text) to anon,authenticated;

create function pqr_private.capture_mail_status() returns trigger
language plpgsql security definer set search_path='' as $$
declare recips text[]; copies text[]; v_email text:=lower(btrim(coalesce(new.data->>'requesterEmail','')));
begin
 if new.data->>'scope' is distinct from 'internal' or new.deleted_at is not null or not (select enabled from pqr_private.consolidated_mail_config where singleton) then return new; end if;
 if tg_op='INSERT' then
  if coalesce(current_setting('pqr.mail.group_pending',true),'')<>'1' then perform pqr_private.finalize_submission(new.id,jsonb_build_object('id',new.id)); end if;
  return new;
 end if;
 if new.status is distinct from old.status then
  if v_email<>'' then insert into pqr_private.mail_status_changes(ticket_id,recipient,code,pdv,before_status,status) values(new.id,v_email,new.code,new.data->>'pdv',old.status,new.status); end if;
  if new.status in ('Pendiente de Redigitación','Devuelto') then
   select array_agg(email order by email) into recips from pqr_private.internal_mail_routes where route_key='redigit';
   select coalesce(array_agg(email order by email),'{}'::text[]) into copies from pqr_private.internal_mail_copies;
   if cardinality(recips)>0 then
    insert into pqr_private.consolidated_mail_queue(logical_key,recipients,copies,subject,body) values('handoff:'||txid_current(),recips,copies,'Solicitudes pendientes en Redigitación',new.code||E'\nhttps://reporting-dichterneira.github.io/Portal-PQR/#gestion')
    on conflict(logical_key) do update set body=pqr_private.consolidated_mail_queue.body||E'\n'||new.code;
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function pqr_private.capture_mail_status() from public,anon,authenticated,service_role;
create trigger pqr_consolidated_mail_changes after insert or update on public.pqr_tickets for each row execute function pqr_private.capture_mail_status();

create function pqr_private.prepare_daily_digest(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare cfg pqr_private.consolidated_mail_config%rowtype; cutoff timestamptz; r record; total integer:=0;
begin
 select * into strict cfg from pqr_private.consolidated_mail_config where singleton for update;
 if not cfg.enabled then return 0; end if;
 cutoff:=((p_now at time zone 'America/Bogota')::date+time '17:00') at time zone 'America/Bogota';
 if cutoff>p_now then cutoff:=cutoff-interval '1 day'; end if;
 if cutoff<=coalesce(cfg.digest_cutoff,cfg.activated_at) then return 0; end if;
 for r in
  select recipient,count(*) n,string_agg(code||' | PDV: '||coalesce(pdv,'No indicado')||' | '||status||case when status in ('Cerrado','No Aplica') then ' · Finalizado' else '' end,E'\n' order by code) lines
  from (select distinct on(c.ticket_id,c.recipient) c.* from pqr_private.mail_status_changes c join public.pqr_tickets t on t.id=c.ticket_id
   where c.changed_at>=coalesce(cfg.digest_cutoff,cfg.activated_at) and c.changed_at<cutoff and t.deleted_at is null and t.data->>'scope'='internal' order by c.ticket_id,c.recipient,c.changed_at desc,c.id desc) latest group by recipient
 loop
  insert into pqr_private.consolidated_mail_queue(logical_key,recipients,subject,body)
  values('digest:'||md5(r.recipient)||':'||cutoff::text,array[r.recipient],'Resumen de tus solicitudes · '||r.n||' tickets con novedades',E'Estos tickets cambiaron de estado durante el último corte:\n\n'||r.lines||E'\n\nConsulta el detalle en:\nhttps://reporting-dichterneira.github.io/Portal-PQR/#consultar-ticket') on conflict(logical_key) do nothing;
  total:=total+1;
 end loop;
 update pqr_private.consolidated_mail_config set digest_cutoff=cutoff where singleton;
 return total;
end $$;
revoke all on function pqr_private.prepare_daily_digest(timestamptz) from public,anon,authenticated,service_role;

create function pqr_private.dispatch_consolidated_mail() returns integer
language plpgsql security definer set search_path='' as $$
declare target text; r pqr_private.consolidated_mail_queue%rowtype; request bigint; total integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('pqr-consolidated-dispatch',0)) then return 0; end if;
 if not (select enabled from pqr_private.consolidated_mail_config where singleton) then return 0; end if;
 perform pqr_private.prepare_daily_digest();
 update pqr_private.consolidated_mail_queue q set state=case when n.status_code between 200 and 299 then 'accepted' when n.timed_out or n.status_code is null then 'unknown' else 'failed' end,http_status=n.status_code from net._http_response n where q.state='submitted' and q.http_id=n.id;
 update pqr_private.consolidated_mail_queue set state='unknown' where state='submitted' and submitted_at<now()-interval '15 minutes';
 select decrypted_secret into strict target from vault.decrypted_secrets where name='pqr_power_automate_url';
 if target !~ '^https://[a-z0-9.-]+\.environment\.api\.powerplatform\.com(:443)?/' or strpos(target,'sig=')=0 then raise exception 'Receptor no configurado'; end if;
 for r in select * from pqr_private.consolidated_mail_queue where state='pending' order by created_at,id limit 5 for update skip locked loop
  select net.http_post(url:=target,headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('type','message','attachments','[]'::jsonb,'pqr',jsonb_build_object('id',r.id,'to',array_to_string(array(select distinct address from unnest(r.recipients||r.copies) address),';'),'cc',array_to_string(r.copies,';'),'subject',r.subject,'html','<p>'||replace(replace(replace(replace(r.body,'&','&amp;'),'<','&lt;'),'>','&gt;'),E'\n','<br>')||'</p>')),timeout_milliseconds:=10000) into request;
  update pqr_private.consolidated_mail_queue set state='submitted',http_id=request,submitted_at=now() where id=r.id;
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function pqr_private.dispatch_consolidated_mail() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
-- Activation and Cron switch are separate after the Outlook workflow is tested.
