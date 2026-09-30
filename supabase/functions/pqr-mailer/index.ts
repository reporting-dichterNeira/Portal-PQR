import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import nodemailer from 'npm:nodemailer@10.0.12';

const sender = 'reportingdichter@gmail.com';
const portalUrl = 'https://reporting-dichterneira.github.io/Portal-PQR/';
const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const mailerToken = Deno.env.get('PQR_MAILER_TOKEN') ?? '';
const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';

const db = projectUrl && serviceKey ? createClient(projectUrl, serviceKey, { auth: { persistSession: false } }) : null;
const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: sender, pass: gmailPassword },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

type MailEvent = {
  id: string;
  ticket_id: string;
  recipient_profile_id: string;
  event_type: 'new_pqr' | 'new_redigit' | 'closed';
  status: 'pending' | 'sending' | 'sent';
  locked_at: string | null;
  attempts: number;
};

function message(event: MailEvent, ticket: { code: string; status: string; data: Record<string, unknown> }) {
  const { code, data } = ticket;
  const type = code.startsWith('EDC-') ? 'edición' : 'redigitación';
  const subject = event.event_type === 'new_pqr' ? `Nueva PQR · ${code}`
    : event.event_type === 'new_redigit' ? `Nueva ${type} pendiente · ${code}`
    : `Solicitud finalizada · ${code}`;
  const outcome = code.startsWith('EDC-')
    ? data.editCompleted === true ? 'La auditoría fue editada.' : 'La auditoría no fue editada.'
    : ticket.status === 'No Aplica' ? 'La PQR se cerró como No Aplica.' : 'La solicitud quedó cerrada.';
  const intro = event.event_type === 'closed' ? outcome
    : event.event_type === 'new_pqr' ? 'Hay una nueva PQR para asignar y analizar.'
    : `Hay una ${type} pendiente en la bandeja de Redigitación.`;
  const comment = event.event_type === 'closed' && code.startsWith('EDC-') && data.editComment
    ? `\nComentario: ${String(data.editComment).slice(0, 2000)}\n` : '';
  return { subject, text: `${intro}\n\nRadicado: ${code}\nEstado: ${ticket.status}${comment}\nIngresa al portal para consultar el caso y sus adjuntos: ${portalUrl}\n` };
}

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
    const [{ data: profile, error: profileError }, { data: ticket, error: ticketError }, { data: contacts, error: contactsError }] = await Promise.all([
      db!.from('pqr_profiles').select('active').eq('id', event.recipient_profile_id).single(),
      db!.from('pqr_tickets').select('code,status,data,deleted_at').eq('id', event.ticket_id).single(),
      db!.from('pqr_contact_emails').select('email').eq('profile_id', event.recipient_profile_id),
    ]);
    if (profileError || ticketError || contactsError) throw profileError || ticketError || contactsError;
    if (!profile?.active || ticket?.deleted_at) {
      await db!.from('pqr_mail_events').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: 'Destinatario inactivo o caso eliminado' }).eq('id', event.id);
      return 'skipped';
    }
    if (!contacts?.length) throw new Error('La cuenta destinataria no tiene correos de aviso configurados');
    const content = message(event, ticket);
    await transport.sendMail({
      from: `Portal PQR <${sender}>`,
      bcc: contacts.map((item: { email: string }) => item.email),
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
    const reason = cause instanceof Error ? cause.message : String(cause);
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
  const due = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ data: pending, error: pendingError }, { data: interrupted, error: interruptedError }] = await Promise.all([
    db.from('pqr_mail_events').select('id,ticket_id,recipient_profile_id,event_type,status,locked_at,attempts').eq('status', 'pending').lte('next_attempt_at', due).order('created_at').limit(20),
    db.from('pqr_mail_events').select('id,ticket_id,recipient_profile_id,event_type,status,locked_at,attempts').eq('status', 'sending').lt('locked_at', stale).order('locked_at').limit(5),
  ]);
  if (pendingError || interruptedError) return Response.json({ error: pendingError?.message || interruptedError?.message }, { status: 500 });
  const results = [];
  for (const event of [...(pending || []), ...(interrupted || [])] as MailEvent[]) results.push(await sendEvent(event));
  return Response.json({ processed: results.length, sent: results.filter(value => value === 'sent').length, failed: results.filter(value => value === 'failed').length });
});
