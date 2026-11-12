-- Preserve the existing transactional intake and its rate limits; add one validated field per row.
begin;
do $migration$
declare definition text:=pg_get_functiondef('pqr_private.submit_internal_batch(uuid,jsonb)'::regprocedure);
 old_keys text:=$old$array['pdv','auditOriginal','description']$old$;
 old_check text:=$old$if length(detail) not between 8 and 12000 then raise exception 'Fila % requiere un detalle de 8 a 12000 caracteres',row_number; end if;$old$;
 old_receipt text:=$old$if receipt ? 'error' then raise exception '%',receipt->>'error'; end if;$old$;
begin
 assert strpos(definition,old_keys)>0,'Unexpected row fields';
 assert strpos(definition,old_check)>0,'Unexpected row validation';
 assert strpos(definition,old_receipt)>0,'Unexpected receipt processing';
 definition:=replace(definition,old_keys,$new$array['pdv','auditOriginal','description','priority']$new$);
 definition:=replace(definition,old_check,old_check||$new$
   if item ? 'priority' and coalesce(item->>'priority','') not in ('1','2','3') then raise exception 'Fila % requiere prioridad 1, 2 o 3',row_number; end if;$new$);
 definition:=replace(definition,old_receipt,old_receipt||$new$
   if item ? 'priority' then
    update public.pqr_tickets set data=jsonb_set(data,'{priority}',to_jsonb(item->>'priority'),true) where id=(receipt->>'id')::uuid;
    if not found then raise exception 'No se pudo guardar la prioridad'; end if;
   end if;$new$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
