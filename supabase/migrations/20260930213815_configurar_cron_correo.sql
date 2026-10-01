-- Requiere configurar pqr_mailer_token en Vault y el mismo PQR_MAILER_TOKEN
-- en Edge Function Secrets. Nunca guardar el valor de la clave en este archivo.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Solo el programador del servidor puede acceder a sus esquemas internos.
revoke all on schema cron, net from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'pqr_mailer_token' and length(decrypted_secret) >= 32
  ) then
    raise exception 'Configura primero pqr_mailer_token en Supabase Vault (mínimo 32 caracteres)';
  end if;
end;
$$;

select cron.schedule(
  'pqr-mailer-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://niwkegxwwwoahcbsoujy.supabase.co/functions/v1/pqr-mailer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pqr-mailer-token', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'pqr_mailer_token'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

commit;
