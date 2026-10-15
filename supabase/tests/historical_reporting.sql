-- Fully rolled back; no operational tickets, notifications, accounts or mail created.
begin;
insert into public.pqr_historical_cases(id,source_hash,source_sheet,source_row,source_data,data)
values('cccccccc-cccc-4ccc-accc-cccccccccccc',repeat('a',64),'fixture',2,'{}','{"id":"cccccccc-cccc-4ccc-accc-cccccccccccc","origin":"historical","auditOriginal":"98765432101234567890"}');
do $$
declare actor uuid; denied boolean; stamp timestamptz; changed integer; role_name text; versions integer;
begin
 assert not has_table_privilege('anon','public.pqr_historical_cases','select');
 assert not has_table_privilege('anon','public.pqr_case_overrides','select');
 assert not has_column_privilege('authenticated','public.pqr_case_overrides','history','update');
 assert not has_column_privilege('authenticated','public.pqr_case_overrides','updated_by','insert');
 assert not has_function_privilege('authenticated','public.pqr_databricks_targets(text,text[])','execute');
 foreach role_name in array array['gerente','admin'] loop
   select id into actor from public.pqr_profiles where role=role_name and active order by created_at limit 1;
   assert actor is not null, 'Se requiere una cuenta activa de Gerencia y Administración';
   perform set_config('request.jwt.claim.sub',actor::text,true);
   execute 'set local role authenticated';
   assert exists(select 1 from public.pqr_historical_cases where source_sheet='fixture');
   select coalesce(max(jsonb_array_length(history)),0) into versions from public.pqr_case_overrides where case_id='cccccccc-cccc-4ccc-accc-cccccccccccc';
   if role_name='gerente' then
     insert into public.pqr_case_overrides(case_id,source,patch,reason) values('cccccccc-cccc-4ccc-accc-cccccccccccc','historical','{"client":"Estudio prueba","auditOriginal":"12345"}','Prueba transaccional');
   else
     update public.pqr_case_overrides set patch='{"client":"Estudio actualizado"}',reason='Segunda revisión' where case_id='cccccccc-cccc-4ccc-accc-cccccccccccc';
   end if;
   assert (select updated_by=actor and jsonb_array_length(history)=versions+1 from public.pqr_case_overrides where case_id='cccccccc-cccc-4ccc-accc-cccccccccccc');
   select updated_at into stamp from public.pqr_case_overrides where case_id='cccccccc-cccc-4ccc-accc-cccccccccccc';
   update public.pqr_case_overrides set reason='Comprobación de concurrencia' where case_id='cccccccc-cccc-4ccc-accc-cccccccccccc' and updated_at=stamp;
   update public.pqr_case_overrides set reason='No debe sobrescribir' where case_id='cccccccc-cccc-4ccc-accc-cccccccccccc' and updated_at=stamp;
   get diagnostics changed=row_count; assert changed=0, 'Concurrencia optimista';
   denied=false;begin update public.pqr_case_overrides set patch='{"status":"Cerrado"}' where case_id='cccccccc-cccc-4ccc-accc-cccccccccccc';exception when others then denied=true;end;assert denied,'No cambia el flujo';
   denied=false;begin update public.pqr_historical_cases set data='{}' where source_sheet='fixture';exception when others then denied=true;end;assert denied,'Fuente inmutable';
   execute 'reset role';
 end loop;
 foreach role_name in array array['comercial','validador','redigitador'] loop
   select id into actor from public.pqr_profiles where role=role_name and active order by created_at limit 1;
   assert actor is not null;
   perform set_config('request.jwt.claim.sub',actor::text,true);execute 'set local role authenticated';
   assert not exists(select 1 from public.pqr_historical_cases);
   assert not exists(select 1 from public.pqr_case_overrides);
   denied=false;begin insert into public.pqr_case_overrides(case_id,source,patch,reason) values('dddddddd-dddd-4ddd-addd-dddddddddddd','historical','{}','No autorizado');exception when others then denied=true;end;assert denied;
   execute 'reset role';
 end loop;
 execute 'set local role service_role';
 assert exists(select 1 from public.pqr_databricks_targets('',array['98765432101234567890']));
 execute 'reset role';
end $$;
rollback;
select 'OK: histórico privado, correcciones auditadas, fuentes inmutables y sin cambios operativos.' as resultado;
