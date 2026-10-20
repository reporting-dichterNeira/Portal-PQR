-- Validate new public internal submissions; retain old tickets and idempotent receipts.
begin;
set local lock_timeout='5s';
do $migration$
declare
 definition text:=pg_get_functiondef('pqr_private.submit_internal(uuid,jsonb)'::regprocedure);
 old_validation text:=$old$if length(email)>254 or (email<>'' and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Correo de contacto inválido'; end if;$old$;
 new_validation text:=$new$if email='' then raise exception 'El correo de contacto es obligatorio'; end if;
  if length(email)>254 or email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Correo de contacto inválido'; end if;$new$;
begin
 if strpos(definition,old_validation)=0 then raise exception 'Unexpected internal intake validation; no change applied'; end if;
 execute replace(definition,old_validation,new_validation);
end $migration$;
commit;
