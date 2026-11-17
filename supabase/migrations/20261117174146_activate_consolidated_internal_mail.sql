begin;
set local lock_timeout='5s';
-- Preserve the original in-app notice while ending per-ticket email enqueueing.
do $guard$
declare definition text:=pg_get_functiondef('public.pqr_enqueue_mail_event()'::regprocedure);
 anchor text:='if new.deleted_at is not null then return new; end if;';
 guard text:=$body$
 if (select enabled from pqr_private.consolidated_mail_config where singleton) then
  if tg_op='INSERT' and new.code like 'PQR-%' then
   select id into v_profile from public.pqr_profiles where role='validador' and active order by created_at limit 1;
   if v_profile is not null then perform public.pqr_notice(v_profile,new.id,'Nueva PQR',new.code||' espera asignación'); end if;
  end if;
  return new;
 end if;
 $body$;
begin
 assert strpos(definition,anchor)>0,'Unexpected mail trigger';
 execute replace(definition,anchor,anchor||guard);
end $guard$;
-- No replay: old unsent events remain in the audit table as cancelled.
select cron.alter_job(jobid,active:=false) from cron.job where jobname='pqr-mailer-every-minute';
do $$ begin
 assert not exists(select 1 from public.pqr_mail_events where status='sending' and locked_at>now()-interval '2 minutes'),'Wait for old mailer to finish';
end $$;
update public.pqr_mail_events set status='cancelled',locked_at=null,last_error='Sustituido por correo consolidado; sin reenvío histórico'
 where status in ('pending','sending') and ticket_id in(select id from public.pqr_tickets where data->>'scope'='internal');
update pqr_private.consolidated_mail_config set enabled=true,activated_at=clock_timestamp(),digest_cutoff=clock_timestamp() where singleton;
select cron.schedule('pqr-consolidated-mail-every-minute','* * * * *','select pqr_private.dispatch_consolidated_mail();');
commit;
