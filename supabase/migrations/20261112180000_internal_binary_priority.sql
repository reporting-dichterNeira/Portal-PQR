begin;
do $migration$
declare definition text:=pg_get_functiondef('pqr_private.submit_internal_batch(uuid,jsonb)'::regprocedure);
 old text:=$old$if item ? 'priority' and coalesce(item->>'priority','') not in ('1','2','3') then raise exception 'Fila % requiere prioridad 1, 2 o 3',row_number; end if;$old$;
 new text:=$new$if item ? 'priority' and coalesce(item->>'priority','') not in ('0','1') then raise exception 'Fila % requiere prioridad 1 o 0',row_number; end if;$new$;
begin
 assert strpos(definition,old)>0,'Unexpected priority validation';
 execute replace(definition,old,new);
end $migration$;
notify pgrst,'reload schema';
commit;
