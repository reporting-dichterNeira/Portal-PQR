begin;
lock table pqr_private.submission_groups in access exclusive mode;
create sequence pqr_private.submission_code_seq minvalue 1 maxvalue 999999 no cycle;
revoke all on sequence pqr_private.submission_code_seq from public,anon,authenticated,service_role;
alter table pqr_private.submission_groups add column legacy_code text unique;
alter table pqr_private.submission_groups alter column code set default ('ENV-'||lpad(nextval('pqr_private.submission_code_seq')::text,6,'0'));
-- Preserve aliases and notification keys: renumbering must never enqueue another receipt.
do $$
declare g record; short_code text;
begin
 for g in select request_id,code from pqr_private.submission_groups order by created_at,request_id loop
  short_code:='ENV-'||lpad(nextval('pqr_private.submission_code_seq')::text,6,'0');
  update pqr_private.submission_groups set legacy_code=g.code,code=short_code where request_id=g.request_id;
  update pqr_private.consolidated_mail_queue
  set logical_key=replace(logical_key,g.code,short_code),
      subject=case when state='pending' then replace(subject,g.code,short_code) else subject end,
      body=case when state='pending' then replace(body,g.code,short_code) else body end
  where logical_key in ('received:'||g.code,'team:'||g.code);
 end loop;
end $$;
create or replace function pqr_private.lookup_submission(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 if not pqr_private.internal_gate('lookup') then return jsonb_build_object('error','Demasiadas consultas. Espera un minuto.'); end if;
 if v_code !~ '^ENV-([0-9]{6}|[A-F0-9]{32})$' then return null; end if;
 select jsonb_build_object('batchCode',min(g.code),'tickets',coalesce(jsonb_agg(jsonb_build_object('code',t.code,'requestType',t.data->>'requestType','status',t.status,'createdAt',t.created_at,'updatedAt',t.updated_at,'closedAt',t.data->>'closedAt','pdv',t.data->>'pdv','requesterName',t.data->>'requesterName','description',t.data->>'description') order by t.created_at,t.code),'[]'::jsonb)) into result
 from pqr_private.submission_groups g join pqr_private.submission_members m on m.request_id=g.request_id join public.pqr_tickets t on t.id=m.ticket_id where (g.code=v_code or g.legacy_code=v_code) and t.deleted_at is null and t.data->>'scope'='internal';
 return result;
end $$;

commit;
