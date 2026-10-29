const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync('docs/assets/production.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function portal(role = 'validador', users) {
  const calls = [], dialogs = [], errors = [], uploads = [];
  const view = { innerHTML: '', querySelector: () => ({insertAdjacentHTML(){}}) };
  const exports = { insertAdjacentHTML(_where, html) { this.html = html; } };
  const form = { elements: { attachments: {}, client: { value: 'Otros' }, clientOther: { value: 'Estudio especial' } } };
  const state = { me: { id: 'creator', role }, users: users || [
    { id: 'commercial', name: 'Cuenta Comercial', username: 'comercial', role: 'comercial', active: true },
    { id: 'inactive', name: 'Inactivo', username: 'inactivo', role: 'comercial', active: false },
    { id: 'creator', name: 'Analistas', username: 'analistas', role, active: true },
  ], tickets: [], staff: {} };
  const context = vm.createContext({analystSelection:new Set(),
    state, managerState: {}, analystFilters: {}, auditLookup: undefined, managerTickets:()=>[],
    workspace:'external',scopeTickets:()=>state.tickets,location:{hash:'#clientes'},window:{PQRNavigation:{homeRoute:()=>false},PQRScopes:{label:()=> 'PQR de clientes'}},
    esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    clients: ['KO tradicional', 'Otros'], countries: ['Colombia'],
    $: selector => selector === '#case-form' ? form : selector === '#view' ? view : selector === '.export-actions' ? exports : ['#view h1','#view .manager-title .sub'].includes(selector) ? {} : null,
    PQRReports: { render: () => '<div class="export-actions"></div>', filterTickets: tickets=>tickets, listFilters:()=>'' },
    document: {}, options: values => values.map(v => `<option>${v}</option>`).join(''),
    modal: (title, html) => dialogs.push({ title, html }),
    attachmentField: () => '<input name="attachments" type="file" multiple>',
    bindAttachmentSelection: () => {}, checkedAttachments: () => [{ name: 'foto.png' }, { name: 'datos.xlsx' }],
    formData: () => ({ pdv: '00123', externalTicketId: 'TK-00123', description: 'Solicitud recibida por correo', clientOther: 'extra', attachments: 'fake' }),
    submit: async (_form, task) => task(),
    uploadAttachments: async (ticket, files) => { uploads.push({ ticket, files }); return []; },
    showError: error => errors.push(error.message),
    action: async (name, _id, payload) => { calls.push({ name, payload }); return { id: 'ticket', code: 'PQR-2026-0001' }; },
    createSpecial: async (name, payload) => { calls.push({ name, payload }); return { id: 'ticket' }; },
    db: { rpc: async (name, payload) => { calls.push({ name, ...payload }); return { data: { id: 'manual-ticket', code: 'PQR-2026-0002' }, error: null }; } },
    alert: message => errors.push(message),
    header: (_title, _subtitle, actions = '') => actions,
    requestType: () => 'PQR', metric: () => '', ticketTable: () => '',
  });
  vm.runInContext(section('  const manualPqrRoles', '  let state') + section('  async function createManualPqr', '  async function adminFunction') + section('  function analyst()', '  function redigitator()') + section('  function dashboard()', '  function staffCard') + section('  function newTicket(', '  function detail('), context);
  return { context, calls, dialogs, errors, uploads, form, view, exports };
}

for (const role of ['validador', 'gerente']) {
  test(`${role}: radica con referencia de ticket, datos pendientes, trazabilidad y varios adjuntos`, async () => {
    const p = portal(role);
    vm.runInContext('newTicket("PQR", true)', p.context);
    const { html, title } = p.dialogs[0];
    assert.equal(title, 'Nueva PQR manual');
    assert.match(html, /ID de ticket \(opcional\)<input name="externalTicketId"/);
    assert.doesNotMatch(html, /name="commercialId"|name="commercialName"/);
    assert.doesNotMatch(html, /name="pdv"[^>]*required|name="description"[^>]*required/);
    assert.doesNotMatch(html, /Canal de recepción|name="source"/);
    assert.match(html, /ID de PDV \(opcional\)/);assert.match(html,/Descripción \(opcional\)/);
    assert.match(html, /data-numeric maxlength="80"/);
    assert.match(html, /type="file" multiple/);
    await p.form.onsubmit({ preventDefault() {} });
    assert.equal(p.calls[0].name, 'pqr_create_manual');
    assert.equal(p.calls[0].p_data.externalTicketId, 'TK-00123');
    assert.equal(p.calls[0].p_data.source, 'Otro');
    assert.ok(!('commercialId' in p.calls[0].p_data));
    assert.equal(p.calls[0].p_data.client, 'Estudio especial');
    assert.equal(p.calls[0].p_data.pdv, '00123');
    assert.ok(!('clientOther' in p.calls[0].p_data));
    assert.ok(!('attachments' in p.calls[0].p_data));
    assert.equal(p.uploads[0].ticket.id, 'manual-ticket');
    assert.equal(p.uploads[0].files.length, 2);
  });
}

test('Comercial conserva radicación propia; otros roles no pueden abrir el formulario manual', async () => {
  for (const role of ['comercial', 'redigitador', 'admin']) {
    const p = portal(role);
    vm.runInContext('newTicket("PQR", true)', p.context);
    assert.equal(p.dialogs.length, 0);
  }
  const commercial = portal('comercial');
  vm.runInContext('newTicket("PQR")', commercial.context);
  assert.doesNotMatch(commercial.dialogs[0].html, /name="commercialId"/);
  assert.match(commercial.dialogs[0].html,/name="pdv"[^>]*required/);
  assert.match(commercial.dialogs[0].html,/name="description"[^>]*required minlength="8"/);
  await commercial.form.onsubmit({ preventDefault() {} });
  assert.equal(commercial.calls[0].name, 'create');
  const analyst = portal();
  vm.runInContext('newTicket("RDG", true); newTicket("EDC", true)', analyst.context);
  assert.equal(analyst.dialogs.length, 0);
});

test('sin cuentas Comerciales permite radicar con PDV y descripción pendientes', async () => {
  const p = portal('gerente', []);
  p.context.formData = () => ({pdv:'',description:'',externalTicketId:''});
  vm.runInContext('newTicket("PQR", true)', p.context);
  assert.equal(p.dialogs.length, 1);
  await p.form.onsubmit({preventDefault(){}});
  assert.equal(p.errors.length, 0);
  assert.equal(p.calls[0].p_data.externalTicketId, '');assert.equal(p.calls[0].p_data.pdv, '');assert.equal(p.calls[0].p_data.description, '');
});

test('botón manual en Analistas y en ambas hojas de Gerencia', () => {
  const p = portal();
  vm.runInContext('analyst()', p.context);
  assert.match(p.view.innerHTML, /Nueva PQR manual/);
  vm.runInContext('state.me.role="gerente"; dashboard()', p.context);
  assert.match(p.exports.html, /data-action="new-manual-pqr"/);
  vm.runInContext('managerState.view="details"; dashboard()', p.context);
  assert.match(p.exports.html, /Nueva PQR manual/);
});

test('adjuntos solo para Comercial titular o creador manual con rol válido', () => {
  const p = portal();
  const ticket = { commercial: 'commercial', manualEntry: true, createdBy: 'creator' };
  p.context.ticket = ticket;
  assert.equal(vm.runInContext('canAddAttachments(ticket)', p.context), true);
  ticket.createdBy = 'someone-else';
  assert.equal(vm.runInContext('canAddAttachments(ticket)', p.context), false);
  ticket.createdBy = 'creator';
  ticket.manualEntry = false;
  assert.equal(vm.runInContext('canAddAttachments(ticket)', p.context), false);
  ticket.manualEntry = true;
  ticket.deletedAt = '2026-10-13';
  assert.equal(vm.runInContext('canAddAttachments(ticket)', p.context), false);
  delete ticket.deletedAt;
  p.context.state.me.role = 'redigitador';
  assert.equal(vm.runInContext('canAddAttachments(ticket)', p.context), false);
  p.context.state.me = { role: 'comercial', id: 'commercial' };
  assert.equal(vm.runInContext('canAddAttachments(ticket)', p.context), true);
});

test('PQR internas no permite radicación manual en Analistas, Gerencia ni invocación directa', async () => {
  for (const role of ['validador','gerente']) {
    const p = portal(role);
    p.context.workspace = 'internal';
    p.context.$ = selector => selector === '#view > .topline .sub' ? {} : selector === '#view' ? p.view : selector === '.export-actions' ? p.exports : selector === '#view h1' || selector === '#view .manager-title .sub' ? {} : null;
    vm.runInContext('analyst(); dashboard(); newTicket("PQR",true)',p.context);
    assert.doesNotMatch(p.view.innerHTML,/new-manual-pqr/);
    assert.equal(p.exports.html,undefined);
    assert.equal(p.dialogs.length,0);
    await assert.rejects(vm.runInContext('createManualPqr({scope:"internal"})',p.context),/solo está disponible en PQR de clientes/);
    assert.equal(p.calls.length,0);
  }
});

test('el campo libre no interpola nombres de cuentas registradas', () => {
  const p = portal('validador', [{ id: 'c', name: '<script>', username: 'c"', role: 'comercial', active: true }]);
  vm.runInContext('newTicket("PQR", true)', p.context);
  assert.match(p.dialogs[0].html, /name="externalTicketId"/);
  assert.doesNotMatch(p.dialogs[0].html, /<script>/);
});

test('Excel conserva el nombre libre, el vacío y los comerciales de casos anteriores', () => {
  let exported;
  const XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: rows => { exported = rows; return {}; }, book_append_sheet() {}, encode_col: () => 'Z' }, writeFile() {} };
  const context = vm.createContext({ window: {XLSX}, XLSX, Date, Intl, Set, Map });
  vm.runInContext(fs.readFileSync('docs/assets/reports.js','utf8'), context);
  context.window.PQRReports.excelCases([
    {code:'PQR-1',commercialName:'María externa'},
    {code:'PQR-2',commercialName:''},
    {code:'PQR-3',commercial:'c'},
    {code:'PQR-4',commercialName:'=SUM(A1:A2)'},
  ], [{id:'c',name:'Comercial anterior'}]);
  assert.equal(exported[1][3], 'María externa');
  assert.equal(exported[2][3], 'No indicado');
  assert.equal(exported[3][3], 'Comercial anterior');
  assert.equal(exported[4][3], "'=SUM(A1:A2)");
});
