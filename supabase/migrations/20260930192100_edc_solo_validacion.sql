-- Las ediciones (EDC) solo pueden asignarse a Validación, nunca a Campo.
-- No altera la selección Campo/Validación de PQR ni RDG.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pqr_edc_solo_validacion'
      and conrelid = 'public.pqr_tickets'::regclass
  ) then
    alter table public.pqr_tickets
      add constraint pqr_edc_solo_validacion
      check (code not like 'EDC-%' or data->>'redigitType' is null or data->>'redigitType' = 'Validación');
  end if;
end $$;
