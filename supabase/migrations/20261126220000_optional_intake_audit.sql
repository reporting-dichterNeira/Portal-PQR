begin;
set local lock_timeout='5s';
do $migration$
declare definition text; anchor text; updated text;
begin
 definition:=pg_get_functiondef('pqr_private.submit_internal_core(uuid,jsonb)'::regprocedure);
 anchor:=$a$(kind<>'PQR' and audit !~ '^[0-9]{1,80}$') or (audit<>'' and audit !~ '^[0-9]{1,80}$')$a$;
 assert strpos(definition,anchor)>0,'Unexpected single intake audit validation';
 execute replace(definition,anchor,$a$audit<>'' and audit !~ '^[0-9]{1,80}$'$a$);
 definition:=pg_get_functiondef('pqr_private.submit_internal_batch(uuid,jsonb)'::regprocedure);
 anchor:=$a$(kind<>'PQR' or audit<>'') and audit !~ '^[0-9]{1,80}$'$a$;
 assert strpos(definition,anchor)>0,'Unexpected batch intake audit validation';
 execute replace(definition,anchor,$a$audit<>'' and audit !~ '^[0-9]{1,80}$'$a$);
 definition:=pg_get_functiondef('public.pqr_create_special(text,jsonb)'::regprocedure);
 anchor:=$a$v_audit !~ '^[0-9]+$' or length(v_audit) > 80$a$;
 assert strpos(definition,anchor)>0,'Unexpected commercial intake audit validation';
 execute replace(definition,anchor,$a$v_audit<>'' and v_audit !~ '^[0-9]{1,80}$'$a$);
 -- Keep the existing edition permissions, assignment and closing behavior.
 definition:=pg_get_functiondef('public.pqr_complete_edit(uuid,boolean,text)'::regprocedure);
 anchor:=$a$v_data := v_row.data;$a$;
 assert strpos(definition,anchor)>0,'Unexpected edition data';
 updated:=replace(definition,'p_comment text)','p_comment text, p_audit_original text)');
 assert updated<>definition,'Unexpected edition signature';
 updated:=replace(updated,anchor,anchor||$a$
  v_data:=v_data||jsonb_build_object('auditOriginal',btrim(coalesce(nullif(v_data->>'auditOriginal',''),p_audit_original,'')));
  if v_data->>'auditOriginal' !~ '^[0-9]{1,80}$' then raise exception 'Completa el ID de auditoría original antes de resolver la edición'; end if;
$a$);
 execute updated;
 -- The old internal entry point must also reject closure without an audit.
 execute replace(definition,anchor,anchor||$a$
  if coalesce(v_data->>'auditOriginal','') !~ '^[0-9]{1,80}$' then raise exception 'Completa el ID de auditoría original antes de resolver la edición'; end if;
$a$);
 definition:=pg_get_functiondef('public.pqr_action(text,uuid,jsonb)'::regprocedure);
 anchor:=$a$public.pqr_complete_edit(p_ticket,case p_data->>'edited' when 'yes' then true when 'no' then false else null end,p_data->>'comment')$a$;
 assert strpos(definition,anchor)>0,'Unexpected edition dispatch';
 execute replace(definition,anchor,$a$public.pqr_complete_edit(p_ticket,case p_data->>'edited' when 'yes' then true when 'no' then false else null end,p_data->>'comment',p_data->>'auditOriginal')$a$);
end $migration$;
revoke all on function public.pqr_complete_edit(uuid,boolean,text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
