/* Portal PQR oficial. La clave aquí es publicable; la autorización reside en RLS y funciones del servidor. */
(() => {
  'use strict';
  const URL = 'https://niwkegxwwwoahcbsoujy.supabase.co';
  const KEY = 'sb_publishable_YCNKUILCQOjMHOue4pkjRw_hf8TJJTT';
  const db = window.supabase?.createClient(URL, KEY, { auth: { detectSessionInUrl: false } });
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
  const managerState = { view: 'overview', country: 'all', study: 'all' };
  let state = { me: null, users: [], staff: { validators: [], redigitators: [] }, tips: [], tipAreas: {}, tickets: [], deleted: [], notifications: [] };
  let busy = false;

  function showError(error) {
    const message = error?.message || String(error) || 'No se pudo completar la operación.';
    console.error('Portal PQR:', message);
    const status = $('#login-message');
    if (status) status.textContent = message;
    else alert(message);
  }
  function badge(status) { const kind = ['Cerrado', 'No Aplica'].includes(status) ? 'ok' : ['Reabierto', 'Devuelto'].includes(status) ? 'danger' : 'warn'; return `<span class="badge ${kind}">${esc(status)}</span>`; }
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
    const { data: session } = await db.auth.getSession();
    if (!session.session) { state.me = null; renderLogin(); return; }
    const queries = await Promise.all([
      db.from('pqr_profiles').select('id,username,name,role,active').order('name'),
      db.from('pqr_staff').select('*').order('name'),
      db.from('pqr_tips').select('name,suggested_area').order('name'),
      db.from('pqr_tickets').select('id,deleted_at,data').order('created_at', { ascending: false }),
      db.from('pqr_notifications').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    for (const result of queries) if (result.error) throw result.error;
    const [profiles, staff, tips, cases, notifications] = queries.map(result => result.data);
    const me = profiles.find(person => person.id === session.session.user.id);
    if (!me?.active) { await db.auth.signOut(); state.me = null; renderLogin('Tu cuenta no está activa.'); return; }
    state = {
      me, users: profiles,
      staff: { validators: staff.filter(person => person.role === 'validador'), redigitators: staff.filter(person => person.role === 'redigitador') },
      tips: tips.map(item => item.name),
      tipAreas: Object.fromEntries(tips.map(item => [item.name, item.suggested_area || ''])),
      tickets: cases.filter(item => !item.deleted_at).map(item => item.data),
      deleted: cases.filter(item => item.deleted_at).map(item => ({ ...item.data, deletedAt: item.deleted_at })),
      notifications,
    };
    renderApp();
  }
  function renderLogin(message = '') {
    $('#app').innerHTML = $('#login-template').innerHTML;
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
    renderView();
  }
  function renderView() {
    const role = state.me.role;
    if (role === 'comercial') return commercial();
    if (role === 'validador') return analyst();
    if (role === 'redigitador') return redigitator();
    if (role === 'gerente') return dashboard();
    return admin();
  }
  function ticketTable(cases, role) {
    if (!cases.length) return '<section class="card empty">No hay casos en esta bandeja.</section>';
    return `<section class="card table-wrap"><table class="table ticket-table"><thead><tr><th>Radicado</th><th>Cliente / PDV</th><th>Estado</th><th>Asignación</th><th>Auditoría</th>${['validador', 'redigitador'].includes(role) ? '<th>Plazo SLA · 24 h</th>' : ''}<th>Acciones</th></tr></thead><tbody>${cases.map(ticket => `<tr><td><strong>${esc(ticket.code)}</strong>${ticket.directRedigitation ? ' <span class="badge direct-badge">Directa</span>' : ''}<br><small>${fmt(ticket.createdAt)}</small></td><td>${esc(ticket.client)}<br><small>${esc(ticket.pdv)} · ${esc(ticket.country)}</small></td><td>${badge(ticket.status)}${ticket.redigitType ? `<br><small>Redigitación de ${esc(ticket.redigitType.toLowerCase())}</small>` : ''}</td><td><small>Analista: ${esc(staffName('validador', ticket.validatorPersonId) || 'Sin asignar')}<br>Redig: ${esc(ticket.fieldRedigitatorName || staffName('redigitador', ticket.redigitatorPersonId) || 'Sin asignar')}</small></td><td>${ticket.audit ? `<small>ID: ${esc(ticket.auditOriginal || '—')}<br>Nueva: ${esc(ticket.audit)}</small>` : esc(ticket.auditOriginal || '—')}</td>${['validador', 'redigitador'].includes(role) ? `<td>${due(ticket, role)}</td>` : ''}<td><div class="actions"><button class="ghost" data-action="detail" data-id="${ticket.id}">Detalle</button>${ticketActions(ticket, role)}</div></td></tr>`).join('')}</tbody></table></section>`;
  }
  function ticketActions(ticket, role) {
    if (role === 'admin') return `<button class="danger" data-action="delete" data-id="${ticket.id}">Eliminar</button>`;
    if (role === 'validador') {
      let result = '';
      if (['Radicado', 'Reabierto', 'En Validación', 'Pendiente de Verificación'].includes(ticket.status)) result += `<button class="secondary" data-action="assign-validator" data-id="${ticket.id}">${ticket.validatorPersonId ? 'Reasignar' : 'Asignar'}</button>`;
      if (ticket.validatorPersonId && ['En Validación', 'Reabierto'].includes(ticket.status)) result += `<button class="primary" data-action="dictate" data-id="${ticket.id}">Dictaminar</button>`;
      if (ticket.validatorPersonId && ticket.status === 'Pendiente de Verificación') result += `<button class="primary" data-action="verify" data-id="${ticket.id}">Verificar</button>`;
      if (['Cerrado', 'No Aplica'].includes(ticket.status)) result += `<button class="danger" data-action="reopen" data-id="${ticket.id}">Reabrir</button>`;
      return result;
    }
    if (role === 'redigitador' && ['Pendiente de Redigitación', 'Devuelto'].includes(ticket.status)) return `<button class="secondary" data-action="assign-redigit" data-id="${ticket.id}">Asignar</button>${ticket.redigitatorPersonId || ticket.fieldRedigitatorName ? `<button class="primary" data-action="redigit" data-id="${ticket.id}">Redigitar</button>` : ''}`;
    if (role === 'comercial' && ticket.status === 'Cerrado' && !ticket.feedback) return `<button class="secondary" data-action="feedback" data-id="${ticket.id}">Calificar</button>`;
    return '';
  }
  function commercial() {
    const cases = state.tickets.filter(ticket => ticket.commercial === state.me.id);
    $('#view').innerHTML = `${header('Mis solicitudes', 'Radica una PQR o solicita redigitación directa.', '<button class="secondary" data-action="new-direct">Solicitar redigitación directa</button><button class="primary" data-action="new-ticket">Nueva PQR</button>')}<section class="metrics">${metric('Radicadas', cases.length)}${metric('En gestión', cases.filter(ticket => !['Cerrado', 'No Aplica'].includes(ticket.status)).length)}${metric('Cerradas', cases.filter(ticket => ['Cerrado', 'No Aplica'].includes(ticket.status)).length)}</section>${ticketTable(cases, 'comercial')}`;
  }
  function analyst() {
    const cases = state.tickets.filter(ticket => !ticket.directRedigitation);
    $('#view').innerHTML = `${header('Analistas de PQR', 'Asigna, dictamina, verifica redigitaciones y cierra casos.')}<section class="metrics">${metric('Total', cases.length)}${metric('Sin asignar', cases.filter(ticket => !ticket.validatorPersonId && ticket.status === 'Radicado').length)}${metric('Por verificar', cases.filter(ticket => ticket.status === 'Pendiente de Verificación').length)}${metric('Cerradas', cases.filter(ticket => ['Cerrado', 'No Aplica'].includes(ticket.status)).length)}</section>${ticketTable(cases, 'validador')}`;
  }
  function redigitator() {
    const cases = state.tickets.filter(ticket => ticket.redigitador === state.me.id);
    $('#view').innerHTML = `${header('Bandeja de redigitación', 'Elige Campo o Validación, asigna a la persona y registra la nueva auditoría.')}<section class="metrics">${metric('Total', cases.length)}${metric('Pendientes', cases.filter(ticket => ['Pendiente de Redigitación', 'Devuelto'].includes(ticket.status)).length)}${metric('Por verificar', cases.filter(ticket => ticket.status === 'Pendiente de Verificación').length)}${metric('Cerradas', cases.filter(ticket => ticket.status === 'Cerrado').length)}</section>${ticketTable(cases, 'redigitador')}`;
  }
  function dashboard() {
    $('#view').innerHTML = PQRReports.render(state.tickets, state.users, state.staff, managerState);
    $('#dashboard-status-filter')?.addEventListener('change', event => {
      let count = 0;
      document.querySelectorAll('[data-case-status]').forEach(row => { row.hidden = event.target.value !== 'all' && row.dataset.caseStatus !== event.target.value; if (!row.hidden) count++; });
      const label = $('#dashboard-filter-count'); if (label) label.textContent = `${count} de ${state.tickets.length} casos`;
    });
    $('#manager-country-filter')?.addEventListener('change', event => { managerState.country = event.target.value; managerState.study = 'all'; dashboard(); });
    $('#manager-study-filter')?.addEventListener('change', event => { managerState.study = event.target.value; dashboard(); });
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
    $('#view').innerHTML = `${header('Administración', 'Gestiona cuentas, responsables, tipologías y registros.', '<button class="secondary" data-action="new-user">Nuevo usuario</button>')}
      <section class="metrics">${metric('PQR radicadas', state.tickets.length)}${metric('Abiertas', state.tickets.filter(ticket => !['Cerrado', 'No Aplica'].includes(ticket.status)).length)}${metric('Cerradas', state.tickets.filter(ticket => ['Cerrado', 'No Aplica'].includes(ticket.status)).length)}${metric('Analistas activos', state.staff.validators.filter(person => person.active).length)}${metric('Redigitadores activos', state.staff.redigitators.filter(person => person.active).length)}</section>
      <section class="grid2 staff-grid">${staffCard('validador', 'Analistas de PQR')}${staffCard('redigitador', 'Redigitadores')}</section>
      ${ticketTable(state.tickets, 'admin')}
      ${state.deleted.length ? `<section class="card"><h3>Registros eliminados</h3><div class="list">${state.deleted.map(ticket => `<div class="list-item staff-item"><div><strong>${esc(ticket.code)}</strong><small>${esc(ticket.client)} · PDV ${esc(ticket.pdv)} · ${fmt(ticket.deletedAt)}</small></div><button class="secondary" data-action="restore" data-id="${ticket.id}">Restaurar</button></div>`).join('')}</div></section>` : ''}
      <section class="card accounts-card"><h3>Cuentas de acceso</h3><p class="sub">Ingreso solo con usuario y contraseña. Sin correos personales ni compartidos.</p><div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${state.users.map(person => `<tr><td>${esc(person.name)}</td><td>@${esc(person.username)}</td><td>${esc(roles[person.role])}</td><td>${person.active ? 'Activo' : 'Inactivo'}</td><td><button class="ghost" data-action="edit-user" data-id="${person.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></section>
      <section class="card tipologies-card"><div class="staff-heading"><div><h3>Tipologías</h3><p class="sub">Define el área sugerida para cada tipología. El analista podrá cambiarla en el dictamen.</p></div><span class="badge">${state.tips.length} registradas</span></div><div class="tipologies-grid">${state.tips.map(tip => `<div class="tipology-item"><strong>${esc(tip)}</strong><small>Área sugerida: ${esc(state.tipAreas[tip] || 'Sin sugerencia')}</small><div class="actions"><button class="secondary" data-action="edit-tip-area" data-tip="${esc(tip)}">Cambiar área</button><button class="ghost" data-action="delete-tip" data-tip="${esc(tip)}">Eliminar</button></div></div>`).join('')}</div><form id="tip-form" class="tip-add-form"><label>Nueva tipología<input name="name" placeholder="Nombre de la tipología" required maxlength="150"></label>${tipAreaFields('new-tip')}<button class="primary">Agregar tipología</button></form></section>`;
    const accounts = $('.accounts-card');
    accounts?.querySelectorAll('tbody tr').forEach((row, index) => {
      const person = state.users[index];
      const cell = row.lastElementChild;
      cell.classList.add('account-controls');
      cell.insertAdjacentHTML('afterbegin', `<button class="secondary" data-action="credentials" data-id="${esc(person.id)}">Credenciales</button>`);
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
  function options(values, placeholder = 'Selecciona una opción') { return `<option value="" disabled selected>${placeholder}</option>${values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`; }
  function newTicket(direct) {
    modal(direct ? 'Redigitación directa' : 'Nueva PQR', `<form id="case-form" class="form-grid"><label>ID de PDV<input name="pdv" inputmode="numeric" pattern="[0-9]+" data-numeric required></label><label>Cliente / estudio<select name="client" required>${options(clients)}</select></label><label class="full hide" id="other-client">¿Cuál otro?<input name="clientOther" maxlength="100"></label><label>País<select name="country" required>${options(countries)}</select></label>${direct ? '<label>ID de auditoría actual<input name="auditOriginal" inputmode="numeric" pattern="[0-9]+" data-numeric required></label>' : ''}<label class="full">Descripción<textarea name="description" required minlength="8"></textarea></label>${attachmentField()}<p class="full attachment-progress" id="upload-progress" role="status" aria-live="polite"></p><div class="full actions"><button class="primary">${direct ? 'Enviar a Redigitación' : 'Radicar PQR'}</button><button type="button" class="ghost" data-action="close">Cancelar</button></div></form>`);
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
        delete payload.attachments;
        delete payload.clientOther;
        payload.client = form.elements.client.value === 'Otros' ? form.elements.clientOther.value.trim() : form.elements.client.value;
        created = await action(direct ? 'direct_create' : 'create', null, payload);
        failures = await uploadAttachments(created, files, $('#upload-progress'));
      });
      if (created && failures.length) alert(`${created.code} se creó correctamente, pero no se pudieron cargar estos adjuntos: ${failures.join(', ')}. Abre Detalle para reintentarlo.`);
    };
  }
  function detail(ticket) {
    const events = ticket.timeline || [];
    const canAdd = state.me.role === 'comercial' && ticket.commercial === state.me.id && !ticket.deletedAt;
    modal(`Detalle · ${ticket.code}`, `<div class="case-result"><p><strong>Cliente:</strong> ${esc(ticket.client)} · <strong>País:</strong> ${esc(ticket.country)} · <strong>PDV:</strong> ${esc(ticket.pdv)}</p><p><strong>Auditoría original:</strong> ${esc(ticket.auditOriginal || '—')} · <strong>Nueva:</strong> ${esc(ticket.audit || '—')}</p><p><strong>Descripción:</strong> ${esc(ticket.description)}</p>${ticket.response ? `<p><strong>Respuesta:</strong> ${esc(ticket.response)}</p>` : ''}${ticket.redigitNotes ? `<p><strong>Redigitación:</strong> ${esc(ticket.redigitNotes)}</p>` : ''}</div><section class="attachments-section"><h3>Adjuntos</h3><div id="attachment-list" data-ticket="${esc(ticket.id)}" aria-live="polite">Cargando adjuntos…</div>${canAdd ? `<form id="add-attachments" class="stack">${attachmentField()}<p class="attachment-progress" id="upload-progress" role="status" aria-live="polite"></p><div class="actions"><button class="secondary">Añadir archivos</button></div></form>` : ''}</section><h3>Paso a paso</h3><div class="timeline">${events.length ? events.map(item => `<div class="list-item"><strong>${esc(item.action)}</strong><br><small>${fmt(item.at)} · ${esc(item.actor)}</small><p>${esc(item.detail)}</p></div>`).join('') : '<p class="empty">Sin eventos.</p>'}</div>`);
    loadAttachments(ticket.id);
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
    modal(`Dictaminar · ${ticket.code}`, `<p class="sub">Responsable: ${esc(staffName('validador', ticket.validatorPersonId))}</p><form id="action-form" class="form-grid"><label class="full">Resultado<select name="decision"><option value="no">No aplica · cerrar con justificación</option><option value="yes">Aplica · cerrar con respuesta</option><option value="redigit">Aplica · requiere redigitación</option></select></label><label>Tipología<select name="tipology" required>${options(state.tips, 'Selecciona una tipología')}</select></label><label>Adjudicable a<select name="area" required>${options([...areas, 'Otra área'], 'Selecciona un área')}</select><small id="area-suggestion" role="status" aria-live="polite">Elige una tipología para ver el área sugerida.</small></label><label class="full hide" id="other-area">Otra área<input name="areaOther" maxlength="100" placeholder="Indica el área responsable"></label><label class="full">ID de auditoría<input name="auditOriginal" inputmode="numeric" pattern="[0-9]+" data-numeric required value="${esc(ticket.auditOriginal || '')}"></label><label class="full">Justificación o respuesta<textarea name="response" required minlength="5"></textarea></label><div class="full actions"><button class="primary">Confirmar dictamen</button></div></form>`);
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
      if (payload.area === 'Otra área') payload.area = payload.areaOther.trim();
      if (!payload.area) throw new Error('Selecciona o escribe el área responsable.');
      delete payload.areaOther;
      return action('dictate', ticket.id, payload);
    }); };
  }
  function assignRedigit(ticket) {
    const people = state.staff.redigitators.filter(person => person.active);
    modal(`Asignar redigitación · ${ticket.code}`, `<form id="action-form" class="stack"><label>Tipo<select name="redigitType"><option>Validación</option><option>Campo</option></select></label><div id="validation-panel"><label>Redigitador<select name="personId"><option value="">Selecciona una persona</option>${people.map(person => `<option value="${person.id}">${esc(person.name)}</option>`).join('')}</select></label></div><div id="field-panel" class="hide"><label>Persona de Campo<input name="fieldPerson" maxlength="100" placeholder="Nombre y apellido"></label></div><div class="actions"><button class="primary">Confirmar responsable</button></div></form>`);
    const form = $('#action-form');
    form.elements.redigitType.onchange = () => { const field = form.elements.redigitType.value === 'Campo'; $('#field-panel').classList.toggle('hide', !field); $('#validation-panel').classList.toggle('hide', field); form.elements.fieldPerson.required = field; form.elements.personId.required = !field; };
    form.elements.redigitType.onchange();
    form.onsubmit = async event => { event.preventDefault(); await submit(form, () => action('assign_redigit', ticket.id, formData(form))); };
  }
  function redigit(ticket) {
    modal(`Redigitar · ${ticket.code}`, `<p class="sub">${esc(ticket.redigitType || 'Validación')} · ${esc(ticket.fieldRedigitatorName || staffName('redigitador', ticket.redigitatorPersonId))}</p><form id="action-form" class="stack"><label>Nuevo número de auditoría<input name="audit" inputmode="numeric" pattern="[0-9]+" data-numeric required></label><label>Notas del cambio<textarea name="notes" minlength="5" required></textarea></label><div class="actions"><button class="primary">${ticket.directRedigitation ? 'Registrar y cerrar' : 'Enviar a verificación'}</button></div></form>`);
    const form = $('#action-form'); form.onsubmit = async event => { event.preventDefault(); await submit(form, () => action('redigit', ticket.id, formData(form))); };
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
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const type = button.dataset.action; const ticket = [...state.tickets, ...state.deleted].find(item => item.id === button.dataset.id);
    try {
      if (type === 'close') return closeModal();
      if (type === 'logout') { await db.auth.signOut(); state.me = null; return renderLogin(); }
      if (type === 'password') return passwordForm();
      if (type === 'notifications') {
        modal('Notificaciones', state.notifications.length ? `<div class="list">${state.notifications.map(item => `<div class="list-item"><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${fmt(item.created_at)}</small></div>`).join('')}</div>` : '<p class="empty">No tienes notificaciones.</p>');
        const unread = state.notifications.filter(item => !item.read).map(item => item.id);
        if (unread.length) await db.from('pqr_notifications').update({ read: true }).in('id', unread);
        return;
      }
      if (type === 'detail' && ticket) return detail(ticket);
      if (type === 'download-attachment' && ticket && button.dataset.file) return await downloadAttachment(ticket.id, button.dataset.file);
      if (type === 'new-ticket' || type === 'new-direct') return newTicket(type === 'new-direct');
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
        const filter = managerState.view === 'details' ? managerState : { country: 'all', study: 'all' };
        const cases = PQRReports.filterTickets(state.tickets, filter);
        if (type === 'export-pdf') PQRReports.pdf(cases, state.users, state.staff, filter);
        if (type === 'export-summary') PQRReports.excelSummary(cases, state.users, state.staff);
        if (type === 'export-cases') PQRReports.excelCases(cases, state.users, state.staff);
      }
    } catch (error) { showError(error); }
  });
  if (!db) { $('#app').innerHTML = '<main class="login-shell"><section class="login-card"><h1>Portal PQR</h1><p>No se pudo cargar la conexión segura. Recarga la página.</p></section></main>'; return; }
  load().catch(showError);
  setInterval(() => { document.querySelectorAll('[data-sla-due]').forEach(element => { const end = new Date(element.dataset.slaDue).getTime(); const minutes = Math.ceil(Math.abs(end - Date.now()) / 60000); element.classList.toggle('late', end < Date.now()); element.querySelector('strong').textContent = `${end < Date.now() ? 'Vencido hace' : 'Restan'} ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`; }); }, 60000);
})();
