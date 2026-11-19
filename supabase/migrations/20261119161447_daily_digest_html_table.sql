begin;
set local lock_timeout='5s';
alter table pqr_private.consolidated_mail_queue add column body_html text;
alter table pqr_private.mail_status_changes add column reply text;
create function pqr_private.mail_html_escape(value text) returns text language sql immutable set search_path='' as $$
 select replace(replace(replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')
$$;
create function pqr_private.mail_ticket_reply(d jsonb) returns text language sql immutable set search_path='' as $$
 select coalesce(nullif(concat_ws(E'\n\n',
 case when nullif(btrim(d->>'response'),'') is not null then 'Respuesta: '||btrim(d->>'response') end,
 case when nullif(btrim(d->>'redigitNotes'),'') is not null then 'Redigitación: '||btrim(d->>'redigitNotes') end,
 case when nullif(btrim(d->>'editComment'),'') is not null then 'Edición: '||btrim(d->>'editComment') end,
 case when nullif(btrim(d->>'verifyComment'),'') is not null then 'Verificación final: '||btrim(d->>'verifyComment') end
 ),''),'Sin respuesta registrada')
$$;
create function pqr_private.render_daily_digest(items jsonb,cutoff timestamptz) returns text language plpgsql immutable set search_path='' as $$
declare row jsonb; rows_html text:=''; finished boolean; bg text; current_status text; previous_status text; closed_count integer:=0;
begin
 for row in select value from jsonb_array_elements(items) order by (value->>'status' in ('Cerrado','No Aplica')) desc,value->>'code' loop
  finished:=row->>'status' in ('Cerrado','No Aplica');
  if finished then closed_count:=closed_count+1; end if;
  bg:=case when finished then '#e7f5ed' else '#ffffff' end;
  current_status:=case when row->>'status'='En Validación' then 'En revisión' else row->>'status' end;
  previous_status:=case when row->>'before_status'='En Validación' then 'En revisión' else coalesce(row->>'before_status','Sin estado anterior') end;
  rows_html:=rows_html||'<tr><td bgcolor="'||bg||'" style="padding:12px;border:1px solid #dbe3ed;vertical-align:top;font-weight:bold;">'||pqr_private.mail_html_escape(row->>'code')||'</td>'
   ||'<td bgcolor="'||bg||'" style="padding:12px;border:1px solid #dbe3ed;vertical-align:top;">'||pqr_private.mail_html_escape(coalesce(row->>'pdv','No indicado'))||'</td>'
   ||'<td bgcolor="'||bg||'" style="padding:12px;border:1px solid #dbe3ed;vertical-align:top;">'||pqr_private.mail_html_escape(previous_status)||'</td>'
   ||'<td bgcolor="'||bg||'" style="padding:12px;border:1px solid #dbe3ed;vertical-align:top;"><strong>'||pqr_private.mail_html_escape(current_status)||'</strong>'
   ||case when finished then '<br><span style="color:#146c43;font-weight:bold;">FINALIZADO</span>' else '' end||'</td>'
   ||'<td bgcolor="'||bg||'" style="padding:12px;border:1px solid #dbe3ed;vertical-align:top;overflow-wrap:anywhere;">'||replace(pqr_private.mail_html_escape(coalesce(nullif(row->>'reply',''),'Sin respuesta registrada')),E'\n','<br>')||'</td></tr>';
 end loop;
 return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#203354;"><h2 style="color:#0d5cab;">Resumen diario · Portal PQR</h2>'
  ||'<p>Corte: '||to_char(cutoff at time zone 'America/Bogota','DD/MM/YYYY HH24:MI')||' · Bogotá</p>'
  ||'<p><strong>'||jsonb_array_length(items)||' tickets con novedades · '||closed_count||' finalizados</strong></p>'
  ||'<p>El estado anterior corresponde al inicio del periodo y el estado actual al último cambio incluido. Los tickets finalizados aparecen en verde.</p>'
  ||'<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;"><thead><tr bgcolor="#0d5cab" style="color:#ffffff;">'
  ||'<th align="left" style="padding:12px;border:1px solid #0d5cab;">Radicado</th><th align="left" style="padding:12px;border:1px solid #0d5cab;">ID de PDV</th><th align="left" style="padding:12px;border:1px solid #0d5cab;">Estado anterior</th><th align="left" style="padding:12px;border:1px solid #0d5cab;">Estado actual</th><th align="left" style="padding:12px;border:1px solid #0d5cab;">Respuesta</th>'
  ||'</tr></thead><tbody>'||rows_html||'</tbody></table><p><a href="https://portal-pqr.vercel.app/#consultar-ticket">Consultar mis tickets en Portal PQR</a></p></div>';
end $$;
revoke all on function pqr_private.mail_html_escape(text),pqr_private.mail_ticket_reply(jsonb),pqr_private.render_daily_digest(jsonb,timestamptz) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION pqr_private.capture_mail_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare recips text[]; copies text[]; v_email text:=lower(btrim(coalesce(new.data->>'requesterEmail','')));
begin
 if new.data->>'scope' is distinct from 'internal' or new.deleted_at is not null or not (select enabled from pqr_private.consolidated_mail_config where singleton) then return new; end if;
 if tg_op='INSERT' then
  if coalesce(current_setting('pqr.mail.group_pending',true),'')<>'1' then perform pqr_private.finalize_submission(new.id,jsonb_build_object('id',new.id)); end if;
  return new;
 end if;
 if new.status is distinct from old.status then
  if v_email<>'' then insert into pqr_private.mail_status_changes(ticket_id,recipient,code,pdv,before_status,status,reply) values(new.id,v_email,new.code,new.data->>'pdv',old.status,new.status,pqr_private.mail_ticket_reply(new.data)); end if;
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
end $function$;

create or replace function pqr_private.prepare_daily_digest(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare cfg pqr_private.consolidated_mail_config%rowtype; cutoff timestamptz; r record; total integer:=0;
begin
 select * into strict cfg from pqr_private.consolidated_mail_config where singleton for update;
 if not cfg.enabled then return 0; end if;
 cutoff:=((p_now at time zone 'America/Bogota')::date+time '17:00') at time zone 'America/Bogota';
 if cutoff>p_now then cutoff:=cutoff-interval '1 day'; end if;
 if cutoff<=coalesce(cfg.digest_cutoff,cfg.activated_at) then return 0; end if;
 for r in
  with period as (
   select c.*,first_value(c.before_status) over(partition by c.ticket_id,c.recipient order by c.changed_at,c.id) opening_status,
    coalesce(c.reply,pqr_private.mail_ticket_reply(t.data)) response_at_change
   from pqr_private.mail_status_changes c join public.pqr_tickets t on t.id=c.ticket_id
   where c.changed_at>=coalesce(cfg.digest_cutoff,cfg.activated_at) and c.changed_at<cutoff and t.deleted_at is null and t.data->>'scope'='internal'
  ), latest as (
   select distinct on(ticket_id,recipient) * from period order by ticket_id,recipient,changed_at desc,id desc
  )
  select recipient,count(*) n,jsonb_agg(jsonb_build_object('code',code,'pdv',pdv,'before_status',opening_status,'status',status,'reply',response_at_change) order by code) items,
   string_agg(code||' | PDV: '||coalesce(pdv,'No indicado')||' | '||coalesce(opening_status,'Sin dato')||' -> '||status||E'\n'||response_at_change,E'\n\n' order by code) lines
  from latest group by recipient
 loop
  insert into pqr_private.consolidated_mail_queue(logical_key,recipients,subject,body,body_html)
  values('digest:'||md5(r.recipient)||':'||cutoff::text,array[r.recipient],'Resumen de tus solicitudes · '||r.n||' tickets con novedades',
   E'Estos tickets cambiaron de estado durante el último corte:\n\n'||r.lines||E'\n\nhttps://portal-pqr.vercel.app/#consultar-ticket',
   pqr_private.render_daily_digest(r.items,cutoff))
  on conflict(logical_key) do nothing;
  total:=total+1;
 end loop;
 update pqr_private.consolidated_mail_config set digest_cutoff=cutoff where singleton;
 return total;
end $$;
CREATE OR REPLACE FUNCTION pqr_private.dispatch_consolidated_mail()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select net.http_post(url:=target,headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('type','message','attachments','[]'::jsonb,'pqr',jsonb_build_object('id',r.id,'to',array_to_string(array(select distinct address from unnest(r.recipients||r.copies) address),';'),'cc',array_to_string(r.copies,';'),'subject',r.subject,'html',coalesce(r.body_html,'<p>'||replace(replace(replace(replace(r.body,'&','&amp;'),'<','&lt;'),'>','&gt;'),E'\n','<br>')||'</p>'))),timeout_milliseconds:=10000) into request;
  update pqr_private.consolidated_mail_queue set state='submitted',http_id=request,submitted_at=now() where id=r.id;
  total:=total+1;
 end loop;
 return total;
end $function$;

notify pgrst,'reload schema';
commit;

