/* Internal public intake: every row becomes a separate ticket, never a grouped case. */
window.PQRInternalBulk=(()=>{
  const max=50, fields=['pdv','description','auditOriginal'];
  const blank=()=>({pdv:'',description:'',auditOriginal:''});
  const text=value=>String(value??'').trim();
  function count(value){const n=Number(value);if(!Number.isInteger(n)||n<1||n>max)throw new Error('Indica entre 1 y 50 PDV.');return n;}
  // Excel TSV supports quoted tabs, quoted multiline cells and escaped quotes.
  function parse(value){
    value=String(value??'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    if(value.length>650000)throw new Error('El contenido pegado es demasiado grande.');
    const rows=[];let row=[],cell='',quoted=false,closed=false;
    const push=()=>{row.push(cell);cell='';closed=false;};
    for(let i=0;i<value.length;i++){
      const ch=value[i];
      if(quoted){if(ch==='"'){if(value[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
      if(ch==='"'&&!cell&&!closed){quoted=true;continue;}
      if(ch==='\t'){push();continue;}
      if(ch==='\n'){push();rows.push(row);row=[];continue;}
      if(closed)throw new Error('Revisa las comillas del contenido copiado de Excel.');
      cell+=ch;
    }
    if(quoted)throw new Error('Hay una celda de Excel con comillas sin cerrar.');
    push();rows.push(row);
    while(rows.length&&rows.at(-1).every(v=>!text(v)))rows.pop();
    if(!rows.length)throw new Error('Copia al menos una fila desde Excel.');
    return rows;
  }
  function paste(current,value,start=0,column='pdv'){
    let data=parse(value);
    const normalized=text(data[0][0]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
    if((column==='pdv'&&['idpdv','iddepdv','pdv'].includes(normalized))||(column==='description'&&normalized==='detalle')||(column==='auditOriginal'&&['idauditoria','iddeauditoria'].includes(normalized)))data=data.slice(1);
    if(!data.length)throw new Error('Solo copiaste los encabezados; incluye los datos.');
    if(start+data.length>max)throw new Error('Puedes pegar hasta 50 PDV por envío. No se cambió la lista.');
    if(data.some(row=>row.length>(column==='pdv'?3:1)))throw new Error('Pega ID de PDV y Detalle en la primera columna. La tercera columna puede ser el ID de auditoría.');
    const next=current.map(row=>({...row}));
    while(next.length<start+data.length)next.push(blank());
    data.forEach((row,i)=>row.forEach((value,j)=>{next[start+i][column==='pdv'?fields[j]:column]=text(value);}));
    return next;
  }
  function validate(rows,kind){
    count(rows.length);if(!['PQR','RDG','EDC'].includes(kind))throw new Error('Selecciona un tipo válido.');
    const seen=new Set();
    return rows.map((row,i)=>{
      const r=Object.fromEntries(fields.map(key=>[key,text(row[key])]));
      if(!/^[0-9]{1,80}$/.test(r.pdv))throw new Error(`Fila ${i+1}: completa un ID de PDV numérico, sin separadores ni notación científica.`);
      if((kind!=='PQR'||r.auditOriginal)&&!/^[0-9]{1,80}$/.test(r.auditOriginal))throw new Error(`Fila ${i+1}: completa el ID de auditoría numérico.`);
      if(r.description.length<8||r.description.length>12000)throw new Error(`Fila ${i+1}: el detalle debe tener entre 8 y 12.000 caracteres.`);
      const key=r.pdv+'|'+r.auditOriginal;if(seen.has(key))throw new Error(`Fila ${i+1}: el PDV y la auditoría están repetidos en este envío.`);seen.add(key);
      return r;
    });
  }
  function bind(form,esc){
    const anchor=form.querySelector('#public-pdv-label');
    anchor.insertAdjacentHTML('beforebegin',`<div class="full pdv-mode" role="group" aria-label="Cantidad de PDV"><button type="button" class="pdv-mode-button" data-pdv-mode="single" aria-pressed="true">Un único PDV</button><button type="button" class="pdv-mode-button" data-pdv-mode="multiple" aria-pressed="false">Múltiples PDV</button></div><section id="internal-multiple" class="full hide" aria-label="Solicitudes por PDV"><div class="bulk-pdv-controls"><label>¿Cuántos ID de PDV?<input name="pdvCount" type="number" min="1" max="50" step="1" value="10" disabled></label><button type="button" class="secondary" id="pdv-prepare" disabled>Preparar filas</button></div><p class="sub">Mismo estudio y país, un radicado por fila. Máximo 50 PDV por envío.</p><details class="pdv-paste-help"><summary>Pegar ID y detalles desde Excel</summary><label>Copia ID de PDV y Detalle en dos columnas<textarea id="pdv-excel" rows="3" placeholder="Pega aquí las filas copiadas de Excel" disabled></textarea></label><p class="sub">También puedes pegar directamente en cualquier celda de la lista. Una columna pega solo ese campo; dos columnas pegan ID y Detalle. La tercera puede contener el ID de auditoría.</p><button type="button" class="secondary" id="pdv-apply" disabled>Distribuir en las filas</button></details><p id="pdv-bulk-message" role="status" aria-live="polite"></p><div id="pdv-bulk-rows"></div><p class="sub">Los adjuntos de abajo se copiarán a cada solicitud. Máximo 100 MB en total contando todas las copias.</p></section>`);
    const section=form.querySelector('#internal-multiple'),output=section.querySelector('#pdv-bulk-rows'),message=section.querySelector('#pdv-bulk-message');
    const single=[anchor,form.querySelector('#public-audit-label'),form.elements.description.closest('label')];
    let active=false,rows=Array.from({length:10},blank);
    const capture=()=>output.querySelectorAll('[data-pdv-row]').forEach(row=>row.querySelectorAll('[data-pdv-field]').forEach(input=>{rows[Number(row.dataset.pdvRow)][input.dataset.pdvField]=input.value;}));
    const draw=()=>{
      const auditRequired=form.elements.kind.value!=='PQR';
      const audit=auditRequired||rows.some(row=>text(row.auditOriginal));
      output.innerHTML=`<div class="pdv-grid-head ${audit?'with-audit':''}" aria-hidden="true"><span>ID de PDV</span><span>Detalle</span>${audit?'<span>ID de auditoría</span>':''}</div>${rows.map((row,i)=>`<div class="pdv-grid-row ${audit?'with-audit':''}" data-pdv-row="${i}"><label><span class="pdv-cell-label">ID de PDV ${i+1}</span><input aria-label="ID de PDV ${i+1}" data-pdv-field="pdv" inputmode="numeric" pattern="[0-9]{1,80}" maxlength="80" required value="${esc(row.pdv)}" ${active?'':'disabled'}></label><label><span class="pdv-cell-label">Detalle ${i+1}</span><textarea aria-label="Detalle ${i+1}" data-pdv-field="description" minlength="8" maxlength="12000" rows="2" required ${active?'':'disabled'}>${esc(row.description)}</textarea></label>${audit?`<label><span class="pdv-cell-label">ID de auditoría ${i+1}</span><input aria-label="ID de auditoría ${i+1}" data-pdv-field="auditOriginal" inputmode="numeric" pattern="[0-9]{1,80}" maxlength="80" required value="${esc(row.auditOriginal)}" ${active?'':'disabled'}></label>`:''}</div>`).join('')}`;
      output.querySelectorAll('[data-pdv-field="auditOriginal"]').forEach(input=>input.required=auditRequired);
      output.querySelectorAll('[data-pdv-field]').forEach(input=>input.addEventListener('paste',event=>{
        const value=event.clipboardData?.getData('text/plain');if(!value)return;
        // A single cell stays a normal paste, including a quoted multiline Excel detail.
        event.preventDefault();capture();
        try{rows=paste(rows,value,Number(input.closest('[data-pdv-row]').dataset.pdvRow),input.dataset.pdvField);form.elements.pdvCount.value=rows.length;draw();message.textContent='Contenido de Excel distribuido. Revisa las filas antes de enviar.';}catch(error){message.textContent=error.message;}
      }));
      form.querySelector('button[type="submit"]').textContent=active?`Enviar ${rows.length} solicitudes internas`:'Enviar solicitud interna →';
    };
    const syncKind=()=>{
      if(active){capture();for(const label of single){label.classList.add('hide');label.querySelector('input,textarea').disabled=true;}draw();}
    };
    form.querySelectorAll('[data-pdv-mode]').forEach(button=>button.onclick=()=>{
      capture();active=button.dataset.pdvMode==='multiple';section.classList.toggle('hide',!active);
      form.querySelectorAll('[data-pdv-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      for(const label of single){label.classList.toggle('hide',active);label.querySelector('input,textarea').disabled=active;}
      section.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=!active);
      form.elements.pdvCount.required=active;draw();
    });
    section.querySelector('#pdv-prepare').onclick=()=>{
      capture();message.textContent='';
      try{const n=count(form.elements.pdvCount.value);if(n<rows.length&&rows.slice(n).some(row=>fields.some(key=>text(row[key]))))throw new Error('Hay datos en las filas que quitarías. Vacíalas o conserva esa cantidad.');while(rows.length<n)rows.push(blank());rows=rows.slice(0,n);draw();}catch(error){message.textContent=error.message;}
    };
    section.querySelector('#pdv-apply').onclick=()=>{
      capture();message.textContent='';
      try{rows=paste(rows,section.querySelector('#pdv-excel').value);form.elements.pdvCount.value=rows.length;draw();message.textContent='Filas distribuidas. Puedes editar cada ID y cada detalle.';}catch(error){message.textContent=error.message;}
    };
    draw();
    return {get active(){return active;},syncKind,read(){capture();if(count(form.elements.pdvCount.value)!==rows.length)throw new Error('Pulsa «Preparar filas» para aplicar la cantidad indicada.');return validate(rows,form.elements.kind.value);},restore(){for(const label of single)label.querySelector('input,textarea').disabled=active;section.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=!active);}};
  }
  function receipt(result,esc,failed=[]){
    return `<section class="card internal-receipt" role="status"><span class="eyebrow">SOLICITUDES INTERNAS REGISTRADAS</span><h1>${result.tickets.length} solicitudes individuales</h1><p>Cada PDV tiene su propio radicado y aparecerá por separado en la bandeja del equipo. Guarda esta lista para consultar cada caso.</p><div class="table-wrap"><table class="table"><thead><tr><th>ID de PDV</th><th>Radicado</th></tr></thead><tbody>${result.tickets.map(t=>`<tr><td>${esc(t.pdv)}</td><td><strong>${esc(t.code)}</strong></td></tr>`).join('')}</tbody></table></div>${failed.length?`<p role="alert">Los tickets se crearon, pero hubo problemas con adjuntos: ${failed.map(esc).join('; ')}. Entrega esos soportes al equipo con su radicado; no repitas el envío.</p>`:''}<div class="actions"><button type="button" class="secondary" id="download-internal-codes">Descargar radicados</button><button type="button" class="primary" id="another-internal">Enviar otra solicitud</button><a class="ghost module-link" href="#consultar-ticket">Consultar mi ticket</a></div></section>`;
  }
  function download(result){
    const content='ID de PDV\tRadicado\r\n'+result.tickets.map(t=>t.pdv+'\t'+t.code).join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='radicados-internos.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return {max,count,parse,paste,validate,bind,receipt,download};
})();
