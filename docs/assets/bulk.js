/* Client-only manual batch intake. Source ticket IDs are distinct from portal radicados. */
window.PQRBulk=(()=>{
  const max=100;
  function generate(first,count){
    first=String(first??'').trim();count=Number(count);
    if(!Number.isInteger(count)||count<1||count>max)throw new Error('Elige entre 1 y 100 tickets.');
    const match=first.match(/^(.*?)([0-9]+)$/);
    if(!match)throw new Error('El primer ID debe terminar en un número, por ejemplo 7025 o TK-007025.');
    const ids=Array.from({length:count},(_,i)=>match[1]+String(BigInt(match[2])+BigInt(i)).padStart(match[2].length,'0'));
    if(ids.some(id=>id.length>100))throw new Error('Cada ID admite máximo 100 caracteres.');
    return ids;
  }
  function validate(ids){
    const values=ids.map(id=>String(id??'').trim());
    if(!values.length||values.length>max||values.some(id=>!id||id.length>100))throw new Error('Completa todos los IDs de ticket (máximo 100 caracteres cada uno).');
    if(new Set(values.map(id=>id.toLowerCase())).size!==values.length)throw new Error('Hay IDs repetidos en la lista. Corrígelos antes de guardar.');
    return values;
  }
  const bogotaInput=(value=Date.now())=>new Date(new Date(value).getTime()-5*3600000).toISOString().slice(0,16);
  function receipt(result,esc){
    return `<p>Se registraron ${result.tickets.length} PQR de clientes. El ID de PDV y la descripción se completarán antes de dictaminar.</p><div class="table-wrap"><table class="table"><thead><tr><th>ID de ticket de origen</th><th>Radicado del portal</th></tr></thead><tbody>${result.tickets.map(t=>`<tr><td>${esc(t.externalTicketId)}</td><td>${esc(t.code)}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="primary" data-action="close">Listo</button></div>`;
  }
  function open({allowed,clients,countries,esc,modal,save,onSuccess}){
    if(!allowed)return;
    const opts=items=>'<option value="" disabled selected>Selecciona una opción</option>'+items.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    modal('Añadir varias PQR de clientes',`<p class="sub">Registra de 1 a 100 tickets con los mismos datos. Los IDs de origen son editables; el portal asigna un radicado independiente a cada PQR.</p><form id="bulk-pqr-form" class="form-grid"><label>Cliente / estudio<select name="client" required>${opts(clients)}</select></label><label>País<select name="country" required>${opts(countries)}</select></label><label class="full hide" id="bulk-other-client">Otro estudio<input name="clientOther" maxlength="100"></label><label class="full">Fecha y hora de recepción de la PQR<input type="datetime-local" name="receivedAt" required min="2000-01-01T00:00" max="${bogotaInput()}" value="${bogotaInput()}"><small>Hora de Bogotá. El SLA inicial contará desde esta fecha, sin sábados ni domingos.</small></label><label>¿Cuántos tickets quieres añadir?<input name="count" type="number" required min="1" max="100" step="1" value="1"></label><label>ID del primer ticket de origen<input name="firstTicketId" required maxlength="100" placeholder="Ej. 7025 o TK-007025" autocomplete="off"></label><div class="actions full"><button type="button" class="secondary" id="bulk-generate">Preparar lista consecutiva</button></div><section class="full bulk-preview" id="bulk-preview" aria-label="Tickets por registrar"></section><p id="bulk-error" class="full sub" role="alert"></p><p id="bulk-status" class="full sub" role="status" aria-live="polite"></p><div class="full actions"><button class="primary" id="bulk-create" type="submit" disabled>Registrar PQR</button><button type="button" class="ghost" data-action="close">Cancelar</button></div></form>`);
    const form=document.querySelector('#bulk-pqr-form'),preview=form.querySelector('#bulk-preview'),error=form.querySelector('#bulk-error'),status=form.querySelector('#bulk-status'),create=form.querySelector('#bulk-create');
    const requestId=crypto.randomUUID();let spec='',saving=false;
    const signature=()=>JSON.stringify([form.elements.firstTicketId.value.trim(),form.elements.count.value]);
    const stale=()=>{if(saving)return;create.disabled=spec!==signature();status.textContent=spec&&spec!==signature()?'Cambiaste el primer ID o la cantidad. Vuelve a preparar la lista.':'';};
    form.elements.firstTicketId.oninput=stale;form.elements.count.oninput=stale;
    form.elements.client.onchange=()=>{const other=form.elements.client.value==='Otros';form.querySelector('#bulk-other-client').classList.toggle('hide',!other);form.elements.clientOther.required=other;};
    form.querySelector('#bulk-generate').onclick=()=>{
      error.textContent='';
      try{
        const ids=generate(form.elements.firstTicketId.value,form.elements.count.value);
        preview.innerHTML=`<h3>Revisa los ${ids.length} tickets</h3><p class="sub">Puedes cambiar cualquier ID antes de registrar. Preparar la lista otra vez reemplazará estas sugerencias.</p><div class="bulk-id-list">${ids.map((id,i)=>`<label>Ticket ${i+1}<input data-bulk-ticket required maxlength="100" autocomplete="off" value="${esc(id)}"></label>`).join('')}</div>`;
        spec=signature();create.disabled=false;create.textContent=`Registrar ${ids.length} PQR`;status.textContent='';
      }catch(e){error.textContent=e.message;create.disabled=true;}
    };
    form.onsubmit=async event=>{
      event.preventDefault();if(saving)return;error.textContent='';
      try{
        if(!spec||spec!==signature())throw new Error('Prepara y revisa la lista antes de registrar.');
        if(!form.reportValidity())return;
        const ids=validate([...form.querySelectorAll('[data-bulk-ticket]')].map(input=>input.value));
        const receivedAt=form.elements.receivedAt.value+'-05:00';
        if(!Number.isFinite(Date.parse(receivedAt))||Date.parse(receivedAt)>Date.now())throw new Error('La fecha de recepción no puede estar en el futuro.');
        const client=form.elements.client.value==='Otros'?form.elements.clientOther.value.trim():form.elements.client.value;
        const payload={scope:'external',client,country:form.elements.country.value,receivedAt,tickets:ids.map(externalTicketId=>({externalTicketId}))};
        saving=true;form.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);status.textContent='Registrando el lote completo. No vuelvas a enviarlo…';
        const result=await save(requestId,payload);
        await onSuccess(result);
      }catch(e){error.textContent=e.message;status.textContent='No se confirmó el registro. Puedes reintentar el mismo lote sin duplicarlo.';}
      finally{saving=false;form.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);stale();}
    };
  }
  return{generate,validate,bogotaInput,receipt,open};
})();
