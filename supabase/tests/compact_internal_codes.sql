-- No business data, notifications, or permissions survive this test.
begin;
create temporary sequence compact_test_seq start 9999;
do $$ begin
 execute replace(pg_get_functiondef('pqr_private.new_internal_code(text)'::regprocedure),
  'pqr_private.internal_code_seq','pg_temp.compact_test_seq');
end $$;
do $$
declare kind text; codes text[]:='{}'; code text; n integer; target_id uuid; legacy text; lookup jsonb;
begin
 assert not has_table_privilege('anon','pqr_private.internal_code_aliases','select');
 assert not has_table_privilege('authenticated','pqr_private.internal_code_aliases','select');
 assert not has_function_privilege('anon','pqr_private.new_internal_code(text)','execute');
 assert not has_function_privilege('authenticated','pqr_private.new_internal_code(text)','execute');
 foreach kind in array array['PQR','RDG','EDC'] loop
  for n in 1..100 loop
   code:=pqr_private.new_internal_code(kind);
   assert code ~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}$';
   assert split_part(code,'-',4)::bigint=9998+cardinality(codes)+1,'El consecutivo es general, sin truncar 10000';
   assert not code=any(codes); codes:=array_append(codes,code);
  end loop;
 end loop;
 select t.id,t.code into target_id,code from public.pqr_tickets t where data->>'scope'='internal' and deleted_at is null limit 1;
 if target_id is not null then
  legacy:='PQR-INT-2026-999999-0123456789ABCDEF';
  insert into pqr_private.internal_code_aliases(old_code,ticket_id) values(legacy,target_id);
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
  execute 'set local role anon';
  lookup:=public.pqr_lookup_internal(' '||lower(legacy)||' ');
  assert lookup->>'code'=code and (select count(*) from jsonb_object_keys(lookup))=6;
  assert public.pqr_lookup_internal(code)=lookup;
  assert public.pqr_lookup_internal(left(code,length(code)-1)) is null;
  execute 'reset role';
  update public.pqr_tickets set deleted_at=now() where pqr_tickets.id=target_id;
  execute 'set local role anon';
  assert public.pqr_lookup_internal(legacy) is null and public.pqr_lookup_internal(code) is null;
  execute 'reset role';
  update pqr_private.internal_code_aliases set ticket_id=(select t.id from public.pqr_tickets t
   where t.data->>'scope' is distinct from 'internal' and t.deleted_at is null limit 1) where old_code=legacy;
  execute 'set local role anon';
  assert public.pqr_lookup_internal(legacy) is null and public.pqr_lookup_internal(code) is null;
  execute 'reset role';
 end if;
end $$;
select 'COMPACT_INTERNAL_CODES_AND_LEGACY_ALIASES_OK' as verification;
rollback;
