-- La función privada pqr-admin necesita administrar perfiles con service_role.
-- anon y authenticated conservan únicamente los permisos restringidos por RLS.
grant select, insert, update on public.pqr_profiles to service_role;
