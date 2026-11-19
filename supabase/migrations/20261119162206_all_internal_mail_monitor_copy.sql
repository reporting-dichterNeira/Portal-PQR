begin;
set local lock_timeout='5s';
create function pqr_private.set_all_mail_copies() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select coalesce(array_agg(distinct lower(btrim(address)) order by lower(btrim(address))),'{}'::text[]) into new.copies
 from (select unnest(coalesce(new.copies,'{}'::text[])) address union all select email from pqr_private.internal_mail_copies) all_copies
 where nullif(btrim(address),'') is not null
 and not exists(select 1 from unnest(new.recipients) recipient where lower(btrim(recipient))=lower(btrim(address)));
 return new;
end $$;
revoke all on function pqr_private.set_all_mail_copies() from public,anon,authenticated,service_role;
create trigger pqr_all_internal_mail_copies before insert or update of recipients,copies on pqr_private.consolidated_mail_queue for each row execute function pqr_private.set_all_mail_copies();
update pqr_private.consolidated_mail_queue set copies=copies where state='pending';
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
  select net.http_post(url:=target,headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('type','message','attachments','[]'::jsonb,'pqr',jsonb_build_object('id',r.id,'to',array_to_string(array(select distinct address from unnest(r.recipients) address),';'),'cc',array_to_string(r.copies,';'),'subject',r.subject,'html',coalesce(r.body_html,'<p>'||replace(replace(replace(replace(r.body,'&','&amp;'),'<','&lt;'),'>','&gt;'),E'\n','<br>')||'</p>'))),timeout_milliseconds:=10000) into request;
  update pqr_private.consolidated_mail_queue set state='submitted',http_id=request,submitted_at=now() where id=r.id;
  total:=total+1;
 end loop;
 return total;
end $function$;

commit;

