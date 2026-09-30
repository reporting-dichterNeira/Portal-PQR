const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/assets/production.js', 'utf8');
const start = source.indexOf('  function attachmentField()');
const end = source.indexOf('  async function uploadAttachments', start);
assert(start >= 0 && end > start);
const helpers = vm.runInNewContext(`${source.slice(start, end)}; ({ attachmentField, bindAttachmentSelection, checkedAttachments })`, {
  esc: value => String(value).replace(/</g, '&lt;'),
  attachmentTypes: { png: 'image/png', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  maxAttachmentBytes: 10 * 1024 * 1024,
});

assert.match(helpers.attachmentField(), /type="file" multiple/);
const input = { files: [], value: '' };
const selection = { innerHTML: '', insertAdjacentHTML(_position, html) { this.innerHTML += html; } };
const pickerButton = {};
const form = {
  elements: { attachments: input },
  querySelector(selector) { return selector === '.attachment-selection' ? selection : pickerButton; },
};
helpers.bindAttachmentSelection(form);
const photo = { name: 'foto.png', size: 100, lastModified: 1, type: 'image/png' };
const spreadsheet = { name: 'datos.xlsx', size: 200, lastModified: 2, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
input.files = [photo];
input.onchange();
input.files = [spreadsheet];
input.onchange();
assert.deepEqual(Array.from(helpers.checkedAttachments(input), file => file.name), ['foto.png', 'datos.xlsx']);
assert.match(selection.innerHTML, /2 archivo\(s\)/);
input.files = [photo];
input.onchange();
assert.equal(input._selectedFiles.length, 2, 'no duplica el mismo archivo');
selection.onclick({ target: { closest: () => ({ dataset: { removeAttachment: '0' } }) } });
assert.deepEqual(Array.from(helpers.checkedAttachments(input), file => file.name), ['datos.xlsx']);
input.files = Array.from({ length: 10 }, (_, index) => ({ ...photo, name: `foto${index}.png` }));
input.onchange();
assert.equal(input._selectedFiles.length, 1, 'conserva la selección cuando se excede el límite');
assert.match(selection.innerHTML, /Máximo 10 archivos/);
console.log('Selección acumulativa, eliminación y límite de adjuntos: OK');
