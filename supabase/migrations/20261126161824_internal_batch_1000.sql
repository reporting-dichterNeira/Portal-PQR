begin;
set local lock_timeout='5s';
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('pqr_private.submit_internal_batch(uuid,jsonb)'::regprocedure);
 assert strpos(definition,'n not between 1 and 200')>0,'Unexpected batch limit';
 assert strpos(definition,'then 400 else 200 end')>0,'Unexpected weighted rate limit';
 assert strpos(definition,'pg_column_size(p_data)>4194304')>0,'Unexpected payload limit';
 definition:=replace(definition,'n not between 1 and 200','n not between 1 and 1000');
 definition:=replace(definition,'Indica entre 1 y 200 PDV','Indica entre 1 y 1000 PDV');
 definition:=replace(definition,'then 400 else 200 end','then 2000 else 1000 end');
 definition:=replace(definition,'pg_column_size(p_data)>4194304','pg_column_size(p_data)>20971520');
 execute definition;
 definition:=pg_get_functiondef('pqr_private.finalize_submission(uuid,jsonb)'::regprocedure);
 assert strpos(definition,'cardinality(ids) not between 1 and 200')>0,'Unexpected consolidated receipt limit';
 definition:=replace(definition,'cardinality(ids) not between 1 and 200','cardinality(ids) not between 1 and 1000');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
