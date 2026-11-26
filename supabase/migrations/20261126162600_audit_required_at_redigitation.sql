begin;
set local lock_timeout='5s';
do $migration$
declare definition text; anchor text;
begin
 definition:=replace(pg_get_functiondef('public.pqr_action_legacy(text,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 anchor:=$a$v_result not in ('no','yes','redigit') or v_audit !~ '^[0-9]+$'$a$;
 assert strpos(definition,anchor)>0,'Unexpected dictate validation';
 definition:=replace(definition,anchor,$a$v_result not in ('no','yes','redigit') or (v_audit='' and v_result<>'redigit') or (v_audit<>'' and v_audit !~ '^[0-9]{1,80}$')$a$);
 anchor:=$a$    v_audit := trim(coalesce(p_data->>'audit',''));$a$;
 assert strpos(definition,anchor)>0,'Unexpected redigitation validation';
 definition:=replace(definition,anchor,$a$    v_detail:=btrim(coalesce(nullif(v_data->>'auditOriginal',''),p_data->>'auditOriginal',''));
    if v_detail !~ '^[0-9]{1,80}$' then raise exception 'Completa el ID de auditoría original antes de resolver la redigitación'; end if;
    if nullif(v_data->>'auditOriginal','') is null then
      v_data:=public.pqr_event(v_data,v_actor.name,'Auditoría original completada por Redigitación','ID de auditoría: '||v_detail);
      v_data:=v_data||jsonb_build_object('auditOriginal',v_detail);
    end if;
$a$||anchor);
 execute definition;
 definition:=pg_get_functiondef('pqr_private.analyst_batch(text,jsonb,jsonb)'::regprocedure);
 anchor:=$a$if btrim(coalesce(item->>'auditOriginal','')) !~ '^[0-9]{1,80}$' then$a$;
 assert strpos(definition,anchor)>0,'Unexpected batch validation';
 definition:=replace(definition,anchor,$a$if (btrim(coalesce(item->>'auditOriginal',''))='' and p_data->>'decision'<>'redigit') or (btrim(coalesce(item->>'auditOriginal',''))<>'' and btrim(item->>'auditOriginal') !~ '^[0-9]{1,80}$') then$a$);
 definition:=replace(definition,$a$'auditOriginal',btrim(item->>'auditOriginal')$a$,$a$'auditOriginal',btrim(coalesce(item->>'auditOriginal',''))$a$);
 execute definition;
 definition:=pg_get_functiondef('pqr_private.complete_field(uuid,jsonb)'::regprocedure);
 anchor:=$a$ if audit !~ '^[0-9]{1,80}$'$a$;
 assert strpos(definition,anchor)>0,'Unexpected field validation';
 definition:=replace(definition,anchor,$a$ if btrim(coalesce(nullif(t.data->>'auditOriginal',''),input->>'auditOriginal','')) !~ '^[0-9]{1,80}$' then raise exception 'Completa el ID de auditoría original antes de resolver la redigitación'; end if;
$a$||anchor);
 anchor:=$a$'audit',audit,'redigitNotes',notes$a$;
 assert strpos(definition,anchor)>0,'Unexpected field data';
 definition:=replace(definition,anchor,$a$'auditOriginal',btrim(coalesce(nullif(t.data->>'auditOriginal',''),input->>'auditOriginal','')),'audit',audit,'redigitNotes',notes$a$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
