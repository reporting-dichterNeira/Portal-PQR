begin;
set local lock_timeout='5s';
do $migration$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.pqr_reclassify(uuid,jsonb)'::regprocedure);
 anchor:=$a$(kind='EDC' or coalesce(t.data->>'auditOriginal','')<>'') and coalesce(t.data->>'auditOriginal','') !~ '^[0-9]{1,80}$'$a$;
 assert strpos(definition,anchor)>0,'Unexpected reclassification audit validation';
 execute replace(definition,anchor,$a$coalesce(t.data->>'auditOriginal','')<>'' and coalesce(t.data->>'auditOriginal','') !~ '^[0-9]{1,80}$'$a$);
end $migration$;
notify pgrst,'reload schema';
commit;
