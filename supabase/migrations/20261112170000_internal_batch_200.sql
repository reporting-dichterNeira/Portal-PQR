begin;
do $migration$
declare definition text:=pg_get_functiondef('pqr_private.submit_internal_batch(uuid,jsonb)'::regprocedure);
begin
 assert strpos(definition,'n not between 1 and 50')>0,'Unexpected batch limit';
 assert strpos(definition,'then 100 else 50 end')>0,'Unexpected rate limit';
 assert strpos(definition,'pg_column_size(p_data)>1048576')>0,'Unexpected payload limit';
 definition:=replace(definition,'n not between 1 and 50','n not between 1 and 200');
 definition:=replace(definition,'Indica entre 1 y 50 PDV','Indica entre 1 y 200 PDV');
 definition:=replace(definition,'then 100 else 50 end','then 400 else 200 end');
 definition:=replace(definition,'pg_column_size(p_data)>1048576','pg_column_size(p_data)>4194304');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
