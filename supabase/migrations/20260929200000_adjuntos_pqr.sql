-- Adjuntos privados de cada PQR. Solo Comercial puede agregar archivos a
-- sus propias solicitudes; las demás áreas consultan los casos que pueden ver.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pqr-adjuntos', 'pqr-adjuntos', false, 10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
    'image/heic', 'image/heif',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

create policy pqr_adjuntos_lectura on storage.objects
for select to authenticated
using (
  bucket_id = 'pqr-adjuntos'
  and exists (
    select 1 from public.pqr_tickets as ticket
    where ticket.id::text = (storage.foldername(name))[1]
      and (
        (select public.pqr_role()) = 'admin'
        or (
          ticket.deleted_at is null
          and (
            (select public.pqr_role()) in ('gerente', 'validador', 'redigitador')
            or (ticket.commercial_id = (select auth.uid()) and (select public.pqr_role()) = 'comercial')
          )
        )
      )
  )
);

create policy pqr_adjuntos_carga on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pqr-adjuntos'
  and (select public.pqr_role()) = 'comercial'
  and array_length(storage.foldername(name), 1) = 1
  and exists (
    select 1 from public.pqr_tickets as ticket
    where ticket.id::text = (storage.foldername(name))[1]
      and ticket.commercial_id = (select auth.uid())
      and ticket.deleted_at is null
  )
);
