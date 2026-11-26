const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function api(){const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/assets/internal-bulk.js','utf8'),c);return c.window.PQRInternalBulk;}
const plain=value=>JSON.parse(JSON.stringify(value));
test('Excel pega ID y detalles por fila sin perder ceros ni IDs grandes',()=>{
 const a=api(),rows=a.paste([], 'ID de PDV\tDetalle\r\n000123\tPrimera incidencia\r\n900719925474099312345\tSegunda incidencia\r\n');
 assert.deepEqual(plain(rows),[{pdv:'000123',description:'Primera incidencia',auditOriginal:'',priority:''},{pdv:'900719925474099312345',description:'Segunda incidencia',auditOriginal:'',priority:''}]);
 rows.forEach(r=>r.priority='1'); assert.equal(a.validate(rows,'PQR').length,2);
});
test('Excel conserva tabulaciones, saltos de línea y comillas dentro del detalle',()=>{
 const a=api(),rows=a.paste([],'123\t"Detalle con\nsegunda línea y ""comillas"" y\tuna tabulación"\n');
 assert.equal(rows[0].description,'Detalle con\nsegunda línea y "comillas" y\tuna tabulación');
 assert.throws(()=>a.parse('123\t"sin cerrar'),/sin cerrar/);
});
test('columnas independientes de ID o detalles se alinean desde la celda elegida',()=>{
 const a=api();let rows=a.paste([],'001\n002\n003');
 rows=a.paste(rows,'Detalle de uno\nDetalle de dos\nDetalle de tres',0,'description');
 rows=a.paste(rows,'Detalle cambiado',1,'description');
 assert.equal(rows[1].pdv,'002');assert.equal(rows[1].description,'Detalle cambiado');assert.equal(rows[2].description,'Detalle de tres');
 assert.throws(()=>a.paste(rows,'uno\tdos',0,'description'),/primera columna/);
});
test('tres tipos aceptan auditoría vacía al radicar y rechazan IDs inválidos',()=>{
 const a=api(),rows=a.paste([],'123\tDetalle de la solicitud\t987');
 rows[0].priority='1'; for(const kind of ['PQR','RDG','EDC'])assert.equal(a.validate(rows,kind)[0].auditOriginal,'987');
 for(const kind of ['PQR','RDG','EDC']) { assert.equal(a.validate([{pdv:'123',description:'Detalle válido',priority:'0'}],kind)[0].auditOriginal,''); assert.throws(()=>a.validate([{pdv:'123',description:'Detalle válido',priority:'0',auditOriginal:'abc'}],kind),/auditoría/); }
 assert.throws(()=>a.validate([{pdv:'123',description:'corto',priority:'1'}],'PQR'),/detalle/);
 assert.throws(()=>a.validate([{pdv:'1e12',description:'Detalle válido'}],'PQR'),/notación científica/);
 assert.throws(()=>a.validate([rows[0],rows[0]],'PQR'),/repetidos/);
});
test('cantidades, pegados y columnas fuera de límite no modifican la lista previa',()=>{
 const a=api(),rows=[{pdv:'001',description:'Detalle previo',auditOriginal:''}];
 assert.throws(()=>a.count(1001),/1000/);assert.throws(()=>a.count(1.5),/1000/);
 assert.throws(()=>a.paste(rows,Array(1001).fill('123').join('\n')),/1000/);
 assert.throws(()=>a.paste(rows,'123\tDetalle\t999\tcuarta'),/tercera/);
 assert.equal(rows[0].description,'Detalle previo');assert.equal(rows.length,1);
});
test('comprobante individual escapa contenido y la API mantiene el cliente anónimo aislado',()=>{
 const a=api(),esc=s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;');
 const html=a.receipt({tickets:[{pdv:'001',code:'PQR-INT-2026-0010'},{pdv:'<script>',code:'RDG-INT-2026-0011'}]},esc);
 assert.match(html,/2 solicitudes individuales/);assert.equal((html.match(/<tr>/g)||[]).length,3);assert.doesNotMatch(html,/<script>/);
 const app=fs.readFileSync('docs/assets/production.js','utf8');
 assert.match(app,/publicDb.rpc\('pqr_submit_internal_batch'/);assert.match(app,/internalAPI.submitBatch\(requestId,batch\)/);
 assert.match(app,/for\(const ticket of created.tickets\)/);assert.match(app,/uploadInternalAttachments\(ticket,files,null\)/);
 const index=fs.readFileSync('docs/index.html','utf8');assert.ok(index.indexOf('assets/internal-bulk.js')<index.indexOf('assets/production.js'));
});
