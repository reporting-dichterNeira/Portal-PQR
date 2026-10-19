/* Portal PQR oficial. La clave aquí es publicable; la autorización reside en RLS y funciones del servidor. */
(() => {
  'use strict';
  const URL = 'https://niwkegxwwwoahcbsoujy.supabase.co';
  const KEY = 'sb_publishable_YCNKUILCQOjMHOue4pkjRw_hf8TJJTT';
  const db = window.supabase?.createClient(URL, KEY, { auth: { detectSessionInUrl: false } });
  // Public intake uses an isolated anonymous client, never the team's session.
  const publicDb = window.supabase?.createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'pqr-public-intake-ephemeral' } });
  const publicResult = result => { if (result.data?.error) return { data: null, error: new Error(result.data.error) }; return result; };
  const internalAPI = {
    lookup: async code => publicResult(await publicDb.rpc('pqr_lookup_internal', { p_code: code })),
    submit: async (requestId, payload) => publicResult(await publicDb.rpc('pqr_submit_internal', { p_request_id: requestId, p_data: payload }))
  };
  async function uploadInternalAttachments(ticket, files, status) {
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      if (status) status.textContent = 'Cargando adjunto '+(i+1)+' de '+files.length;
      const path = ticket.uploadPaths?.[i];
      if (!path) { failed.push(files[i].name); continue; }
      const { error } = await publicDb.storage.from(attachmentBucket).upload(path, files[i], { contentType: attachmentTypes[files[i].name.split('.').pop().toLowerCase()], upsert: false });
      if (error) failed.push(files[i].name);
    }
    return failed;
  }
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const usernameKey = value => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const fmt = value => value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const roles = { admin: 'Administración', gerente: 'Gerencia', validador: 'Analistas de PQR', redigitador: 'Redigitación', comercial: 'Comercial' };
  const clients = ['KO tradicional', 'KO moderno', 'Lindley', 'P&G', 'CBC', 'Gloria', 'Heineken', 'Fifco', 'ABI', 'Otros'];
  const countries = ['Colombia', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Panamá', 'Perú', 'Bolivia', 'Paraguay', 'Costa Rica', 'Ecuador', 'Chile', 'República Dominicana'];
  const standardAreas = ['Campo', 'Validación', 'IT', 'Comercial'];
  const combinedArea = 'OPS Campo/Validación';
  const attachmentBucket = 'pqr-adjuntos';
  const maxAttachmentBytes = 10 * 1024 * 1024;
  const attachmentTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const managerState = { view: 'overview', auditDimension: '', country: 'all', study: 'all', month: 'all', origin: 'all', status: 'all', analyst: 'all', type: 'all' };
  const listTypes = { comercial: 'all', validador: 'all', redigitador: 'all', admin: 'all' };
  const analystFilters = { country: 'all', study: 'all', month: 'all', origin: 'all', type: 'all', status: 'all', analyst: 'all' };
  const requestType = ticket => ticket.requestType || (ticket.code?.startsWith('EDC-') ? 'EDC' : ticket.directRedigitation || ticket.code?.startsWith('RDG-') ? 'RDG' : 'PQR');
  const requestLabels = { PQR: 'PQR', RDG: 'Redigitación', EDC: 'Edición' };
  const manualPqrRoles = ['validador', 'gerente'];
  const canCreateManualPqr = () => manualPqrRoles.includes(state.me?.role);
  const canEditManualPqr = ticket => ticket?.manualEntry === true && requestType(ticket) === 'PQR' && !ticket.deletedAt &&
    (state.me?.role === 'validador' || (state.me?.role === 'gerente' && ticket.createdBy === state.me.id));
  const canAddAttachments = ticket => !ticket.deletedAt && (
    (state.me.role === 'comercial' && ticket.commercial === state.me.id) ||
    (canCreateManualPqr() && ticket.manualEntry === true && ticket.createdBy === state.me.id)
  );
  let state = { me: null, users: [], contactEmails: [], staff: { validators: [], redigitators: [] }, tips: [], tipAreas: {}, tickets: [], historical: [], overrides: [], deleted: [], notifications: [] };
  let busy = false;
  let auditLookup = window.PQRAudits?.empty();
  let auditLookupOwner = null;
  let workspace = ['#internas','#gestion'].includes(location.hash) ? 'internal' : 'external';
  const scopeTickets = () => window.PQRScopes.select(state.tickets,workspace);

  const managerTickets = () => [...scopeTickets(),...(workspace==='external'?state.historical:[])].map(t=>{
    const result=window.PQRHistory.resolve(t,auditLookup,state.overrides.find(o=>o.case_id===t.id));
    result.analystName=result.analystName||staffName('validador',result.validatorPersonId);
    return result;
  });
  async function refreshAudits(tickets = managerTickets()) {
    if (auditLookup.loading || !['gerente','admin'].includes(state.me?.role)) return;
    const owner = state.me.id;
    auditLookup.loading = true; auditLookup.error = '';
    // One authorized representative per new audit ID; empty IDs need no API call.
    const requested=new Set();
    tickets=tickets.filter(t=>{const ids=[window.PQRAudits.id(t.auditOriginal),window.PQRAudits.id(t.audit)].filter(Boolean).map(id=>window.PQRAudits.key(t,id));if(!ids.some(id=>!requested.has(id)))return false;ids.forEach(id=>requested.add(id));return true;});
    const supiTickets=tickets.filter(window.PQRAudits.isSupi);
    tickets=tickets.filter(t=>!window.PQRAudits.isSupi(t));
    if(state.me.role==='gerente')dashboard();
    try {
      if(supiTickets.length) { try {
        auditLookup.progress='Consultando el corte privado de SUPI · KO moderno Chile…';
        const {data:cut,error:cutError}=await db.from('pqr_supi_sync_state').select('checked_at,run_id').eq('source','SUPI').maybeSingle();
        if(state.me?.id!==owner)return;
        if(cutError)throw new Error('No se pudo leer el corte de SUPI. Se conserva la consulta anterior.');
        if(cut) {
          const ids=[...new Set(supiTickets.flatMap(t=>[window.PQRAudits.id(t.auditOriginal),window.PQRAudits.id(t.audit)]).filter(Boolean))];
          const entries={};
          for(let offset=0;offset<ids.length;offset+=100) {
            const batch=ids.slice(offset,offset+100);
            const {data:rows,error}=await db.from('pqr_supi_audit_cache').select('audit_id,records,checked_at,run_id').in('audit_id',batch);
            if(state.me?.id!==owner)return;
            if(error)throw new Error('No se pudo consultar SUPI. Se conservan los datos anteriores.');
            if((rows||[]).some(row=>row.run_id!==cut.run_id))throw new Error('SUPI está actualizando su corte. Pulsa Actualizar panel al terminar.');
            for(const audit of batch)entries[`supi:${audit}`]={rows:[],at:cut.checked_at};
            for(const row of rows||[])entries[`supi:${row.audit_id}`]={rows:row.records,at:row.checked_at};
          }
          // Recheck the cut: never classify a missing ID from mixed snapshots.
          const {data:latest,error:latestError}=await db.from('pqr_supi_sync_state').select('run_id').eq('source','SUPI').maybeSingle();
          if(state.me?.id!==owner)return;
          if(latestError||latest?.run_id!==cut.run_id)throw new Error('El corte de SUPI cambió durante la consulta. Reintenta para leerlo completo.');
          Object.assign(auditLookup.entries,entries);
          auditLookup.supiCheckedAt=cut.checked_at;
        } else {
          for(const t of supiTickets)for(const audit of [t.auditOriginal,t.audit].map(window.PQRAudits.id).filter(Boolean))delete auditLookup.entries[`supi:${audit}`];
          auditLookup.supiCheckedAt=null;
        }
      } catch(error) { if(state.me?.id!==owner)return; auditLookup.error=error.message; } }
      for (let offset = 0; offset < tickets.length; offset += 50) {
        auditLookup.progress = `Consultando solicitudes ${offset + 1} a ${Math.min(offset + 50,tickets.length)} de ${tickets.length}…`;
        const progress=$('.audit-status');if(progress)progress.textContent=auditLookup.progress;
        const batch=tickets.slice(offset,offset+50);
        const {data,error} = await db.functions.invoke('pqr-audits',{body:{ticketIds:batch.filter(t=>t.origin!=='historical').map(t=>t.id),historicalIds:batch.filter(t=>t.origin==='historical').map(t=>t.id)}});
        if (state.me?.id !== owner) return;
        if (error) {
          let detail; try { detail = await error.context?.json(); } catch { /* No siempre hay JSON. */ }
          throw new Error(detail?.error || data?.error || 'No se pudieron consultar las auditorías. Reintenta más tarde.');
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.entries || data.source !== 'scheduled') throw new Error('El corte sincronizado no es válido.');
        const ids = tickets.slice(offset,offset+50).flatMap(ticket=>[window.PQRAudits.id(ticket.auditOriginal),window.PQRAudits.id(ticket.audit)]).filter(Boolean);
        for (const id of ids) delete auditLookup.entries[id];
        Object.assign(auditLookup.entries,data.entries);
        const dates = Object.values(auditLookup.entries).map(entry=>Date.parse(entry.at)).filter(Number.isFinite);
        auditLookup.checkedAt = dates.length?new Date(Math.min(...dates)).toISOString():null;
        auditLookup.loaded = true;
      }
      auditLookup.loaded = true;
    } catch (error) { if (state.me?.id === owner) auditLookup.error = [auditLookup.error,error.message].filter(Boolean).join(' · '); }
    finally { if (state.me?.id === owner) { const dates=Object.values(auditLookup.entries).map(entry=>Date.parse(entry.at)).filter(Number.isFinite);auditLookup.checkedAt=dates.length?new Date(Math.min(...dates)).toISOString():null; auditLookup.loading = false; if(state.me.role==='gerente') dashboard(); } }
  }


  function showError(error) {
    const message = error?.message || String(error) || 'No se pudo completar la operación.';
    console.error('Portal PQR:', message);
    const status = $('#login-message');
    if (status) status.textContent = message;
    else alert(message);
  }
  function badge(status) { const kind = ['Cerrado', 'No Aplica'].includes(status) ? 'ok' : ['Reabierto', 'Devuelto'].includes(status) ? 'danger' : 'warn'; return `<span class="badge ${kind}">${esc(PQRReports.statusLabel(status))}</span>`; }
  function metric(label, value) { return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function header(title, subtitle, actions = '') { return `<div class="topline"><div><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`; }
  function staffName(role, id) { return state.staff[role === 'validador' ? 'validators' : 'redigitators'].find(person => person.id === id)?.name || ''; }
  function accountName(id) { return state.users.find(person => person.id === id)?.name || ''; }
  function due(ticket, role) {
    if (['Cerrado', 'No Aplica'].includes(ticket.status)) return '—';
    const start = role === 'redigitador' ? (ticket.redigitRequestedAt || ticket.createdAt) : ticket.status === 'Pendiente de Verificación' ? ticket.redigitAt : (ticket.reopenedAt || ticket.assignedAt || ticket.createdAt);
    const end = new Date(start).getTime() + 86400000;
    if (!Number.isFinite(end)) return '—';
    const minutes = Math.ceil(Math.abs(end - Date.now()) / 60000);
    return `<div class="sla-clock ${end < Date.now() ? 'late' : ''}" data-sla-due="${new Date(end).toISOString()}"><strong>${end < Date.now() ? 'Vencido hace' : 'Restan'} ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min</strong><small>Hasta ${fmt(end)}</small></div>`;
  }
  function modal(title, contents) {
    $('#modal')?.remove();
    $('#app').insertAdjacentHTML('beforeend', `<div class="modal" id="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><section class="modal-box"><header class="modal-head"><h2>${esc(title)}</h2><button class="ghost" data-action="close">Cerrar</button></header>${contents}</section></div>`);
    $('#modal').querySelectorAll('[data-numeric]').forEach(input => input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); }));
    $('#modal').querySelector('input,select,textarea,button')?.focus();
  }
  function closeModal() { $('#modal')?.remove(); }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
  function attachmentField() { return '<div class="full attachment-field"><strong>Adjuntos (opcional)</strong><input name="attachments" class="attachment-picker" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,.xls,.xlsx" aria-label="Seleccionar imágenes o archivos Excel"><button type="button" class="secondary attachment-add">Seleccionar varios archivos</button><small>Puedes elegir varias imágenes o archivos Excel a la vez, o volver a este botón para añadir más. Máximo 10 archivos, 10 MB cada uno.</small><div class="attachment-selection" aria-live="polite"></div></div>'; }
  function bindAttachmentSelection(form) {
    const input = form.elements.attachments;
    const selection = form.querySelector('.attachment-selection');
    input._selectedFiles = [];
    const render = () => {
      selection.innerHTML = input._selectedFiles.length
        ? `<p>${input._selectedFiles.length} archivo(s) seleccionado(s)</p><ul>${input._selectedFiles.map((file, index) => `<li><span>${esc(file.name)}</span><button type="button" class="ghost" data-remove-attachment="${index}" aria-label="Quitar ${esc(file.name)}">Quitar</button></li>`).join('')}</ul>`
        : '';
    };
    form.querySelector('.attachment-add').onclick = () => input.click();
    input.onchange = () => {
      const chosen = Array.from(input.files || []);
      const key = file => `${file.name}\0${file.size}\0${file.lastModified}`;
      const known = new Set(input._selectedFiles.map(key));
      const additions = chosen.filter(file => {
        const id = key(file);
        if (known.has(id)) return false;
        known.add(id);
        return true;
      });
      input.value = '';
      if (input._selectedFiles.length + additions.length > 10) {
        selection.insertAdjacentHTML('beforeend', '<p class="attachment-error">Máximo 10 archivos por carga. Quita alguno antes de añadir más.</p>');
        return;
      }
      input._selectedFiles.push(...additions);
      render();
    };
    selection.onclick = event => {
      const button = event.target.closest('[data-remove-attachment]');
      if (!button) return;
      input._selectedFiles.splice(Number(button.dataset.removeAttachment), 1);
      render();
    };
  }
  function checkedAttachments(input) {
    const files = Array.from(input._selectedFiles || input.files || []);
    if (files.length > 10) throw new Error('Selecciona máximo 10 archivos por carga.');
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!attachmentTypes[ext] || (file.type && file.type !== attachmentTypes[ext])) throw new Error(`Formato no permitido: ${file.name}. Usa imágenes o Excel (.xls, .xlsx).`);
      if (!file.size || file.size > maxAttachmentBytes) throw new Error(`${file.name} debe tener contenido y no superar 10 MB.`);
    }
    return files;
  }
  async function uploadAttachments(ticket, files, status) {
    const failures = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (status) status.textContent = `Cargando adjunto ${i + 1} de ${files.length}: ${file.name}`;
      const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-140);
      const path = `${ticket.id}/${crypto.randomUUID()}-${name}`;
      try {
        const { error } = await db.storage.from(attachmentBucket).upload(path, file, { contentType: attachmentTypes[file.name.split('.').pop().toLowerCase()], upsert: false });
        if (error) throw error;
      } catch (error) { console.error('Error al cargar adjunto:', file.name, error); failures.push(file.name); }
    }
    return failures;
  }
  function attachmentName(path) { return path.replace(/^[0-9a-f-]{36}-/, '').replace(/_/g, ' '); }
  function lock(form, locked) { form.querySelectorAll('button[type="submit"],button:not([type])').forEach(el => { el.disabled = locked; }); }
  async function submit(form, task) {
    if (busy) return;
    busy = true; lock(form, true);
    try { await task(); closeModal(); await load(); } catch (error) { showError(error); } finally { busy = false; lock(form, false); }
  }
  async function action(name, ticketId, payload = {}) {
    const { data, error } = await db.rpc('pqr_action', { p_action: name, p_ticket: ticketId || null, p_data: payload });
    if (error) throw error;
    return data;
  }
  async function createSpecial(kind, payload) {
    const { data, error } = await db.rpc('pqr_create_special', { p_kind: kind, p_data: payload });
    if (error) throw error;
    return data;
  }
  async function createManualPqr(payload) {
    const { data, error } = await db.rpc(payload.scope === 'internal' ? 'pqr_create_manual_scoped' : 'pqr_create_manual', { p_data: payload });
    if (error) throw error;
    return data;
  }
  async function adminFunction(payload) {
    const { data, error } = await db.functions.invoke('pqr-admin', { body: payload });
    if (error) {
      let detail;
      try { detail = await error.context?.json(); } catch { /* La respuesta no siempre contiene JSON. */ }
      console.error('Error de administración:', error, detail);
      throw new Error(detail?.error || detail?.message || error.message || 'No se pudo guardar la cuenta.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function load() {
    if(window.PQRNavigation.homeRoute(location.hash))return renderHome();
    if(location.hash==='#solicitud-interna')return renderPublicInternal();
    if(location.hash==='#consultar-ticket')return renderPublicLookup();
    const loadRoute=location.hash;
    const { data: session } = await db.auth.getSession();
    if(location.hash!==loadRoute)return;
    if (!session.session) { state.me = null; renderLogin(); return; }
    const queries = await Promise.all([
      db.from('pqr_profiles').select('id,username,name,role,active').order('name'),
      db.from('pqr_staff').select('*').order('name'),
      db.from('pqr_tips').select('name,suggested_area').order('name'),
      db.from('pqr_tickets').select('id,deleted_at,updated_at,data').order('created_at', { ascending: false }),
      db.from('pqr_notifications').select('*').order('created_at', { ascending: false }).limit(100),
      db.from('pqr_contact_emails').select('profile_id,email').order('email'),
    ]);
    for (const result of queries) if (result.error) throw result.error;
    const [profiles, staff, tips, cases, notifications, contactEmails] = queries.map(result => result.data);
    const me = profiles.find(person => person.id === session.session.user.id);
    if (!me?.active) { await db.auth.signOut(); state.me = null; renderLogin('Tu cuenta no está activa.'); return; }
    const reporting = ['gerente','admin'].includes(me.role);
    const historical = reporting ? await readAll('pqr_historical_cases','id,data') : [];
    const overrides = reporting ? await readAll('pqr_case_overrides','case_id,source,patch,reason,updated_at,updated_by,history','case_id') : [];
    if(location.hash!==loadRoute)return;
    state = {
      me, users: profiles, contactEmails,
      staff: { validators: staff.filter(person => person.role === 'validador'), redigitators: staff.filter(person => person.role === 'redigitador') },
      tips: tips.map(item => item.name),
      tipAreas: Object.fromEntries(tips.map(item => [item.name, item.suggested_area || ''])),
      tickets: cases.filter(item => !item.deleted_at).map(item => ({ ...item.data, recordUpdatedAt: item.updated_at })),
      deleted: cases.filter(item => item.deleted_at).map(item => ({ ...item.data, deletedAt: item.deleted_at })),
      notifications, historical:historical.map(row=>row.data), overrides,
    };
    if (auditLookupOwner !== me.id) { auditLookup = window.PQRAudits?.empty(); auditLookupOwner = me.id; }
    renderApp();
    // This reads Supabase only; opening Gerencia never wakes Reporting Cluster.
    if (me.role === 'gerente' && !window.PQRNavigation.homeRoute(location.hash) && auditLookup && !auditLookup.loaded) await refreshAudits();
  }
  async function readAll(table,columns,key='id') {
    const rows=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await db.from(table).select(columns).order(key).range(offset,offset+499);
      if(error)throw error;
      rows.push(...data);
      if(data.length<500)return rows;
    }
  }
  function renderLogin(message = '') {
    document.title='Acceso del equipo · Portal PQR';
    auditLookup = window.PQRAudits?.empty(); auditLookupOwner = null;
    for (const key of Object.keys(analystFilters)) analystFilters[key] = 'all';
    $('#app').innerHTML = $('#login-template').innerHTML;
    $('.login-card').insertAdjacentHTML('afterbegin',window.PQRNavigation.loginInfo(workspace));
    if (message) $('#login-message').textContent = message;
    $('#login-form').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const username = usernameKey($('#username').value);
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) { $('#login-message').textContent = 'Escribe un usuario válido.'; return; }
      lock(form, true); $('#login-message').textContent = 'Ingresando…';
      const { error } = await db.auth.signInWithPassword({ email: `${username}@portal-pqr.invalid`, password: $('#password').value });
      if (error) { $('#login-message').textContent = 'Usuario o contraseña incorrectos.'; lock(form, false); return; }
      try { await load(); } catch (loadError) { showError(loadError); lock(form, false); }
    };
  }
  function renderApp() {
    const me = state.me;
    $('#app').innerHTML = `<header class="app-header"><div class="brand"><img src="assets/dn-icon-blue.webp" alt=""><div><small>dichter &amp; neira</small>Portal PQR</div></div><nav class="nav" aria-label="Bandeja"><span class="active">${esc(roles[me.role])}</span></nav><div class="user"><span><strong>${esc(me.name)}</strong><br><small>@${esc(me.username)}</small></span><button class="ghost" data-action="notifications">Notificaciones${state.notifications.filter(item => !item.read).length ? ` (${state.notifications.filter(item => !item.read).length})` : ''}</button><button class="ghost" data-action="password">Contraseña</button><button class="ghost" data-action="logout">Salir</button></div></header><main class="layout" id="view"></main>`;
    if(window.PQRScopes.eligible(me.role))$('#view').insertAdjacentHTML('beforebegin',`<nav class="scope-tabs layout" aria-label="Separar solicitudes"><a href="#inicio" class="scope-home">← Inicio</a><button data-action="workspace" data-scope="external">PQR de clientes</button><button data-action="workspace" data-scope="internal">PQR internas</button><a href="#solicitud-interna">Enviar solicitud interna · sin cuenta ↗</a></nav>`);
    $('#view').insertAdjacentHTML('beforebegin','<div class="layout" id="module-context"></div>');
    renderView();
  }
  function renderView() {
    const role = state.me.role;
    document.title=`${window.PQRScopes.label(workspace)} · ${roles[role]}`;
    if(workspace==='internal'&&!window.PQRScopes.eligible(role)){
      $('#module-context').innerHTML=window.PQRNavigation.context('internal','comercial');
      $('#view').innerHTML='<section class="card"><h1>Este es el seguimiento del equipo</h1><p>Con una cuenta Comercial puedes gestionar tus PQR de clientes. Para enviar una solicitud interna no necesitas una cuenta ni entrar a esta bandeja.</p><div class="actions"><a class="primary module-link" href="#solicitud-interna">Enviar solicitud interna</a><a class="ghost module-link" href="#clientes">Ir a mis PQR de clientes</a><a href="#inicio">Volver al inicio</a></div></section>';return;
    }
    if(!window.PQRScopes.eligible(role))workspace='external';
    $('#module-context').innerHTML=window.PQRNavigation.context(workspace,role);
    $('#view').dataset.workspace=workspace;
    document.querySelectorAll('[data-action="workspace"]').forEach(b=>{const active=b.dataset.scope===workspace;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
    if (role === 'comercial') return commercial();
    if (role === 'validador') return analyst();
    if (role === 'redigitador') return redigitator();
    if (role === 'gerente') return dashboard();
    return admin();
  }
  function ticketTable(cases, role) {
    const selected = role === 'validador' ? 'all' : listTypes[role] || 'all';
    const visible = selected === 'all' ? cases : cases.filter(ticket => requestType(ticket) === selected);
    const filter = role === 'validador' ? '' : `<div class="ticket-filter"><label>Tipo de solicitud<select data-type-filter="${role}"><option value="all" ${selected === 'all' ? 'selected' : ''}>Todos los tipos</option>${Object.entries(requestLabels).map(([kind, label]) => `<option value="${kind}" ${selected === kind ? 'selected' : ''}>${label}</option>`).join('')}</select></label><small>Mostrando ${visible.length} de ${cases.length} solicitudes</small></div>`;
    if (!visible.length) return `${filter}<section class="card empty">No hay solicitudes de este tipo en la bandeja.</section>`;
    return `${filter}<section class="card table-wrap"><table class="table ticket-table"><thead><tr><th>Radicado</th><th>Cliente / PDV</th><th>Estado</th><th>Asignación</th><th>Auditoría</th>${['validador', 'redigitador'].includes(role) ? '<th>Plazo SLA · 24 h</th>' : ''}<th>Acciones</th></tr></thead><tbody>${visible.map(ticket => `<tr><td><strong>${esc(ticket.code)}</strong> <span class="badge direct-badge">${requestLabels[requestType(ticket)]}</span><br><small>${fmt(ticket.createdAt)}</small>${ticket.requesterName?`<small>Solicitante: ${esc(ticket.requesterName)}</small>`:''}${ticket.externalTicketId?`<small>Ticket de origen: ${esc(ticket.externalTicketId)}</small>`:''}</td><td>${esc(ticket.client)}<br><small>${esc(ticket.pdv || 'Sin PDV')} · ${esc(ticket.country)}</small></td><td>${badge(ticket.status)}${ticket.redigitType ? `<br><small>${requestType(ticket) === 'EDC' ? 'Edición de' : 'Redigitación de'} ${esc(ticket.redigitType.toLowerCase())}</small>` : ''}</td><td><small>${requestType(ticket) === 'PQR' ? `Analista: ${esc(staffName('validador', ticket.validatorPersonId) || 'Sin asignar')}<br>` : ''}Redig: ${esc(ticket.fieldRedigitatorName || staffName('redigitador', ticket.redigitatorPersonId) || 'Sin asignar')}</small></td><td>${requestType(ticket) === 'EDC' ? esc(ticket.auditOriginal || '—') : ticket.audit ? `<small>ID: ${esc(ticket.auditOriginal || '—')}<br>Nueva: ${esc(ticket.audit)}</small>` : esc(ticket.auditOriginal || '—')}</td>${['validador', 'redigitador'].includes(role) ? `<td>${due(ticket, role)}</td>` : ''}<td><div class="actions"><button class="ghost" data-action="detail" data-id="${ticket.id}">Detalle</button>${ticketActions(ticket, role)}</div></td></tr>`).join('')}</tbody></table></section>`;
  }
  function ticketActions(ticket, role) {
    if (role === 'admin') return `<button class="danger" data-action="delete" data-id="${ticket.id}">Eliminar</button>`;
    if (role === 'validador') {
      let result = canEditManualPqr(ticket) ? `<button class="ghost" data-action="edit-manual-pqr" data-id="${esc(ticket.id)}">Editar radicación</button>` : '';
      if (['Radicado', 'Reabierto', 'En Validación', 'Pendiente de Verificación'].includes(ticket.status)) result += `<button class="secondary" data-action="assign-validator" data-id="${ticket.id}">${ticket.validatorPersonId ? 'Reasignar' : 'Asignar'}</button>`;
      if (requestType(ticket) === 'PQR' && ticket.validatorPersonId && ['En Validación', 'Reabierto'].includes(ticket.status)) result += `<button class="primary" data-action="dictate" data-id="${ticket.id}">Dictaminar</button>`;
      if (requestType(ticket) === 'PQR' && ticket.validatorPersonId && ticket.status === 'Pendiente de Verificación') result += `<button class="primary" data-action="verify" data-id="${ticket.id}">Verificar</button>`;
      if (requestType(ticket) === 'PQR' && ['Cerrado', 'No Aplica'].includes(ticket.status)) result += `<button class="danger" data-action="reopen" data-id="${ticket.id}">Reabrir</button>`;
      return result;
    }
    if (role === 'redigitador' && (['Pendiente de Redigitación', 'Devuelto'].includes(ticket.status) || (requestType(ticket) === 'EDC' && ticket.status === 'Pendiente de Verificación'))) return `${ticket.status !== 'Pendiente de Verificación' ? `<button class="secondary" data-action="assign-redigit" data-id="${ticket.id}">${requestType(ticket) === 'EDC' ? 'Asignar edición' : 'Asignar'}</button>` : ''}${ticket.redigitatorPersonId || ticket.fieldRedigitatorName ? `<button class="primary" data-action="redigit" data-id="${ticket.id}">${requestType(ticket) === 'EDC' ? 'Confirmar edición' : 'Redigitar'}</button>` : ''}`;
    if (role === 'comercial' && ticket.status === 'Cerrado' && !ticket.feedback) return `<button class="secondary" data-action="feedback" data-id="${ticket.id}">Calificar</button>`;
    return '';
  }
  function commercial() {
    const cases = scopeTickets().filter(ticket => ticket.commercial === state.me.id);
    $('#view').innerHTML = `${header('Mis solicitudes', 'Radica PQR, redigitaciones o ediciones de auditoría.', '<button class="secondary" data-action="new-edit">Solicitar edición</button><button class="secondary" data-action="new-direct">Solicitar redigitación directa</button><button class="primary" data-action="new-ticket">Nueva PQR</button>')}<section class="metrics">${metric('Radicadas', cases.length)}${metric('En gestión', cases.filter(ticket => !['Cerrado', 'No Aplica'].includes(ticket.status)).length)}${metric('Cerradas', cases.filter(ticket => ['Cerrado', 'No Aplica'].includes(ticket.status)).length)}</section>${ticketTable(cases, 'comercial')}`;
  }
  function analyst() {
    const all = scopeTickets().filter(ticket => workspace==='internal'||requestType(ticket) === 'PQR').map(ticket => ({ ...ticket, analystName: staffName('validador', ticket.validatorPersonId) }));
    const cases = PQRReports.filterTickets(all, analystFilters);
    $('#view').innerHTML = `${header('Analistas de PQR', 'Asigna, dictamina, verifica redigitaciones y cierra casos.', '<button class="primary" data-action="new-manual-pqr">Nueva PQR manual</button>')}<section class="metrics">${metric('Total', cases.length)}${metric('Sin asignar', cases.filter(ticket => !ticket.validatorPersonId && ticket.status === 'Radicado').length)}${metric('Por verificar', cases.filter(ticket => ticket.status === 'Pendiente de Verificación').length)}${metric('Cerradas', cases.filter(ticket => ['Cerrado', 'No Aplica'].includes(ticket.status)).length)}</section>${ticketTable(cases, 'validador')}`;
    $('#view').querySelector('.metrics').insertAdjacentHTML('afterend', PQRReports.listFilters(all, state.staff, analystFilters));
    $('#view h1').textContent=`Analistas · ${window.PQRScopes.label(workspace)}`;
    if(workspace==='internal')$('#view > .topline .sub').textContent='Seguimiento interno separado. Las PQR pasan por Analistas; redigitaciones directas y ediciones se atienden en Redigitación.';
    for (const key of Object.keys(analystFilters)) $('#analyst-'+key+'-filter')?.addEventListener('change', event => { analystFilters[key] = event.target.value; analyst(); });
  }
  function redigitator() {
    const cases = scopeTickets().filter(ticket => ticket.redigitador === state.me.id);
    $('#view').innerHTML = `${header('Bandeja de redigitación', 'Gestiona redigitaciones y ediciones. Las ediciones de Validación se cierran aquí.')}<section class="metrics">${metric('Total', cases.length)}${metric('Pendientes', cases.filter(ticket => ['Pendiente de Redigitación', 'Devuelto'].includes(ticket.status)).length)}${metric('Por verificar', cases.filter(ticket => requestType(ticket) === 'PQR' && ticket.status === 'Pendiente de Verificación').length)}${metric('Cerradas', cases.filter(ticket => ticket.status === 'Cerrado').length)}</section>${ticketTable(cases, 'redigitador')}`;
  }
  function dashboard() {
    if(window.PQRNavigation.homeRoute(location.hash)||['#solicitud-interna','#consultar-ticket'].includes(location.hash))return;
    $('#view').innerHTML = PQRReports.render(managerTickets(), state.users, state.staff, { ...managerState, auditLookup, currentUserId: state.me.id });
    $('#view h1').textContent=`Dashboard · ${window.PQRScopes.label(workspace)}`;
    $('#view .manager-title .sub').textContent=workspace==='internal'?'Indicadores exclusivos de solicitudes internas, sin mezclar casos de clientes.':'Indicadores de clientes e históricos. No incluye solicitudes internas.';
    $('.export-actions')?.insertAdjacentHTML('afterbegin', '<button class="primary" data-action="new-manual-pqr">Nueva PQR manual</button>');
    for(const key of ['type','country','study','month','origin','status','analyst'])$('#manager-'+key+'-filter')?.addEventListener('change',event=>{managerState[key]=event.target.value;dashboard();});
  }
  function completeData(ticket) {
    const h=window.PQRHistory, old=state.overrides.find(o=>o.case_id===ticket.id);
    const fieldValue=key=>({auditAuditor:ticket.auditData?.nombre_usuario,auditValidator:ticket.auditData?.Validador,auditCity:ticket.auditData?.ciudad,auditRegion:ticket.auditData?.region})[key]??ticket[key]??'';
    const fields=h.editable.filter(([key])=>key!=='auditOriginal'||ticket.origin==='historical');
    modal(`Completar datos · ${ticket.code}`,`<p class="sub">Solo cambia indicadores; no modifica el Excel ni el trámite original. Deja el valor actual si no tienes una corrección confirmada.</p><form id="reporting-form" class="form-grid">${fields.map(([key,label])=>`<label>${esc(label)}${key==='applies'?`<select name="${key}"><option value="">Sin dato</option>${['Aplica','No Aplica'].map(v=>`<option ${fieldValue(key)===v?'selected':''}>${v}</option>`).join('')}</select>`:`<input name="${key}" value="${esc(fieldValue(key))}" maxlength="300" ${key==='reportingMonth'?'type="month"':key==='pdv'||key==='auditOriginal'?'inputmode="numeric" data-numeric pattern="[0-9]{1,30}"':''}>`}</label>`).join('')}<label class="full">Motivo de la corrección<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><div class="actions full"><button class="primary" type="submit">Guardar datos de indicadores</button><button class="ghost" type="button" data-action="close">Cancelar</button></div></form>`);
    const form=$('#reporting-form');
    const studyInput=form.elements.client;
    if(studyInput){
      const selector=document.createElement('select');selector.name='client';
      selector.innerHTML='<option value="">Sin clasificar</option>'+h.studies.map(name=>`<option ${ticket.client===name?'selected':''}>${esc(name)}</option>`).join('');
      studyInput.replaceWith(selector);
    }
    form.onsubmit=async event=>{
      event.preventDefault();await submit(form,async()=>{
        const values=formData(form),patch={...(old?.patch||{})};
        for(const [key] of fields){const value=String(values[key]||'').trim();if(value!==String(fieldValue(key)))patch[key]=value;}
        if((patch.pdv&&!/^\d{1,30}$/.test(patch.pdv))||(patch.auditOriginal&&!/^\d{1,30}$/.test(patch.auditOriginal)))throw Error('Los IDs deben contener solo números.');
        const payload={patch,reason:values.reason.trim()};
        const result=old?await db.from('pqr_case_overrides').update(payload).eq('case_id',ticket.id).eq('updated_at',old.updated_at).select('case_id'):await db.from('pqr_case_overrides').insert({...payload,case_id:ticket.id,source:ticket.origin}).select('case_id');
        if(result.error)throw result.error;if(result.data?.length!==1)throw Error('Otro usuario actualizó este registro. Recarga antes de corregirlo.');
      });
    };
  }
  function staffCard(role, title) {
    const people = state.staff[role === 'validador' ? 'validators' : 'redigitators'];
    return `<article class="card staff-card"><div class="staff-heading"><div><h3>${title}</h3><p class="sub">Personas responsables bajo una sola cuenta compartida del área.</p></div><button class="secondary" data-action="staff" data-role="${role}">Agregar persona</button></div><div class="list">${people.length ? people.map(person => `<div class="list-item staff-item"><div><strong>${esc(person.name)}</strong><small>${person.active ? 'Activo' : 'Inactivo'}</small></div><div class="actions"><button class="ghost" data-action="staff" data-role="${role}" data-person="${person.id}">Editar</button><button class="${person.active ? 'danger' : 'secondary'}" data-action="toggle-staff" data-role="${role}" data-person="${person.id}">${person.active ? 'Desactivar' : 'Activar'}</button></div></div>`).join('') : '<p class="empty">Sin personas registradas.</p>'}</div></article>`;
  }
  function suggestionOptions() {
    const values = [...new Set([combinedArea, ...standardAreas, ...Object.values(state.tipAreas).filter(Boolean)])];
    return `<option value="">Sin sugerencia</option>${values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}<option value="Otra área">Otra área…</option>`;
  }
  function tipAreaFields(prefix) {
    return `<label>Área sugerida<select name="area">${suggestionOptions()}</select></label><label class="hide" id="${prefix}-other-area">¿Cuál otra área?<input name="areaOther" maxlength="100"></label>`;
  }
  function bindTipAreaFields(form, prefix) {
    form.elements.area.onchange = () => {
      const other = form.elements.area.value === 'Otra área';
      $(`#${prefix}-other-area`).classList.toggle('hide', !other);
      form.elements.areaOther.required = other;
    };
    form.elements.area.onchange();
  }
  function chosenTipArea(form) {
    const value = form.elements.area.value === 'Otra área' ? form.elements.areaOther.value.trim() : form.elements.area.value;
    if (form.elements.area.value === 'Otra área' && !value) throw new Error('Escribe el área sugerida.');
    return value;
  }
  function admin() {
    const deleted = listTypes.admin === 'all' ? window.PQRScopes.select(state.deleted,workspace) : window.PQRScopes.select(state.deleted,workspace).filter(ticket => requestType(ticket) === listTypes.admin);
    $('#view').innerHTML = `${header('Administración', 'Gestiona cuentas, responsables, tipologías y registros.', '<button class="secondary" data-action="new-user">Nuevo usuario</button>')}
      <section class="metrics">${metric('Solicitudes radicadas', scopeTickets().length)}${metric('Abiertas', scopeTickets().filter(ticket => !['Cerrado', 'No Aplica'].includes(ticket.status)).length)}${metric('Cerradas', scopeTickets().filter(ticket => ['Cerrado', 'No Aplica'].includes(ticket.status)).length)}${metric('Analistas activos', state.staff.validators.filter(person => person.active).length)}${metric('Redigitadores activos', state.staff.redigitators.filter(person => person.active).length)}</section>
      <section class="grid2 staff-grid">${staffCard('validador', 'Analistas de PQR')}${staffCard('redigitador', 'Redigitadores')}</section>
      ${ticketTable(scopeTickets(), 'admin')}
      ${deleted.length ? `<section class="card"><h3>Registros eliminados</h3><div class="list">${deleted.map(ticket => `<div class="list-item staff-item"><div><strong>${esc(ticket.code)}</strong><small>${esc(ticket.client)} · ${ticket.pdv ? `PDV ${esc(ticket.pdv)} · ` : ''}${fmt(ticket.deletedAt)}</small></div><button class="secondary" data-action="restore" data-id="${ticket.id}">Restaurar</button></div>`).join('')}</div></section>` : ''}
      <section class="card accounts-card"><h3>Cuentas de acceso</h3><p class="sub">Ingreso solo con usuario y contraseña. Los correos de aviso son independientes y puedes asociar varios a cada cuenta compartida.</p><div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${state.users.map(person => `<tr><td>${esc(person.name)}</td><td>@${esc(person.username)}</td><td>${esc(roles[person.role])}</td><td>${person.active ? 'Activo' : 'Inactivo'}</td><td><button class="ghost" data-action="edit-user" data-id="${person.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></section>
      <section class="card tipologies-card"><div class="staff-heading"><div><h3>Tipologías</h3><p class="sub">Define el área sugerida para cada tipología. El analista podrá cambiarla en el dictamen.</p></div><span class="badge">${state.tips.length} registradas</span></div><div class="tipologies-grid">${state.tips.map(tip => `<div class="tipology-item"><strong>${esc(tip)}</strong><small>Área sugerida: ${esc(state.tipAreas[tip] || 'Sin sugerencia')}</small><div class="actions"><button class="secondary" data-action="edit-tip-area" data-tip="${esc(tip)}">Cambiar área</button><button class="ghost" data-action="delete-tip" data-tip="${esc(tip)}">Eliminar</button></div></div>`).join('')}</div><form id="tip-form" class="tip-add-form"><label>Nueva tipología<input name="name" placeholder="Nombre de la tipología" required maxlength="150"></label>${tipAreaFields('new-tip')}<button class="primary">Agregar tipología</button></form></section>`;
    const accounts = $('.accounts-card');
    accounts?.querySelectorAll('tbody tr').forEach((row, index) => {
      const person = state.users[index];
      const cell = row.lastElementChild;
      cell.classList.add('account-controls');
      cell.insertAdjacentHTML('afterbegin', `<button class="secondary" data-action="contact-emails" data-id="${esc(person.id)}">Correos (${state.contactEmails.filter(item => item.profile_id === person.id).length})</button><button class="secondary" data-action="credentials" data-id="${esc(person.id)}">Credenciales</button>`);
    });
    const tipForm = $('#tip-form');
    bindTipAreaFields(tipForm, 'new-tip');
    tipForm.onsubmit = async event => { event.preventDefault(); await submit(tipForm, async () => {
      const name = tipForm.elements.name.value.trim();
      const area = chosenTipArea(tipForm);
      const { error } = await db.rpc('pqr_admin_tip', { p_name: name, p_delete: false });
      if (error) throw error;
      if (area) { const result = await db.rpc('pqr_admin_tip_area', { p_name: name, p_area: area }); if (result.error) throw result.error; }
    }); };
  }
  function renderHome() { document.title='Inicio · Portal PQR';$('#modal')?.remove();$('#app').innerHTML=window.PQRNavigation.home(); }
  function renderPublicLookup() {
    document.title='Consultar mi ticket · Portal PQR';$('#modal')?.remove();
    $('#app').innerHTML=`${window.PQRNavigation.publicHeader()}<main class="public-internal ticket-lookup"><nav class="public-breadcrumb" aria-label="Ruta de navegación"><a href="#inicio">Inicio</a><span> / PQR internas / Consultar mi ticket</span></nav>${window.PQRNavigation.publicTabs('lookup')}<section class="card"><span class="eyebrow">SEGUIMIENTO DE SOLICITUDES INTERNAS</span><h1>Consultar mi ticket</h1><p>Escribe el número completo que recibiste al enviar tu solicitud. Puedes consultar PQR, redigitaciones y ediciones internas sin ingresar a la bandeja del equipo.</p><form id="ticket-lookup-form"><label for="lookup-code">Número de ticket / radicado</label><div class="lookup-controls"><input id="lookup-code" name="code" required maxlength="100" autocomplete="off" spellcheck="false" placeholder="Pega el radicado interno completo" aria-describedby="lookup-hint"><button class="primary" type="submit">Consultar estado</button></div><small id="lookup-hint">Copia el radicado completo, incluyendo sus letras y guiones.</small></form><div id="lookup-result" role="status" aria-live="polite" aria-atomic="true"></div></section><p class="portal-note">Se muestran únicamente el estado y las fechas de seguimiento, sin nombres, comentarios internos ni adjuntos.</p></main>`;
    const form=$('#ticket-lookup-form'),output=$('#lookup-result');let searching=false;
    form.elements.code.oninput=()=>{output.replaceChildren();};
    form.onsubmit=async event=>{
      event.preventDefault();if(searching)return;
      const code=form.elements.code.value.trim();if(!code){form.reportValidity();return;}
      searching=true;lock(form,true);output.textContent='Consultando…';
      try{
        const result=await internalAPI.lookup(code);if(result.error)throw result.error;
        if(!form.isConnected)return;
        if(!result.data){output.innerHTML='<div class="lookup-message"><strong>No encontramos un ticket interno con ese número.</strong><p>Revisa el radicado completo y vuelve a consultar. El envío debe haberse realizado desde esta ticketera interna.</p></div>';return;}
        const t=result.data,status=t.status==='En Validación'?'En revisión':t.status;
        output.innerHTML=`<article class="lookup-status-card"><span class="eyebrow">TICKET INTERNO</span><h2>${esc(t.code)}</h2><p class="lookup-status">${esc(status)}</p><dl><div><dt>Tipo de solicitud</dt><dd>${esc(requestLabels[t.requestType]||'Solicitud interna')}</dd></div><div><dt>Registrado</dt><dd>${esc(fmt(t.createdAt))}</dd></div><div><dt>Última actualización</dt><dd>${esc(fmt(t.updatedAt))}</dd></div>${t.closedAt?`<div><dt>Fecha de cierre</dt><dd>${esc(fmt(t.closedAt))}</dd></div>`:''}</dl><p class="sub">Para revisar si hay novedades, pulsa «Consultar estado» otra vez.</p></article>`;
      }catch(error){if(form.isConnected)output.textContent='No pudimos consultar el estado. Espera un minuto y vuelve a intentar.';}
      finally{searching=false;lock(form,false);}
    };
  }
  function syncIntakeKind(form) {
    const kind=form.elements.kind.value;
    form.elements.auditOriginal.required=kind!=='PQR';form.elements.pdv.required=kind!=='EDC';
    $('#public-audit-label').firstChild.textContent=kind==='PQR'?'ID de auditoría (opcional para PQR)':'ID de auditoría actual';
    $('#public-pdv-label').firstChild.textContent=kind==='EDC'?'ID de PDV (opcional)':'ID de PDV';
    document.querySelectorAll('[data-intake-kind]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.intakeKind===kind));});
  }
  function renderPublicInternal() {
    document.title='Enviar solicitud interna · Portal PQR';
    $('#app').innerHTML=`${window.PQRNavigation.publicHeader()}<main class="public-internal public-intake"><div class="public-hero"><span class="eyebrow">ESTAMOS PARA AYUDARTE</span><h1>¿Qué necesitas solicitar?</h1><p>Elige el tipo de solicitud y cuéntanos qué necesitas. Te entregaremos un radicado para hacer seguimiento.</p></div>${window.PQRNavigation.intakeChoices()}<section class="card intake-form-card"><div class="intake-form-heading"><span class="form-heading-icon">${window.PQRNavigation.icon('ticket')}</span><div><h2>Cuéntanos los detalles</h2><p>Completa los datos de tu solicitud. Los campos opcionales están indicados.</p></div></div><form id="public-internal-form" class="form-grid"><fieldset class="intake-section full"><legend><span>01</span> Tus datos</legend><div class="form-grid"><label>Usuario o nombre del solicitante<input name="requesterName" required minlength="3" maxlength="150" autocomplete="name" placeholder="Escribe tu nombre o usuario"></label><label>Correo de contacto (opcional)<input name="requesterEmail" type="email" maxlength="254" autocomplete="email" placeholder="nombre@empresa.com"><small>Solo como dato de contacto para el equipo. No crea una cuenta.</small></label></div></fieldset><fieldset class="intake-section full"><legend><span>02</span> Tu solicitud</legend><div class="form-grid"><label>Tipo de solicitud<select name="kind" required><option value="PQR">PQR interna</option><option value="RDG">Redigitación directa</option><option value="EDC">Edición de auditoría</option></select></label><label>Cliente / estudio<select name="client" required>${options(clients)}</select></label><label class="full hide" id="public-other-client">Otro estudio<input name="clientOther" maxlength="100" placeholder="Nombre del estudio"></label><label>País<select name="country" required>${options(countries)}</select></label><label id="public-pdv-label">ID de PDV<input name="pdv" inputmode="numeric" pattern="[0-9]{1,80}" data-numeric maxlength="80" required placeholder="Ej. 123456"></label><label class="full" id="public-audit-label">ID de auditoría (opcional para PQR)<input name="auditOriginal" inputmode="numeric" pattern="[0-9]{1,80}" data-numeric maxlength="80" placeholder="Número de la auditoría"></label><label class="full">Descripción / motivo<textarea name="description" required minlength="8" maxlength="12000" placeholder="Cuéntanos qué ocurrió y qué necesitas que revisemos…"></textarea></label></div></fieldset><fieldset class="intake-section full"><legend><span>03</span> Archivos de apoyo <small>Opcional</small></legend>${attachmentField()}</fieldset><div class="intake-form-footer full"><p>${window.PQRNavigation.icon('lock')}No compartas contraseñas. Tu nombre identifica la solicitud, pero no autentica tu identidad.</p><button class="primary" type="submit">Enviar solicitud interna ${window.PQRNavigation.icon('arrow')}</button></div><p id="public-intake-error" class="full sub" role="alert"></p><p id="upload-progress" class="full sub" role="status"></p></form></section><p class="public-followup">¿Ya tienes un radicado? <a href="#consultar-ticket">Consulta aquí el estado de tu ticket ${window.PQRNavigation.icon('arrow')}</a></p></main>`;
    document.querySelector('main.public-internal').insertAdjacentHTML('afterbegin',window.PQRNavigation.publicIntro());
    const form=$('#public-internal-form'), requestId=crypto.randomUUID();bindAttachmentSelection(form);
    form.querySelectorAll('[data-numeric]').forEach(input=>input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'');}));
    form.elements.kind.onchange=()=>syncIntakeKind(form);
    document.querySelectorAll('[data-intake-kind]').forEach(button=>{button.onclick=()=>{form.elements.kind.value=button.dataset.intakeKind;syncIntakeKind(form);};});
    syncIntakeKind(form);
    form.elements.client.onchange=()=>{const other=form.elements.client.value==='Otros';$('#public-other-client').classList.toggle('hide',!other);form.elements.clientOther.required=other;};
    form.onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;lock(form,true);$('#public-intake-error').textContent='';
      let created;
      try{
        const files=checkedAttachments(form.elements.attachments),values=formData(form);
        const payload=Object.fromEntries(['requesterName','requesterEmail','kind','country','pdv','auditOriginal','description'].map(key=>[key,String(values[key]||'').trim()]));
        payload.client=(values.client==='Otros'?values.clientOther:values.client||'').trim();
        payload.files=files.map(file=>({name:file.name,size:file.size}));
        const result=await internalAPI.submit(requestId,payload);if(result.error)throw result.error;created=result.data;
        const failed=await uploadInternalAttachments(created,files,$('#upload-progress'));
        const main=document.querySelector('main.public-internal');
        main.innerHTML=`<section class="card internal-receipt" role="status"><span class="eyebrow">SOLICITUD INTERNA REGISTRADA</span><h1>${esc(created.code)}</h1><p>Conserva este radicado para consultar con el equipo. Tu solicitud aparecerá únicamente en la bandeja interna, no en PQR de clientes.</p><p><strong>Tipo:</strong> ${esc(requestLabels[created.requestType])} · <strong>Solicitante:</strong> ${esc(payload.requesterName)}</p>${failed.length?`<p role="alert">La solicitud se creó, pero no se cargaron: ${failed.map(esc).join(', ')}. Entrega los archivos al equipo indicando este radicado; no dupliques la solicitud.</p>`:files.length?'<p>Los adjuntos seleccionados se guardaron de forma privada.</p>':'<p>No se añadieron adjuntos.</p>'}<p class="sub">Guarda tu radicado completo para consultar el estado en «Consultar mi ticket».</p><div class="actions"><button class="primary" id="another-internal">Enviar otra solicitud</button><a class="ghost module-link" href="#consultar-ticket">Consultar mi ticket</a><a href="#internas">Volver al seguimiento del equipo</a></div></section>`;
        $('#another-internal').onclick=renderPublicInternal;
      }catch(error){const message=created?`Se registró ${created.code}, pero falló la carga de adjuntos. No vuelvas a enviar el formulario: entrega el soporte al equipo con ese radicado.`:error.message;$('#public-intake-error').textContent=message;if(created){form.onsubmit=event=>event.preventDefault();}}
      finally{busy=false;if(!created)lock(form,false);}
    };
  }
  function options(values, placeholder = 'Selecciona una opción') { return `<option value="" disabled selected>${placeholder}</option>${values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`; }
  function newTicket(kind, manual = false) {
    if (manual ? !canCreateManualPqr() || kind !== 'PQR' : state.me.role !== 'comercial') return;
    const direct = kind === 'RDG';
    const edition = kind === 'EDC';
    const manualFields = manual ? `<p class="full sub">Radicación rápida de una solicitud recibida fuera del portal. El ID de PDV y la descripción son opcionales ahora; el analista deberá completarlos antes de confirmar el dictamen. El portal genera su propio radicado PQR.</p><label>ID de ticket (opcional)<input name="externalTicketId" placeholder="ID del ticket recibido fuera del portal" maxlength="100"></label>` : '';
    modal(manual ? 'Nueva PQR manual' : edition ? 'Solicitar edición de auditoría' : direct ? 'Redigitación directa' : 'Nueva PQR', `<form id="case-form" class="form-grid">${manualFields}${edition ? '' : `<label>ID de PDV${manual?' (opcional)':''}<input name="pdv" inputmode="numeric" pattern="[0-9]+" data-numeric ${manual?'':'required '}maxlength="80"></label>`}<label>Cliente / estudio<select name="client" required>${options(clients)}</select></label><label class="full hide" id="other-client">¿Cuál otro?<input name="clientOther" maxlength="100"></label><label>País<select name="country" required>${options(countries)}</select></label>${direct || edition ? '<label>ID de auditoría actual<input name="auditOriginal" inputmode="numeric" pattern="[0-9]+" data-numeric required></label>' : ''}<label class="full">${edition ? 'Motivo de la edición' : `Descripción${manual?' (opcional)':''}`}<textarea name="description" ${manual?'':'required minlength="8" '}maxlength="12000"></textarea></label>${attachmentField()}<p class="full attachment-progress" id="upload-progress" role="status" aria-live="polite"></p><div class="full actions"><button class="primary">${edition ? 'Solicitar edición' : direct ? 'Enviar a Redigitación' : 'Radicar PQR'}</button><button type="button" class="ghost" data-action="close">Cancelar</button></div></form>`);
    const form = $('#case-form');
    bindAttachmentSelection(form);
    form.elements.client.onchange = () => { const other = form.elements.client.value === 'Otros'; $('#other-client').classList.toggle('hide', !other); form.elements.clientOther.required = other; };
    form.onsubmit = async event => {
      event.preventDefault();
      let files;
      try { files = checkedAttachments(form.elements.attachments); } catch (error) { showError(error); return; }
      let created;
      let failures = [];
      await submit(form, async () => {
        const payload = formData(form);
        if (manual) payload.source = 'Otro';
        payload.scope = workspace;
        delete payload.attachments;
        delete payload.clientOther;
        payload.client = form.elements.client.value === 'Otros' ? form.elements.clientOther.value.trim() : form.elements.client.value;
        created = manual ? await createManualPqr(payload) : kind === 'PQR' ? await action('create', null, payload) : await createSpecial(kind, payload);
        failures = await uploadAttachments(created, files, $('#upload-progress'));
      });
      if (created && failures.length) alert(`${created.code} se creó correctamente, pero no se pudieron cargar estos adjuntos: ${failures.join(', ')}. Abre Detalle para reintentarlo.`);
    };
  }
  function editManualPqr(ticket) {
    if (!canEditManualPqr(ticket)) return;
    const complete = !!ticket.applies || ['Cerrado', 'No Aplica', 'Pendiente de Redigitación', 'Pendiente de Verificación', 'Devuelto'].includes(ticket.status);
    const client = clients.includes(ticket.client) ? ticket.client : 'Otros';
    const choices = (items, current) => items.map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('');
    modal(`Editar radicación · ${ticket.code}`, `<p class="sub">Corrige los datos de esta PQR manual. Se conservarán el radicado, estado, responsables, adjuntos y fechas del proceso. Cada corrección queda en el paso a paso.</p><form id="edit-manual-form" class="form-grid"><label>ID de ticket (opcional)<input name="externalTicketId" maxlength="100" value="${esc(ticket.externalTicketId)}"></label><label>ID de PDV${complete?'':' (opcional)'}<input name="pdv" inputmode="numeric" pattern="[0-9]{1,80}" maxlength="80" data-numeric ${complete?'required':''} value="${esc(ticket.pdv)}"></label><label>Cliente / estudio<select name="client" required>${choices(clients,client)}</select></label><label>País<select name="country" required>${choices(countries,ticket.country)}</select></label><label class="full ${client==='Otros'?'':'hide'}" id="edit-other-client">¿Cuál otro?<input name="clientOther" maxlength="100" ${client==='Otros'?'required':''} value="${esc(client==='Otros'?ticket.client:'')}"></label><label class="full">Descripción${complete?'':' (opcional)'}<textarea name="description" maxlength="12000" ${complete?'required minlength="8"':''}>${esc(ticket.description)}</textarea></label><label class="full">Motivo de la corrección<textarea name="reason" required minlength="5" maxlength="1000"></textarea></label><div class="actions full"><button class="primary" type="submit">Guardar corrección</button><button class="ghost" type="button" data-action="close">Cancelar</button></div></form>`);
    const form = $('#edit-manual-form');
    form.elements.client.onchange = () => { const other=form.elements.client.value==='Otros'; $('#edit-other-client').classList.toggle('hide',!other); form.elements.clientOther.required=other; };
    form.onsubmit = async event => { event.preventDefault(); await submit(form, async () => {
      const values = formData(form);
      const payload = Object.fromEntries(['externalTicketId','pdv','description','country','reason'].map(key=>[key,String(values[key]||'').trim()]));
      payload.client = (values.client==='Otros'?values.clientOther:values.client||'').trim();
      const {error} = await db.rpc('pqr_edit_manual', { p_ticket: ticket.id, p_expected_updated_at: ticket.recordUpdatedAt, p_data: payload });
      if (error) throw error;
    }); };
  }
  function detail(ticket) {
    const events = ticket.timeline || [];
    const canAdd = canAddAttachments(ticket);
    modal(`Detalle · ${ticket.code}`, `<div class="case-result"><p><strong>Trámite:</strong> ${esc(requestLabels[requestType(ticket)])} · <strong>Estudio:</strong> ${esc(ticket.client)} · <strong>País:</strong> ${esc(ticket.country)}${ticket.pdv ? ` · <strong>PDV:</strong> ${esc(ticket.pdv)}` : ''}</p><p><strong>Auditoría original:</strong> ${esc(ticket.auditOriginal || '—')}${requestType(ticket) === 'EDC' ? '' : ` · <strong>Nueva:</strong> ${esc(ticket.audit || '—')}`}</p><p><strong>${requestType(ticket) === 'EDC' ? 'Motivo de la edición' : 'Descripción'}:</strong> ${esc(ticket.description)}</p>${ticket.response ? `<p><strong>Respuesta:</strong> ${esc(ticket.response)}</p>` : ''}${ticket.redigitNotes && requestType(ticket) !== 'EDC' ? `<p><strong>Redigitación:</strong> ${esc(ticket.redigitNotes)}</p>` : ''}${requestType(ticket) === 'EDC' && ticket.editCompleted !== undefined ? `<p><strong>¿Se editó?</strong> ${ticket.editCompleted ? 'Sí' : 'No'}<br><strong>Comentario:</strong> ${esc(ticket.editComment || '—')}</p>` : ''}</div><section class="attachments-section"><h3>Adjuntos</h3><div id="attachment-list" data-ticket="${esc(ticket.id)}" aria-live="polite">Cargando adjuntos…</div>${canAdd ? `<form id="add-attachments" class="stack">${attachmentField()}<p class="attachment-progress" id="upload-progress" role="status" aria-live="polite"></p><div class="actions"><button class="secondary">Añadir archivos</button></div></form>` : ''}</section><h3>Paso a paso</h3><div class="timeline">${events.length ? events.map(item => `<div class="list-item"><strong>${esc(item.action)}</strong><br><small>${fmt(item.at)} · ${esc(item.actor)}</small><p>${esc(item.detail)}</p></div>`).join('') : '<p class="empty">Sin eventos.</p>'}</div>`);
    loadAttachments(ticket.id);
    $('.case-result')?.insertAdjacentHTML('afterbegin',`<p><strong>Ámbito:</strong> ${esc(window.PQRScopes.label(window.PQRScopes.of(ticket)))}${ticket.requesterName?`<br><strong>Solicitante:</strong> ${esc(ticket.requesterName)} <small>(usuario/nombre declarado)</small>`:''}${ticket.requesterEmail?`<br><strong>Contacto:</strong> ${esc(ticket.requesterEmail)}`:''}</p>`);
    if (canEditManualPqr(ticket)) $('.case-result')?.insertAdjacentHTML('beforeend', `<button class="secondary" data-action="edit-manual-pqr" data-id="${esc(ticket.id)}">Editar radicación</button>`);
    if (ticket.manualEntry) $('.case-result')?.insertAdjacentHTML('beforeend', `<p><strong>Radicación manual</strong> · <strong>Registrada por:</strong> ${esc(ticket.createdByName || accountName(ticket.createdBy))}<br><strong>ID de ticket de origen:</strong> ${esc(ticket.externalTicketId || 'No indicado')}${ticket.commercialName||ticket.commercial?`<br><strong>Comercial asociado (registro anterior):</strong> ${esc(ticket.commercialName || accountName(ticket.commercial))}`:''}</p>${!ticket.pdv||!ticket.description?'<p class="sub">Información pendiente: el ID de PDV y la descripción deben completarse al dictaminar.</p>':''}`);
    if (canAdd) {
      const form = $('#add-attachments');
      bindAttachmentSelection(form);
      form.onsubmit = async event => {
        event.preventDefault();
        let files;
        try { files = checkedAttachments(form.elements.attachments); } catch (error) { showError(error); return; }
        if (!files.length) { showError(new Error('Selecciona al menos un archivo.')); return; }
        if (busy) return;
        busy = true; lock(form, true);
        try {
          const failures = await uploadAttachments(ticket, files, $('#upload-progress'));
          form.reset(); form.elements.attachments._selectedFiles = []; form.querySelector('.attachment-selection').innerHTML = '';
          $('#upload-progress').textContent = failures.length ? `No se pudieron cargar: ${failures.join(', ')}.` : 'Adjuntos cargados correctamente.';
          await loadAttachments(ticket.id);
        } catch (error) { showError(error); } finally { busy = false; lock(form, false); }
      };
    }
  }
  async function loadAttachments(ticketId) {
    try {
      const { data, error } = await db.storage.from(attachmentBucket).list(ticketId, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      const target = $('#attachment-list');
      if (!target || target.dataset.ticket !== ticketId) return;
      target.innerHTML = data?.length ? `<div class="attachment-list">${data.map(file => `<button class="ghost attachment-item" data-action="download-attachment" data-id="${esc(ticketId)}" data-file="${esc(file.name)}" title="Descargar ${esc(attachmentName(file.name))}"><span>${esc(attachmentName(file.name))}</span><small>Descargar</small></button>`).join('')}</div>` : '<p class="sub">Este ticket no tiene adjuntos.</p>';
    } catch (error) {
      console.error('Error al consultar adjuntos:', error);
      const target = $('#attachment-list');
      if (target?.dataset.ticket === ticketId) target.textContent = 'No se pudieron consultar los adjuntos. Vuelve a abrir el detalle.';
    }
  }
  async function downloadAttachment(ticketId, fileName) {
    const { data, error } = await db.storage.from(attachmentBucket).download(`${ticketId}/${fileName}`);
    if (error) throw error;
    const url = window.URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachmentName(fileName);
    document.body.append(link);
    link.click(); link.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  }
  function assignValidator(ticket) {
    const people = state.staff.validators.filter(person => person.active);
    modal(`Asignar · ${ticket.code}`, `<form id="action-form" class="stack"><label>Analista de PQR<select name="personId" required>${options(people.map(person => person.id), 'Selecciona un analista')}</select></label><div class="actions"><button class="primary">Confirmar asignación</button></div></form>`);
    const form = $('#action-form');
    form.elements.personId.innerHTML = `<option value="" disabled selected>Selecciona un analista</option>${people.map(person => `<option value="${person.id}" ${ticket.validatorPersonId === person.id ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}`;
    form.onsubmit = async event => { event.preventDefault(); await submit(form, () => action('assign_validator', ticket.id, formData(form))); };
  }
  function dictate(ticket) {
    const areas = [...new Set([combinedArea, ...standardAreas, ...Object.values(state.tipAreas).filter(Boolean)])];
    const intakeFields=ticket.manualEntry?`<p class="full sub">${ticket.externalTicketId?`Ticket de origen: ${esc(ticket.externalTicketId)}. `:''}Completa la información de la radicación antes de dictaminar. Estos campos son obligatorios para cualquier resultado.</p><label class="full">ID de PDV<input name="pdv" inputmode="numeric" pattern="[0-9]+" data-numeric required maxlength="80" value="${esc(ticket.pdv||'')}"></label><label class="full">Descripción de la solicitud<textarea name="description" required minlength="8" maxlength="12000">${esc(ticket.description||'')}</textarea></label>`:'';
    modal(`Dictaminar · ${ticket.code}`, `<p class="sub">Responsable: ${esc(staffName('validador', ticket.validatorPersonId))}</p><form id="action-form" class="form-grid">${intakeFields}<label class="full">Resultado<select name="decision"><option value="no">No aplica · cerrar con justificación</option><option value="yes">Aplica · cerrar con respuesta</option><option value="redigit">Aplica · requiere redigitación</option></select></label><label>Tipología<select name="tipology" required>${options(state.tips, 'Selecciona una tipología')}</select></label><label>Adjudicable a<select name="area" required>${options([...areas, 'Otra área'], 'Selecciona un área')}</select><small id="area-suggestion" role="status" aria-live="polite">Elige una tipología para ver el área sugerida.</small></label><label class="full hide" id="other-area">Otra área<input name="areaOther" maxlength="100" placeholder="Indica el área responsable"></label><label class="full">ID de auditoría<input name="auditOriginal" inputmode="numeric" pattern="[0-9]+" data-numeric required value="${esc(ticket.auditOriginal || '')}"></label><label class="full">Justificación o respuesta<textarea name="response" required minlength="5"></textarea></label><div class="full actions"><button class="primary">Confirmar dictamen</button></div></form>`);
    const form = $('#action-form');
    const updateOtherArea = () => {
      const other = form.elements.area.value === 'Otra área';
      $('#other-area').classList.toggle('hide', !other);
      form.elements.areaOther.required = other;
    };
    form.elements.tipology.onchange = () => {
      const suggestion = state.tipAreas[form.elements.tipology.value];
      $('#area-suggestion').textContent = suggestion
        ? `Sugerencia: ${suggestion}. Puedes cambiarla si corresponde.`
        : 'Sin sugerencia para esta tipología. Selecciona el área que corresponda.';
      form.elements.area.value = suggestion || '';
      updateOtherArea();
    };
    form.elements.area.onchange = updateOtherArea;
    if (ticket.tipology && state.tips.includes(ticket.tipology)) {
      form.elements.tipology.value = ticket.tipology;
      form.elements.tipology.onchange();
      if (ticket.area) {
        if (areas.includes(ticket.area)) form.elements.area.value = ticket.area;
        else { form.elements.area.value = 'Otra área'; form.elements.areaOther.value = ticket.area; }
      }
      updateOtherArea();
    }
    form.onsubmit = async event => { event.preventDefault(); await submit(form, () => {
      const payload = formData(form);
      if(ticket.manualEntry) {
        payload.pdv=String(payload.pdv||'').trim();payload.description=String(payload.description||'').trim();
        if(!/^\d{1,80}$/.test(payload.pdv))throw new Error('Completa el ID de PDV usando solo números antes de dictaminar.');
        if(payload.description.length<8||payload.description.length>12000)throw new Error('Completa la descripción de la solicitud (entre 8 y 12000 caracteres) antes de dictaminar.');
      }
      if (payload.area === 'Otra área') payload.area = payload.areaOther.trim();
      if (!payload.area) throw new Error('Selecciona o escribe el área responsable.');
      delete payload.areaOther;
      return action('dictate', ticket.id, payload);
    }); };
  }
  function assignRedigit(ticket) {
    const people = state.staff.redigitators.filter(person => person.active);
    const edition = requestType(ticket) === 'EDC';
    modal(`${edition ? 'Asignar edición' : 'Asignar redigitación'} · ${ticket.code}`, `<form id="action-form" class="stack">${edition ? '<div class="notice">Las ediciones solo pueden ser gestionadas por Validación.</div><input type="hidden" name="redigitType" value="Validación">' : '<label>Tipo<select name="redigitType"><option>Validación</option><option>Campo</option></select></label>'}<div id="validation-panel"><label>Redigitador de Validación<select name="personId" required><option value="">Selecciona una persona</option>${people.map(person => `<option value="${person.id}">${esc(person.name)}</option>`).join('')}</select></label></div>${edition ? '' : '<div id="field-panel" class="hide"><label>Persona de Campo<input name="fieldPerson" maxlength="100" placeholder="Nombre y apellido"></label></div>'}<div class="actions"><button class="primary">Confirmar responsable</button></div></form>`);
    const form = $('#action-form');
    if (!edition) {
      form.elements.redigitType.onchange = () => { const field = form.elements.redigitType.value === 'Campo'; $('#field-panel').classList.toggle('hide', !field); $('#validation-panel').classList.toggle('hide', field); form.elements.fieldPerson.required = field; form.elements.personId.required = !field; };
      form.elements.redigitType.onchange();
    }
    form.onsubmit = async event => { event.preventDefault(); await submit(form, () => action('assign_redigit', ticket.id, formData(form))); };
  }
  function redigit(ticket) {
    const edition = requestType(ticket) === 'EDC';
    modal(`${edition ? 'Confirmar edición' : 'Redigitar'} · ${ticket.code}`, `<p class="sub">${esc(ticket.redigitType || 'Validación')} · ${esc(ticket.fieldRedigitatorName || staffName('redigitador', ticket.redigitatorPersonId))}</p><form id="action-form" class="stack">${edition ? '<label>¿Se editó la auditoría?<select name="edited" required><option value="">Selecciona una respuesta</option><option value="yes">Sí, se editó</option><option value="no">No se editó</option></select></label><label>Comentario para Comercial<textarea name="comment" minlength="5" required></textarea></label>' : '<label>Nuevo número de auditoría<input name="audit" inputmode="numeric" pattern="[0-9]+" data-numeric required></label><label>Notas del cambio<textarea name="notes" minlength="5" required></textarea></label>'}<div class="actions"><button class="primary">${edition ? 'Finalizar y avisar a Comercial' : ticket.directRedigitation ? 'Registrar y cerrar' : 'Enviar a verificación'}</button></div></form>`);
    const form = $('#action-form'); form.onsubmit = async event => { event.preventDefault(); await submit(form, () => action(edition ? 'edit_complete' : 'redigit', ticket.id, formData(form))); };
  }
  function verify(ticket) {
    modal(`Verificar · ${ticket.code}`, `<div class="case-result"><p><strong>Nueva auditoría:</strong> ${esc(ticket.audit || '—')}</p><p>${esc(ticket.redigitNotes || '')}</p></div><form id="action-form" class="stack"><label>Resultado<select name="ok"><option value="yes">Aprobar y cerrar</option><option value="no">Devolver a redigitación</option></select></label><label>Comentario<textarea name="comment" minlength="5" required></textarea></label><div class="actions"><button class="primary">Confirmar resultado</button></div></form>`);
    const form = $('#action-form'); form.onsubmit = async event => { event.preventDefault(); await submit(form, () => action('verify', ticket.id, formData(form))); };
  }
  function feedback(ticket) {
    modal(`Calificar · ${ticket.code}`, '<form id="action-form" class="stack"><label>¿La solución fue satisfactoria?<select name="ok"><option value="yes">Sí</option><option value="no">No</option></select></label><label>Comentario<textarea name="comment"></textarea></label><button class="primary">Guardar</button></form>');
    const form = $('#action-form'); form.onsubmit = async event => { event.preventDefault(); await submit(form, () => action('feedback', ticket.id, formData(form))); };
  }
  function staffForm(role, person) {
    modal(`${person ? 'Editar' : 'Agregar'} ${role === 'validador' ? 'Analista de PQR' : 'Redigitador'}`, `<form id="action-form" class="stack"><label>Nombre<input name="name" required minlength="3" maxlength="100" value="${esc(person?.name || '')}"></label><div class="actions"><button class="primary">Guardar</button></div></form>`);
    const form = $('#action-form'); form.onsubmit = async event => { event.preventDefault(); await submit(form, async () => { const { error } = await db.rpc('pqr_admin_staff', { p_id: person?.id || null, p_role: role, p_name: formData(form).name, p_active: person?.active ?? true }); if (error) throw error; }); };
  }
  function editTipArea(tip) {
    modal(`Área sugerida · ${tip}`, `<p class="sub">Esta sugerencia aparecerá al seleccionar la tipología. El analista podrá escoger otra área para cada PQR.</p><form id="action-form" class="stack">${tipAreaFields('edit-tip')}<div class="actions"><button class="primary">Guardar sugerencia</button></div></form>`);
    const form = $('#action-form');
    form.elements.area.value = state.tipAreas[tip] || '';
    bindTipAreaFields(form, 'edit-tip');
    form.onsubmit = async event => { event.preventDefault(); await submit(form, async () => {
      const { error } = await db.rpc('pqr_admin_tip_area', { p_name: tip, p_area: chosenTipArea(form) });
      if (error) throw error;
    }); };
  }
  function userForm(person) {
    modal(person ? `Cuenta · ${person.name}` : 'Nuevo usuario', `<form id="action-form" class="stack"><label>Nombre<input name="name" required minlength="3" value="${esc(person?.name || '')}" ${person ? 'disabled' : ''}></label><label>Usuario<input name="username" required minlength="3" maxlength="32" autocomplete="username" value="${esc(person?.username || '')}"><small>Se escribe sin tildes ni ñ; el portal las convierte automáticamente.</small></label>${person ? '' : `<label>Rol<select name="role">${Object.entries(roles).filter(([role]) => role !== 'admin').map(([role, label]) => `<option value="${role}">${esc(label)}</option>`).join('')}</select></label>`}<label>${person ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}<input name="password" type="password" autocomplete="new-password" minlength="8" ${person ? '' : 'required'}><small>Mínimo 8 caracteres. No la compartas por correo.</small></label><div class="actions"><button class="primary">${person ? 'Guardar cambios' : 'Crear cuenta'}</button></div></form>`);
    const form = $('#action-form');
    form.elements.username.addEventListener('blur', () => { form.elements.username.value = usernameKey(form.elements.username.value); });
    form.onsubmit = async event => { event.preventDefault(); await submit(form, async () => {
      const values = formData(form);
      values.username = usernameKey(values.username);
      form.elements.username.value = values.username;
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(values.username)) throw new Error('El usuario debe tener entre 3 y 32 caracteres: letras sin tildes, números, punto, guion o guion bajo.');
      if (!person) await adminFunction({ action: 'create', ...values });
      else { if (values.username.trim().toLowerCase() !== person.username) await adminFunction({ action: 'rename', id: person.id, username: values.username }); if (values.password) await adminFunction({ action: 'set_password', id: person.id, password: values.password }); }
    }); };
  }
  function contactEmails(person) {
    if (!person) return;
    const addresses = state.contactEmails.filter(item => item.profile_id === person.id);
    modal(`Correos de aviso · @${person.username}`, `<p class="sub">Puedes vincular varios correos a esta cuenta compartida. Solo se usan para avisos; el ingreso continúa con usuario y contraseña.</p><div class="list">${addresses.length ? addresses.map(item => `<div class="list-item staff-item"><span>${esc(item.email)}</span><button class="danger" data-action="remove-contact-email" data-id="${esc(person.id)}" data-email="${esc(item.email)}">Quitar</button></div>`).join('') : '<p class="empty">Sin correos de aviso. Los eventos quedarán pendientes hasta que añadas uno.</p>'}</div><form id="contact-email-form" class="stack"><label>Añadir correo<input name="email" type="email" required maxlength="254" autocomplete="off" placeholder="nombre@empresa.com"></label><button class="primary">Añadir correo</button></form>`);
    const form = $('#contact-email-form');
    form.onsubmit = async event => { event.preventDefault(); await submit(form, async () => {
      const email = form.elements.email.value.trim().toLowerCase();
      const { error } = await db.from('pqr_contact_emails').insert({ profile_id: person.id, email });
      if (error) throw error;
    }); };
  }
  function credentials(person, temporaryPassword = '') {
    if (!person) return;
    const username = temporaryPassword ? temporaryPassword.username : person.username;
    modal(`Credenciales · @${username}`, `<div class="stack"><div class="credential-copy"><label>Usuario<input id="credential-username" value="${esc(username)}" readonly autocomplete="off"></label><button class="secondary" data-action="copy-username">Copiar usuario</button></div>${temporaryPassword ? `<div class="credential-copy"><label>Nueva contraseña temporal<input id="credential-password" value="${esc(temporaryPassword.password)}" readonly autocomplete="off" spellcheck="false"></label><button class="secondary" data-action="copy-temp-password">Copiar contraseña</button></div><p class="notice">Copia y entrega esta contraseña ahora. Al cerrar esta ventana no podrás volver a verla; si se pierde, tendrás que generar otra.</p>` : `<p class="notice">Por seguridad, no es posible consultar la contraseña actual. Si se olvidó, puedes reemplazarla por una nueva contraseña temporal.</p><div class="actions"><button class="primary" data-action="reset-credential" data-id="${esc(person.id)}">Generar nueva contraseña</button></div>`}</div>`);
  }
  async function copyCredential(inputId, button) {
    const input = $(inputId);
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.focus(); input.select();
      if (!document.execCommand('copy')) throw new Error('No se pudo copiar automáticamente. Selecciona el campo y cópialo manualmente.');
    }
    button.textContent = 'Copiado';
  }
  function passwordForm() {
    modal('Cambiar mi contraseña', '<form id="action-form" class="stack"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required><small>Mínimo 8 caracteres.</small></label><div class="actions"><button class="primary">Guardar contraseña</button></div></form>');
    const form = $('#action-form'); form.onsubmit = async event => { event.preventDefault(); await submit(form, async () => { const { error } = await db.auth.updateUser({ password: formData(form).password }); if (error) throw error; }); };
  }
  document.addEventListener('change', event => {
    const role = event.target?.dataset?.typeFilter;
    if (!role || role !== state.me?.role || !Object.hasOwn(listTypes, role)) return;
    listTypes[role] = event.target.value;
    renderView();
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const type = button.dataset.action; const ticket = [...state.tickets, ...state.deleted].find(item => item.id === button.dataset.id);
    const reportTicket = state.me?.role==='gerente'?managerTickets().find(item=>item.id===button.dataset.id):null;
    try {
      if (type === 'close') return closeModal();
      if(type==='workspace'&&window.PQRScopes.eligible(state.me?.role)){
        workspace=button.dataset.scope==='internal'?'internal':'external';
        history.replaceState(null,'',workspace==='internal'?'#gestion':'#clientes');
        for(const key of Object.keys(analystFilters))analystFilters[key]='all';
        for(const key of Object.keys(managerState))if(!['view','auditDimension'].includes(key))managerState[key]='all';
        auditLookup=window.PQRAudits?.empty();renderView();if(state.me.role==='gerente')await refreshAudits();return;
      }
      if (type === 'logout') { await db.auth.signOut(); state.me = null; return renderLogin(); }
      if (type === 'password') return passwordForm();
      if (type === 'notifications') {
        modal('Notificaciones', state.notifications.length ? `<div class="list">${state.notifications.map(item => `<div class="list-item"><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${fmt(item.created_at)}</small></div>`).join('')}</div>` : '<p class="empty">No tienes notificaciones.</p>');
        const unread = state.notifications.filter(item => !item.read).map(item => item.id);
        if (unread.length) await db.from('pqr_notifications').update({ read: true }).in('id', unread);
        return;
      }
      if (type === 'detail' && ticket) return detail(ticket);
      if (type === 'edit-manual-pqr' && ticket) return editManualPqr(ticket);
      if (type === 'reset-analyst-filters' && state.me.role === 'validador') { for(const key of Object.keys(analystFilters)) analystFilters[key]='all'; return analyst(); }
      if (state.me.role === 'gerente' && type === 'refresh-audits') return await refreshAudits();
      if (state.me.role === 'gerente' && type === 'audit-dimension') {
        const key=window.PQRAudits.dimension(button.dataset.auditDimension)?.key;
        if(!key)return;
        managerState.auditDimension=managerState.auditDimension===key?'':key;
        const cases=PQRReports.filterTickets(managerTickets(),managerState);
        $('.audit-explorer').outerHTML=window.PQRAudits.renderExplorer(cases,auditLookup,managerState.auditDimension);
        $('#audit-dimension-'+key)?.focus({preventScroll:true});
        return;
      }
      if (state.me.role === 'gerente' && type === 'export-audit-table') {
        const cases=PQRReports.filterTickets(managerTickets(),managerState);
        const analystLabel=$('#manager-analyst-filter')?.selectedOptions[0]?.textContent;
        const count=window.PQRAudits.exportTable(cases,auditLookup,button.dataset.auditDimension,{...managerState,analystLabel});
        $('.audit-export-status').textContent=`Archivo Excel generado con ${count} registros de la categoría y los filtros actuales.`;
        return;
      }
      if (type==='complete-data'&&reportTicket)return completeData(reportTicket);
      if (type==='reset-manager-filters'&&state.me.role==='gerente'){for(const key of Object.keys(managerState))if(!['view','auditDimension'].includes(key))managerState[key]='all';return dashboard();}
      if (state.me.role === 'gerente' && type === 'audit-detail' && reportTicket) return modal(`Auditoría · ${reportTicket.code}`, window.PQRAudits.detail(reportTicket,auditLookup));
      if (state.me.role === 'gerente' && type === 'load-ticket-audit' && reportTicket) {
        await refreshAudits([reportTicket]);
        return modal(`Auditoría · ${reportTicket.code}`, window.PQRAudits.detail(managerTickets().find(t=>t.id===reportTicket.id),auditLookup));
      }
      if (type === 'download-attachment' && ticket && button.dataset.file) return await downloadAttachment(ticket.id, button.dataset.file);
      if (type === 'new-ticket' || type === 'new-direct' || type === 'new-edit') return newTicket(type === 'new-ticket' ? 'PQR' : type === 'new-direct' ? 'RDG' : 'EDC');
      if (type === 'new-manual-pqr' && canCreateManualPqr()) return newTicket('PQR', true);
      if (type === 'assign-validator' && ticket) return assignValidator(ticket);
      if (type === 'dictate' && ticket) return dictate(ticket);
      if (type === 'assign-redigit' && ticket) return assignRedigit(ticket);
      if (type === 'redigit' && ticket) return redigit(ticket);
      if (type === 'verify' && ticket) return verify(ticket);
      if (type === 'feedback' && ticket) return feedback(ticket);
      if (type === 'reopen' && ticket) { const reason = prompt('Motivo de reapertura (mínimo 5 caracteres):'); if (reason) { await action('reopen', ticket.id, { reason }); await load(); } return; }
      if (type === 'delete' && ticket) { if (confirm(`¿Eliminar ${ticket.code}? Podrás restaurarlo desde Administración.`)) { await action('delete', ticket.id); await load(); } return; }
      if (type === 'restore' && ticket) { await action('restore', ticket.id); await load(); return; }
      if (type === 'new-user') return userForm(null);
      if (type === 'manager-view' && state.me.role === 'gerente') { managerState.view = button.dataset.managerView; dashboard(); return; }
      if (type === 'credentials' && state.me.role === 'admin') return credentials(state.users.find(person => person.id === button.dataset.id));
      if (type === 'contact-emails' && state.me.role === 'admin') return contactEmails(state.users.find(person => person.id === button.dataset.id));
      if (type === 'remove-contact-email' && state.me.role === 'admin') {
        if (!confirm(`¿Quitar ${button.dataset.email} de los avisos?`)) return;
        const { error } = await db.from('pqr_contact_emails').delete().eq('profile_id', button.dataset.id).eq('email', button.dataset.email);
        if (error) throw error;
        closeModal(); await load(); return;
      }
      if (type === 'copy-username' && state.me.role === 'admin') return await copyCredential('#credential-username', button);
      if (type === 'copy-temp-password' && state.me.role === 'admin') return await copyCredential('#credential-password', button);
      if (type === 'reset-credential' && state.me.role === 'admin') {
        const person = state.users.find(item => item.id === button.dataset.id);
        if (!person || !confirm(`Se reemplazará la contraseña actual de @${person.username}. ¿Quieres continuar?`)) return;
        button.disabled = true;
        try {
          const result = await adminFunction({ action: 'reset_password', id: person.id });
          credentials(person, result);
        } finally { button.disabled = false; }
        return;
      }
      if (type === 'edit-user') return userForm(state.users.find(person => person.id === button.dataset.id));
      if (type === 'edit-tip-area' && state.me.role === 'admin' && state.tips.includes(button.dataset.tip)) return editTipArea(button.dataset.tip);
      if (type === 'staff') return staffForm(button.dataset.role, [...state.staff.validators, ...state.staff.redigitators].find(person => person.id === button.dataset.person));
      if (type === 'toggle-staff') { const person = [...state.staff.validators, ...state.staff.redigitators].find(item => item.id === button.dataset.person); const { error } = await db.rpc('pqr_admin_staff', { p_id: person.id, p_role: person.role, p_name: person.name, p_active: !person.active }); if (error) throw error; await load(); return; }
      if (type === 'delete-tip') { if (confirm(`¿Eliminar la tipología «${button.dataset.tip}»?`)) { const { error } = await db.rpc('pqr_admin_tip', { p_name: button.dataset.tip, p_delete: true }); if (error) throw error; await load(); } return; }
      if (state.me.role === 'gerente' && ['export-pdf', 'export-summary', 'export-cases'].includes(type)) {
        const filter = managerState;
        let cases = PQRReports.filterTickets(managerTickets(), filter);
        if(filter.view==='pending')cases=cases.filter(t=>t.dataIssues.length);
        if (type === 'export-pdf') PQRReports.pdf(cases, state.users, state.staff, filter);
        if (type === 'export-summary') PQRReports.excelSummary(cases, state.users, state.staff,filter);
        if (type === 'export-cases') PQRReports.excelCases(cases, state.users, state.staff);
      }
    } catch (error) { showError(error); }
  });
  if (!db) { $('#app').innerHTML = '<main class="login-shell"><section class="login-card"><h1>Portal PQR</h1><p>No se pudo cargar la conexión segura. Recarga la página.</p></section></main>'; return; }
  window.addEventListener('hashchange',()=>{if(window.PQRNavigation.homeRoute(location.hash))renderHome();else if(location.hash==='#solicitud-interna')renderPublicInternal();else if(location.hash==='#consultar-ticket')renderPublicLookup();else{workspace=['#internas','#gestion'].includes(location.hash)?'internal':'external';load().catch(showError);}});
  load().catch(showError);
  setInterval(() => { document.querySelectorAll('[data-sla-due]').forEach(element => { const end = new Date(element.dataset.slaDue).getTime(); const minutes = Math.ceil(Math.abs(end - Date.now()) / 60000); element.classList.toggle('late', end < Date.now()); element.querySelector('strong').textContent = `${end < Date.now() ? 'Vencido hace' : 'Restan'} ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`; }); }, 60000);
})();
