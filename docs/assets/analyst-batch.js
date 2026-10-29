/* Shared validation for assigning and ruling on selected PQR. No network or session data. */
(() => {
  'use strict';
  const MAX=100;
  const eligible=t=>!t.deletedAt && (t.requestType || (t.code?.startsWith('EDC-')?'EDC':t.directRedigitation||t.code?.startsWith('RDG-')?'RDG':'PQR'))==='PQR' && ['Radicado','En Validación','Reabierto'].includes(t.status);
  function prepare(tickets,operation,common,edits={}) {
    if(!['assign','dictate'].includes(operation))throw Error('Acción múltiple inválida.');
    if(!tickets.length||tickets.length>MAX)throw Error(`Selecciona entre 1 y ${MAX} PQR.`);
    if(new Set(tickets.map(t=>t.id)).size!==tickets.length)throw Error('Hay PQR repetidas en la selección.');
    if(new Set(tickets.map(t=>t.scope||'external')).size!==1)throw Error('Selecciona PQR de una sola bandeja.');
    if(!common.personId)throw Error('Selecciona el analista responsable de todas las PQR.');
    const data={personId:common.personId};
    if(operation==='dictate'){
      if(!['no','yes','redigit'].includes(common.decision))throw Error('Selecciona el resultado.');
      data.decision=common.decision;data.tipology=String(common.tipology||'').trim();
      data.area=String(common.area==='Otra área'?common.areaOther||'':common.area||'').trim();
      data.response=String(common.response||'').trim();
      if(!data.tipology||!data.area||data.area.length>100)throw Error('Completa la tipología y el área responsable.');
      if(data.response.length<5||data.response.length>12000)throw Error('La respuesta debe tener entre 5 y 12000 caracteres.');
    }
    const items=tickets.map(t=>{
      if(!eligible(t)||!t.recordUpdatedAt)throw Error(`${t.code}: actualiza la bandeja; la PQR no está disponible para esta acción.`);
      const item={id:t.id,expectedUpdatedAt:t.recordUpdatedAt};
      if(operation==='dictate'){
        const e=edits[t.id]||{};
        item.auditOriginal=String(e.auditOriginal??t.auditOriginal??'').trim();
        if(!/^\d{1,80}$/.test(item.auditOriginal))throw Error(`${t.code}: completa su ID de auditoría usando solo números.`);
        if(t.manualEntry){
          item.pdv=String(e.pdv??t.pdv??'').trim();item.description=String(e.description??t.description??'').trim();
          if(!/^\d{1,80}$/.test(item.pdv)||item.description.length<8||item.description.length>12000)throw Error(`${t.code}: completa su PDV y la descripción de la radicación.`);
        }
      }
      return item;
    });
    return {p_operation:operation,p_items:items,p_data:data};
  }
  window.PQRAnalystBatch={MAX,eligible,prepare};
})();
