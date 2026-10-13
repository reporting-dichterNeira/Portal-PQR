const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('docs/assets/production.js', 'utf8');
const sheets = [], pdfText = [];
const XLSX = { utils: {
  book_new: () => ({}), aoa_to_sheet: rows => { sheets.push(rows); return {}; },
  book_append_sheet: () => {}, encode_col: () => 'Z',
}, writeFile: () => {} };
const doc = new Proxy({}, { get: (_, key) => key === 'getTextWidth' ? text => text.length : key === 'text' ? text => pdfText.push(text) : () => {} });
const context = vm.createContext({ window: { XLSX, jspdf: { jsPDF: function() { return doc; } } }, XLSX });
vm.runInContext(fs.readFileSync('docs/assets/reports.js', 'utf8'), context);
context.PQRReports = context.window.PQRReports;
context.esc = value => String(value ?? '');
context.requestType = () => 'PQR';
vm.runInContext(source.slice(source.indexOf('  function badge('), source.indexOf('  function metric(')) + source.slice(source.indexOf('  function ticketActions('), source.indexOf('  function commercial(')), context);
const ticket = { id: 'test', code: 'PQR-2026-0019', status: 'En Validación', validatorPersonId: 'analyst', client: 'KO tradicional', country: 'El Salvador', createdAt: '2026-10-13T16:46:00Z' };
const reports = context.PQRReports;

test('etiqueta nueva sin cambiar los estados internos ni las acciones', () => {
  assert.equal(reports.statusLabel(ticket.status), 'En revisión');
  for (const status of ['Cerrado', 'No Aplica', 'Pendiente de Verificación', 'En revisión']) assert.equal(reports.statusLabel(status), status);
  assert.match(context.badge(ticket.status), />En revisión<\/span>/);
  assert.match(context.ticketActions(ticket, 'validador'), /Reasignar/);
  assert.match(context.ticketActions(ticket, 'validador'), /Dictaminar/);
  assert.equal(reports.summarize([ticket]).statuses[0].name, 'En Validación');
  assert.equal(ticket.status, 'En Validación');
});

test('dashboard, gráfico y filtro muestran En revisión con filtros compatibles', () => {
  const html = reports.render([ticket], [], {});
  assert.match(html, /value="En Validación">En revisión \(1\)/);
  assert.match(html, /data-case-status="En Validación"/);
  assert.match(html, /<span>En revisión<\/span>/);
  assert.match(html, /<td>En revisión<\/td>/);
  assert.doesNotMatch(html, />En Validación</);
  const details = reports.render([ticket], [], {}, { view: 'details' });
  assert.match(details, /<td>En revisión<\/td>/);
  assert.doesNotMatch(details, />En Validación</);
});

test('Excel y PDF usan la misma etiqueta visible', () => {
  reports.excelSummary([ticket], [], {});
  assert.ok(sheets.at(-1).some(row => row[0] === 'En revisión' && row[1] === 1));
  reports.excelCases([ticket], [], {});
  const rows = sheets.at(-1);
  assert.equal(rows[1][rows[0].indexOf('Estado')], 'En revisión');
  reports.pdf([ticket], [], {});
  assert.ok(pdfText.includes('En revisión'));
  assert.ok(!pdfText.includes('En Validación'));
});
