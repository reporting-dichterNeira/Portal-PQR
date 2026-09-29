-- Matriz de tipificaciones y adjudicación. Se conservan las tipologías existentes
-- para no modificar los dictámenes históricos.
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
