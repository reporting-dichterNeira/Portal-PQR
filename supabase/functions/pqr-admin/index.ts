import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const allowedOrigins = new Set([
  'https://reporting-dichterneira.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);

function reply(origin: string, body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
      'access-control-allow-methods': 'POST, OPTIONS',
      vary: 'Origin',
    },
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? '';
  if (!allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 });
  if (request.method === 'OPTIONS') return reply(origin, {});
  if (request.method !== 'POST') return reply(origin, { error: 'Método no permitido' }, 405);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return reply(origin, { error: 'Sesión requerida' }, 401);
  const { data: identity, error: authError } = await admin.auth.getUser(token);
  if (authError || !identity.user) return reply(origin, { error: 'Sesión inválida' }, 401);
  const { data: actor } = await admin.from('pqr_profiles').select('role, active').eq('id', identity.user.id).single();
  if (actor?.role !== 'admin' || actor?.active !== true) return reply(origin, { error: 'Solo Administración' }, 403);

  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return reply(origin, { error: 'Solicitud inválida' }, 400); }
  const action = String(input.action ?? '');
  const username = String(input.username ?? '').trim().toLowerCase();
  const name = String(input.name ?? '').trim();
  const role = String(input.role ?? '');
  const password = String(input.password ?? '');
  const validUsername = /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username);
  const email = `${username}@portal-pqr.invalid`;

  if (action === 'create') {
    if (!validUsername || name.length < 3 || !['admin', 'gerente', 'validador', 'redigitador', 'comercial'].includes(role)
      || password.length < 12) return reply(origin, { error: 'Usuario, nombre, rol o contraseña inválidos' }, 400);
    if (['validador', 'redigitador'].includes(role)) {
      const { data: existing } = await admin.from('pqr_profiles').select('id').eq('role', role).limit(1);
      if (existing?.length) return reply(origin, { error: 'Ya existe la cuenta compartida de esta área' }, 409);
    }
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) return reply(origin, { error: error?.message ?? 'No se pudo crear la cuenta' }, 400);
    const { error: profileError } = await admin.from('pqr_profiles').insert({
      id: created.user.id, username, name, role, active: true,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return reply(origin, { error: profileError.message }, 400);
    }
    return reply(origin, { id: created.user.id, username, name, role });
  }

  const targetId = String(input.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return reply(origin, { error: 'Cuenta inválida' }, 400);
  const { data: target } = await admin.from('pqr_profiles').select('id, role, username').eq('id', targetId).single();
  if (!target) return reply(origin, { error: 'Cuenta no encontrada' }, 404);

  if (action === 'rename') {
    if (!validUsername) return reply(origin, { error: 'Usuario inválido' }, 400);
    const { error: changeError } = await admin.auth.admin.updateUserById(targetId, { email, email_confirm: true });
    if (changeError) return reply(origin, { error: changeError.message }, 400);
    const { error: profileError } = await admin.from('pqr_profiles').update({ username }).eq('id', targetId);
    if (profileError) {
      await admin.auth.admin.updateUserById(targetId, { email: `${target.username}@portal-pqr.invalid`, email_confirm: true });
      return reply(origin, { error: profileError.message }, 400);
    }
    return reply(origin, { ok: true });
  }
  if (action === 'set_active') {
    if (targetId === identity.user.id && input.active === false) return reply(origin, { error: 'No puedes desactivar tu cuenta' }, 400);
    const { error } = await admin.from('pqr_profiles').update({ active: input.active === true }).eq('id', targetId);
    return reply(origin, error ? { error: error.message } : { ok: true }, error ? 400 : 200);
  }
  if (action === 'set_password') {
    if (password.length < 12) return reply(origin, { error: 'La contraseña debe tener 12 caracteres o más' }, 400);
    const { error } = await admin.auth.admin.updateUserById(targetId, { password });
    return reply(origin, error ? { error: error.message } : { ok: true }, error ? 400 : 200);
  }
  return reply(origin, { error: 'Acción desconocida' }, 400);
});
