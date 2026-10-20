import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const sender = 'reporting.dichterneira@gmail.com';
const portalUrl = 'https://reporting-dichterneira.github.io/Portal-PQR/';
const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const mailerToken = Deno.env.get('PQR_MAILER_TOKEN') ?? '';
const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';

const db = projectUrl && serviceKey ? createClient(projectUrl, serviceKey, { auth: { persistSession: false } }) : null;
type OutgoingMail = { from: string; bcc: { address: string }[]; subject: string; text: string; messageId: string };
const utf8Base64 = (value: string) => btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(''));
function encodedSubject(value: string) {
  const parts: string[] = []; let part = '';
  for (const character of value) {
    if (new TextEncoder().encode(part + character).length > 42) { parts.push(part); part = ''; }
    part += character;
  }
  if (part) parts.push(part);
  return parts.map(item => `=?UTF-8?B?${utf8Base64(item)}?=`).join('\r\n ');
}

// Native Deno TLS avoids the Node SMTP compatibility hang in the hosted runtime.
// Fixed Gmail destination, certificate validation enabled, no attachments or protocol logging.
async function gmailSmtp(mail?: OutgoingMail) {
  let connection: Deno.TlsConn | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const session = async () => {
    const connected = await Deno.connectTls({ hostname: 'smtp.gmail.com', port: 465 });
    if (expired) { connected.close(); throw new Error('SMTP_TIMEOUT'); }
    connection = connected;
    let pending = '';
    const write = async (value: string) => {
      const bytes = new TextEncoder().encode(value); let offset = 0;
      while (offset < bytes.length) {
        const written = await connected.write(bytes.subarray(offset));
        if (!written) throw new Error('SMTP_WRITE_FAILED');
        offset += written;
      }
    };
    const reply = async (expected: number[], stage: string) => {
      let size = 0; let firstCode: number | undefined;
      while (true) {
        while (pending.includes('\r\n')) {
          const end = pending.indexOf('\r\n'); const line = pending.slice(0, end); pending = pending.slice(end + 2);
          const match = /^(\d{3})([ -])/.exec(line);
          if (!match) throw new Error(`SMTP_${stage}_PROTOCOL`);
          const code = Number(match[1]);
          if (firstCode !== undefined && firstCode !== code) throw new Error(`SMTP_${stage}_PROTOCOL`);
          firstCode = code;
          if (match[2] === ' ') {
            if (!expected.includes(code)) throw new Error(`SMTP_${stage}_${code}`);
            return;
          }
        }
        const buffer = new Uint8Array(4096); const count = await connected.read(buffer);
        if (!count) throw new Error(`SMTP_${stage}_DISCONNECTED`);
        size += count; if (size > 65536) throw new Error('SMTP_RESPONSE_TOO_LARGE');
        pending += new TextDecoder().decode(buffer.subarray(0, count));
      }
    };
    const command = async (value: string, expected: number[], stage: string) => { await write(value + '\r\n'); await reply(expected, stage); };
    await reply([220], 'GREETING');
    await command('EHLO reporting-dichterneira.github.io', [250], 'EHLO');
    await command('AUTH LOGIN', [334], 'AUTH');
    await command(btoa(sender), [334], 'AUTH');
    await command(btoa(gmailPassword.replace(/\s/g, '')), [235], 'AUTH');
    if (mail) {
      if (mail.bcc.length !== 1 || !mailbox(mail.bcc[0].address) || !/^<pqr-[a-z0-9-]+@portal-pqr\.invalid>$/i.test(mail.messageId)) throw new Error('SMTP_INVALID_ENVELOPE');
      await command(`MAIL FROM:<${sender}>`, [250], 'FROM');
      await command(`RCPT TO:<${mail.bcc[0].address}>`, [250, 251], 'RECIPIENT');
      await command('DATA', [354], 'DATA');
      const body = utf8Base64(mail.text).match(/.{1,76}/g)?.join('\r\n') || '';
      await write(`From: Portal PQR <${sender}>\r\nTo: undisclosed-recipients:;\r\nSubject: ${encodedSubject(mail.subject)}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: ${mail.messageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n.\r\n`);
      await reply([250], 'ACCEPT');
    }
    // Close in finally; never turn a successful DATA acceptance into a retry on QUIT.
  };
  try {
    await Promise.race([session(), new Promise((_, reject) => { timer = setTimeout(() => { expired = true; try { connection?.close(); } catch { /* already closed */ } reject(new Error('SMTP_TIMEOUT')); }, 25000); })]);
  } finally {
    expired = true;
    if (timer) clearTimeout(timer);
    try { connection?.close(); } catch { /* already closed after timeout */ }
  }
}
const transport = { verify: () => gmailSmtp(), sendMail: (mail: OutgoingMail) => gmailSmtp(mail) };

type MailEvent = {
  id: string;
  ticket_id: string;
  recipient_profile_id: string | null;
  recipient_email?: string | null;
  event_type: 'new_pqr' | 'new_redigit' | 'received' | 'closed';
  status: 'pending' | 'sending' | 'sent';
  locked_at: string | null;
  attempts: number;
};

function message(event: MailEvent, ticket: { code: string; status: string; data: Record<string, unknown> }) {
  const { code, data } = ticket;
  const internal = data.scope === 'internal';
  const requester = internal && !!event.recipient_email && ['received', 'closed'].includes(event.event_type);
  const type = code.startsWith('EDC-') ? 'edición' : 'redigitación';
  const subject = event.event_type === 'received' ? `Recibimos tu solicitud interna · ${code}`
    : event.event_type === 'new_pqr' ? `Nueva PQR${internal ? ' interna' : ''} · ${code}`
    : event.event_type === 'new_redigit' ? `Nueva ${type}${internal ? ' interna' : ''} pendiente · ${code}`
    : internal ? `Solicitud interna finalizada · ${code}`
    : `Solicitud finalizada · ${code}`;
  const outcome = code.startsWith('EDC-')
    ? data.editCompleted === true ? 'La auditoría fue editada.' : data.editCompleted === false ? 'La auditoría no fue editada.' : 'La solicitud de edición quedó finalizada.'
    : ticket.status === 'No Aplica' ? 'La PQR se cerró como No Aplica.' : 'La solicitud quedó cerrada.';
  const intro = event.event_type === 'received' ? 'Recibimos tu solicitud interna. El equipo la atenderá en su bandeja.'
    : event.event_type === 'closed' ? outcome
    : event.event_type === 'new_pqr' ? 'Hay una nueva PQR para asignar y analizar.'
    : `Hay una ${type} pendiente en la bandeja de Redigitación.`;
  // An unverified public contact receives only operational status, never private case notes.
  const comment = !internal && event.event_type === 'closed' && code.startsWith('EDC-') && data.editComment
    ? `\nComentario: ${String(data.editComment).slice(0, 2000)}\n` : '';
  const followup = requester ? `Consulta el estado con tu radicado: ${portalUrl}#consultar-ticket`
    : internal ? `Ingresa con tu cuenta a PQR internas para atender el caso: ${portalUrl}#gestion`
    : `Ingresa al portal para consultar el caso y sus adjuntos: ${portalUrl}`;
  return { subject, text: `${intro}\n\nRadicado: ${code}\nEstado: ${ticket.status}${comment}\n${followup}\n` };
}

const mailbox = (value: unknown): value is string => typeof value === 'string' && value.length <= 254
  && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);

async function sendEvent(event: MailEvent) {
  const claim = db!.from('pqr_mail_events').update({
    status: 'sending', locked_at: new Date().toISOString(), attempts: event.attempts + 1,
  }).eq('id', event.id).eq('status', event.status);
  const { data: claimed, error: claimError } = event.status === 'sending'
    ? await claim.lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString()).select('id,attempts').maybeSingle()
    : await claim.select('id,attempts').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return 'skipped';

  try {
    const { data: ticket, error: ticketError } = await db!.rpc('pqr_mail_ticket', { p_event: event.id });
    if (ticketError) throw ticketError;
    if (!ticket || ticket.data.scope !== 'internal' || !event.recipient_email || event.recipient_profile_id) {
      const { error } = await db!.from('pqr_mail_events').update({ status: 'cancelled', locked_at: null, last_error: 'Aviso fuera del flujo interno de destinatarios configurados' }).eq('id', event.id);
      if (error) throw error;
      return 'skipped';
    }
    const emails = [event.recipient_email];
    if (ticket.deleted_at) {
      await db!.from('pqr_mail_events').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: 'Destinatario inactivo o caso eliminado' }).eq('id', event.id);
      return 'skipped';
    }
    if (!emails.length || !emails.every(mailbox)) throw new Error('La cuenta destinataria no tiene correos de aviso válidos');
    const content = message(event, ticket);
    await transport.sendMail({
      from: `Portal PQR <${sender}>`,
      bcc: emails.map(address => ({ address })),
      subject: content.subject,
      text: content.text,
      messageId: `<pqr-${event.id}@portal-pqr.invalid>`,
    });
    const { error } = await db!.from('pqr_mail_events').update({
      status: 'sent', sent_at: new Date().toISOString(), locked_at: null, last_error: null,
    }).eq('id', event.id);
    if (error) throw error;
    return 'sent';
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message
      : cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : String(cause);
    await db!.from('pqr_mail_events').update({
      status: 'pending', locked_at: null, last_error: reason.slice(0, 500),
      next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }).eq('id', event.id);
    console.error('No se pudo enviar el aviso', { eventId: event.id, reason });
    return 'failed';
  }
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Método no permitido', { status: 405 });
  if (!mailerToken || request.headers.get('x-pqr-mailer-token') !== mailerToken) {
    return new Response('No autorizado', { status: 401 });
  }
  if (!db || !gmailPassword) return new Response('Faltan secretos del servidor', { status: 503 });
  const payload = await request.json().catch(() => ({}));
  if (payload.action === 'verify_smtp') {
    try {
      await transport.verify();
      return Response.json({ smtp: 'ready', sender });
    } catch (cause) {
      const code = cause instanceof Error && /^SMTP_[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'SMTP_CONNECTION_FAILED';
      return Response.json({ error: 'No se pudo verificar Gmail', code }, { status: 502 });
    }
  }
  const due = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ data: pending, error: pendingError }, { data: interrupted, error: interruptedError }] = await Promise.all([
    db.from('pqr_mail_events').select('id,ticket_id,recipient_profile_id,recipient_email,event_type,status,locked_at,attempts').eq('status', 'pending').lte('next_attempt_at', due).order('created_at').limit(20),
    db.from('pqr_mail_events').select('id,ticket_id,recipient_profile_id,recipient_email,event_type,status,locked_at,attempts').eq('status', 'sending').lt('locked_at', stale).order('locked_at').limit(5),
  ]);
  if (pendingError || interruptedError) return Response.json({ error: pendingError?.message || interruptedError?.message }, { status: 500 });
  const results = [];
  for (const event of [...(pending || []), ...(interrupted || [])] as MailEvent[]) results.push(await sendEvent(event));
  return Response.json({ processed: results.length, sent: results.filter(value => value === 'sent').length, failed: results.filter(value => value === 'failed').length });
});
