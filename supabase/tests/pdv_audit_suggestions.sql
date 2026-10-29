-- Roll back cache fixtures and tickets; no real notices or mail can be delivered.
begin;
do $$
declare actor uuid; outsider uuid; ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 keys text[]:='{}'; entries jsonb:='[]'; answer jsonb; item jsonb; n integer; country text; study text;
 stamp text:=to_char(now() at time zone 'America/Bogota','YYYY-MM-DD HH24:MI:SS');
 original_digest text; fixture_digest text; rejected boolean;
begin
 select id into actor from public.pqr_profiles where active and role='validador' limit 1;
 select id into outsider from public.pqr_profiles where active and role='gerente' limit 1;
 assert actor is not null and outsider is not null;
 assert not has_table_privilege('authenticated','pqr_private.pdv_audit_suggestions','select');
 assert not has_table_privilege('anon','pqr_private.pdv_audit_suggestions','select');
 assert not has_function_privilege('anon','public.pqr_suggest_audits(uuid[])','execute');
 assert not has_function_privilege('authenticated','public.pqr_publish_pdv_suggestions(jsonb,uuid)','execute');
 assert not has_function_privilege('authenticated','public.pqr_databricks_pdv_targets(text,text[])','execute');
 assert pqr_private.pdv_country(' Perú ')='peru';assert pqr_private.pdv_study('KO_TRAD_GT')='ko tradicional';
 assert pqr_private.pdv_study('ko_mod-HN')='ko moderno';assert pqr_private.pdv_study('lindley')='lindley';
 select md5(string_agg(to_jsonb(t)::text,'|' order by id)) into original_digest from public.pqr_tickets t;
 for n in 1..3 loop
  country:=case when n=2 then 'guatemala' else 'honduras' end;study:=case when n=3 then 'ko moderno' else 'ko tradicional' end;
  keys:=array_append(keys,md5('990000000001|'||country||'|'||study));
  insert into public.pqr_tickets(id,code,status,created_at,updated_at,data) values(ids[n],'PQR-INT-2099-'||(980000000+n),'Radicado',now(),now(),
   jsonb_build_object('id',ids[n],'code','PQR-INT-2099-'||(980000000+n),'scope','internal','publicInternal',true,'requestType','PQR',
   'requesterName','QA sugerencias rollback','requesterEmail','qa@example.invalid','pdv','990000000001','country',country,'client',study,'description','Prueba de aislamiento por PDV y origen','status','Radicado','timeline','[]'::jsonb));
  entries:=entries||jsonb_build_array(jsonb_build_object('key',keys[n],'pdv','990000000001','country',country,'study',study,
   'auditId',(1000+n)::text,'auditDate',stamp,'ola','OCTUBRE 2026','survey',case when n=3 then 'ko_mod-HN' else 'ko_trad-GT' end));
 end loop;
 select md5(string_agg(to_jsonb(t)::text,'|' order by id)) into fixture_digest from public.pqr_tickets t where id=any(ids);
 execute 'set local role service_role';
 assert (select count(*) from public.pqr_databricks_pdv_targets('',keys))=3;
 assert public.pqr_publish_pdv_suggestions(entries,gen_random_uuid())=3;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 answer:=public.pqr_suggest_audits(ids);
 assert jsonb_array_length(answer)=3;
 for n in 1..3 loop
  select x into item from jsonb_array_elements(answer) x where x->>'ticketId'=ids[n]::text;
  assert item->>'auditId'=(1000+n)::text and item->>'status'='found';
  assert not item ?| array['Validador','nombre_usuario','requesterEmail','description','response'];
 end loop;
 execute 'reset role';
 -- An out-of-window publish or wrong tuple cannot overwrite any good suggestion.
 rejected:=false;begin
  execute 'set local role service_role';perform public.pqr_publish_pdv_suggestions(jsonb_set(entries,'{0,country}','"peru"'),gen_random_uuid());
 exception when raise_exception then rejected:=true;end;execute 'reset role';assert rejected;
 rejected:=false;begin
  execute 'set local role service_role';perform public.pqr_publish_pdv_suggestions(jsonb_set(entries,'{0,auditDate}',to_jsonb(to_char((now() at time zone 'America/Bogota')-interval '61 days','YYYY-MM-DD HH24:MI:SS'))),gen_random_uuid());
 exception when raise_exception then rejected:=true;end;execute 'reset role';assert rejected;
 assert (select audit_id='1001' from pqr_private.pdv_audit_suggestions where target_key=keys[1]);
 update pqr_private.pdv_audit_suggestions set audit_date=to_char((now() at time zone 'America/Bogota')-interval '61 days','YYYY-MM-DD') where target_key=keys[1];
 execute 'set local role authenticated';answer:=public.pqr_suggest_audits(array[ids[1]]);assert answer->0->>'status'='expired';execute 'reset role';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 rejected:=false;begin execute 'set local role authenticated';perform public.pqr_suggest_audits(ids);exception when raise_exception then rejected:=true;end;execute 'reset role';assert rejected;
 assert fixture_digest=(select md5(string_agg(to_jsonb(t)::text,'|' order by id)) from public.pqr_tickets t where id=any(ids));
 assert original_digest=(select md5(string_agg(to_jsonb(t)::text,'|' order by id)) from public.pqr_tickets t where not(id=any(ids)));
end $$;
select 'PDV_SUGGESTIONS_SCOPE_PRIVACY_AND_60_DAY_WINDOW_OK' as verification;
rollback;
