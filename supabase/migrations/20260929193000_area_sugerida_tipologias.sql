-- La sugerencia pertenece a la tipología, no al ticket. El área final del
-- dictamen permanece editable por el analista y se guarda en cada PQR.
alter table public.pqr_tips
  add column if not exists suggested_area text;

-- Esta migración también funciona si se aplica antes del archivo de carga
-- inicial de tipologías; ambos INSERT son idempotentes.
insert into public.pqr_tips(name) values
  ('Aprobada una auditoria incompleta'),
  ('Confunde SKU'),
  ('Disponibilidad'),
  ('Error al validar los precios'),
  ('Error en la clasificación del POC'),
  ('Error en la validación del 75% de llenado'),
  ('Extraños/Competencia'),
  ('Marcó mal la pregunta en activación'),
  ('No identificó una exhibición adicional'),
  ('No marcó la pregunta en activación'),
  ('No tiene material POP / comunicación'),
  ('No valida planimetría'),
  ('No validó que es una auditoría en PDV incorrecto'),
  ('Omisión de etiqueta'),
  ('Sin carga de adjuntos'),
  ('Error Nota "0" no actualiza a nota (según variación)'),
  ('Cambios de Lineamientos'),
  ('Error conteo en cajas'),
  ('Error de Manual'),
  ('Insumos')
on conflict (name) do nothing;

with suggestions(name, area) as (values
  ('Aprobada una auditoria incompleta', 'Validación'),
  ('Confunde SKU', 'OPS Campo/Validación'),
  ('Disponibilidad', 'OPS Campo/Validación'),
  ('Error al validar los precios', 'OPS Campo/Validación'),
  ('Error en la clasificación del POC', 'OPS Campo/Validación'),
  ('Error en la validación del 75% de llenado', 'OPS Campo/Validación'),
  ('Extraños/Competencia', 'OPS Campo/Validación'),
  ('Marcó mal la pregunta en activación', 'OPS Campo/Validación'),
  ('No identificó una exhibición adicional', 'OPS Campo/Validación'),
  ('No marcó la pregunta en activación', 'OPS Campo/Validación'),
  ('No tiene material POP / comunicación', 'OPS Campo/Validación'),
  ('No valida planimetría', 'OPS Campo/Validación'),
  ('No validó que es una auditoría en PDV incorrecto', 'OPS Campo/Validación'),
  ('Omisión de etiqueta', 'OPS Campo/Validación'),
  ('Sin carga de adjuntos', 'Validación'),
  ('Error Nota "0" no actualiza a nota (según variación)', 'IT'),
  ('Cambios de Lineamientos', 'Comercial'),
  ('Error conteo en cajas', 'OPS Campo/Validación'),
  ('Error de Manual', 'Comercial'),
  ('Insumos', 'Comercial')
)
update public.pqr_tips as tip
set suggested_area = suggestions.area
from suggestions
where tip.name = suggestions.name and tip.suggested_area is null;

create or replace function public.pqr_admin_tip_area(p_name text, p_area text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.pqr_role() is distinct from 'admin' then
    raise exception 'Solo Administración';
  end if;
  if length(trim(coalesce(p_area, ''))) > 100 then
    raise exception 'El área sugerida es demasiado larga';
  end if;
  update public.pqr_tips
  set suggested_area = nullif(trim(p_area), '')
  where name = p_name;
  if not found then raise exception 'Tipología no encontrada'; end if;
end $$;
revoke all on function public.pqr_admin_tip_area(text,text) from public, anon;
grant execute on function public.pqr_admin_tip_area(text,text) to authenticated;
