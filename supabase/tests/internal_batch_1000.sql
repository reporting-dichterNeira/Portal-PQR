begin;
-- Rollback-only test: do not consume production serials or send notifications.
create or replace function pqr_private.new_internal_code(p_kind text) returns text
language plpgsql set search_path='' as $$ begin return p_kind||'-TEST-'||gen_random_uuid()::text; end $$;
alter table pqr_private.submission_groups alter column code set default ('ENV-TEST-'||gen_random_uuid()::text);
do $test$
declare payload jsonb; result jsonb; again jsonb; request uuid; kind text; baseline bigint; queues bigint;
begin
 select count(*) into baseline from public.pqr_tickets;
 select count(*) into queues from pqr_private.consolidated_mail_queue;
 foreach kind in array array['PQR','RDG','EDC'] loop
  request:=gen_random_uuid();
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
  delete from pqr_private.internal_rate_limits where key like 'internal-batch:global:%';
  select jsonb_build_object('requesterName','Prueba rollback 1000','requesterEmail','qa@example.invalid','kind',kind,'client','KO tradicional','country','Guatemala','rows',jsonb_agg(jsonb_build_object('pdv',lpad(g::text,8,'0'),'description','Detalle de prueba individual '||g,'priority',(g%2)::text,'auditOriginal',(99000000+g)::text) order by g)) into payload from generate_series(1,1000) g;
  result:=public.pqr_submit_internal_batch(request,payload);
  assert not result ? 'error',result::text;
  assert jsonb_array_length(result->'tickets')=1000;
  assert result->>'batchCode' like 'ENV-TEST-%';
  assert (select count(*)=1000 from pqr_private.submission_members where request_id=request);
  assert (select count(distinct t.code)=1000 from public.pqr_tickets t join pqr_private.submission_members m on m.ticket_id=t.id where m.request_id=request);
  assert (select count(*)=2 from pqr_private.consolidated_mail_queue where logical_key in ('received:'||(result->>'batchCode'),'team:'||(result->>'batchCode'))),'Only two grouped emails per 1000 tickets';
  again:=public.pqr_submit_internal_batch(request,payload);
  assert again=result,'Retry must reuse same tickets and consolidated code';
  result:=public.pqr_submit_internal_batch(gen_random_uuid(),jsonb_set(payload,'{rows}',(payload->'rows')||jsonb_build_array(jsonb_build_object('pdv','99999999','description','Detalle fila adicional','priority','0','auditOriginal','99999999'))));
  assert result ? 'error' and result->>'error' like '%1000%','1001 rows must be rejected';
 end loop;
 assert (select count(*)=baseline+3000 from public.pqr_tickets);
 assert (select count(*)=queues+6 from pqr_private.consolidated_mail_queue);
end $test$;
rollback;
select '1000 PDV en PQR/RDG/EDC, comprobante agrupado, dos correos por carga, reintento sin duplicados y rechazo de 1001: OK; prueba revertida' as result;
