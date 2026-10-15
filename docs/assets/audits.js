/* Enriquecimiento de auditorías. Nunca contiene credenciales de Databricks. */
window.PQRAudits = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id = value => /^\d{1,30}$/.test(String(value ?? '').trim()) ? String(value).trim() : '';
  const fields = [['ID_de_audito','ID de auditoría'],['ID_de_PDV','ID de PDV'],['Ola','Ola'],['pais','País'],['segmento','Segmento'],['canal','Canal'],['Fecha_del_audito','Fecha de auditoría'],['FechaInicioValidacion','Inicio de validación'],['Survey','Survey / estudio'],['ciudad','Ciudad'],['region','Región'],['nombre_usuario','Auditor de campo'],['Validador','Validador de auditoría'],['Estado','Estado en Databricks']];
  const type = t => t.requestType || (t.code?.startsWith('EDC-')?'EDC':t.directRedigitation||t.code?.startsWith('RDG-')?'RDG':'PQR');
  const empty = () => ({entries:{},loading:false,error:'',progress:'',checkedAt:null,loaded:false});
  function match(ticket,lookup,which='original') {
    const audit = id(which==='new'?ticket.audit:ticket.auditOriginal);
    if (!audit) return {status:'missing_id',label:'Sin ID de auditoría',rows:[]};
    const entry = lookup?.entries?.[audit];
    if (!entry) return {status:'pending',label:lookup?.loaded?'Pendiente de sincronización':'Sin consultar',rows:[]};
    const rows = entry.rows || [];
    return {status:rows.length===1?'found':rows.length?'ambiguous':'not_found',label:rows.length===1?'Con datos':rows.length?'Coincidencias múltiples':'Sin datos',rows,at:entry.at};
  }
  const unique = result => result.status==='found'?result.rows[0]:null;
  function stats(tickets,lookup) {
    const pqr = tickets.filter(t=>type(t)==='PQR');
    const result = {total:pqr.length,found:0,notFound:0,ambiguous:0,pending:0,missing:0,auditors:[],validators:[],cities:[],regions:[],channels:[],surveys:[]};
    const matches = [];
    for (const ticket of pqr) {
      const m=match(ticket,lookup);
      result[{found:'found',not_found:'notFound',ambiguous:'ambiguous',pending:'pending',missing_id:'missing'}[m.status]]++;
      if(m.status==='found'||ticket.auditData) matches.push({ticket,row:{...(m.status==='found'?m.rows[0]:{}),...(ticket.auditData||{}),pais:ticket.country||m.rows[0]?.pais,ID_de_audito:ticket.auditOriginal}});
    }
    for (const [key,field] of [['auditors','nombre_usuario'],['validators','Validador'],['cities','ciudad'],['regions','region'],['channels','canal'],['surveys','Survey']]) {
      const groups=new Map();
      for(const {ticket,row} of matches) {
        // Group locations by country to avoid merging e.g. cities with identical names.
        const base=String(row[field]||'Sin datos').trim()||'Sin datos';
        const name=['ciudad','region'].includes(field)?`${base} · ${row.pais||'Sin país'}`:base;
        if(!groups.has(name))groups.set(name,{name,count:0,aplica:0,noAplica:0,audits:new Set()});
        const group=groups.get(name);group.count++;if(id(row.ID_de_audito))group.audits.add(row.ID_de_audito);
        if(ticket.applies==='Aplica')group.aplica++;
        if(ticket.applies==='No Aplica')group.noAplica++;
      }
      result[key]=[...groups.values()].map(g=>({...g,audits:g.audits.size})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'es'));
    }
    return result;
  }
  function chart(title,rows,color) {
    const max=Math.max(...rows.map(r=>r.count),1);
    return `<article class="card manager-card"><div class="card-heading"><h2>${esc(title)}</h2><small>Top 10 · PQR radicadas</small></div>${rows.length?`<div class="bar-chart">${rows.slice(0,10).map(row=>`<div class="bar-row"><div class="bar-caption"><span>${esc(row.name)}</span><strong>${row.count}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,row.count/max*100)}%;background:${color}"></div></div><small>${row.audits} auditorías · ${row.aplica} aplican · ${row.noAplica} no aplican</small></div>`).join('')}</div>`:'<p class="empty-chart">Sin datos vinculados para esta selección.</p>'}</article>`;
  }
  function render(tickets,lookup=empty()) {
    const s=stats(tickets,lookup);
    const kpi=(label,value)=>`<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
    return `<section class="card audit-connection"><div class="staff-heading"><div><span class="eyebrow">DATABRICKS · AUDITORÍA ORIGINAL</span><h2>Análisis de origen de las PQR</h2><p class="sub">Cruce por ID de auditoría. Los gráficos usan Databricks, respaldo del Excel y correcciones manuales identificadas; los KPI de cruce distinguen su disponibilidad real. Ola desde 2026 y Survey KO o Lindley. Cortes a las 6:00 a. m. y 2:00 p. m. de Bogotá. No modifica los tickets.</p></div><button class="secondary" data-action="refresh-audits" ${lookup.loading?'disabled':''}>${lookup.loading?'Consultando…':'Actualizar panel'}</button></div><p class="audit-status" role="status" aria-live="polite">${esc(lookup.loading?lookup.progress:lookup.error|| (lookup.checkedAt?`Corte más antiguo mostrado: ${new Date(lookup.checkedAt).toLocaleString('es-CO')}`:lookup.loaded?'Sin corte disponible para estas auditorías; espera la siguiente sincronización.':'Pulsa «Actualizar panel» para leer el último corte de auditorías.'))}</p><p class="sub">Los rankings cuentan PQR, no RDG ni EDC, y usan la auditoría original. Una auditoría puede tener varias PQR. Es volumen de casos registrados, no una tasa de error sobre todas las auditorías.</p></section><section class="metrics dashboard-metrics audit-metrics">${kpi('PQR con datos',s.found)}${kpi('Sin datos en el origen',s.notFound)}${kpi('Sin ID de auditoría',s.missing)}${kpi('Por consultar',s.pending)}${kpi('Coincidencias múltiples',s.ambiguous)}</section><section class="manager-grid" aria-label="Estadísticas de auditoría">${chart('Auditores con más PQR',s.auditors,'#0d5cab')}${chart('Validadores con más PQR',s.validators,'#33bdee')}${chart('PQR por ciudad',s.cities,'#6d37a9')}${chart('PQR por región',s.regions,'#14a83b')}${chart('PQR por canal',s.channels,'#0d5cab')}${chart('PQR por Survey',s.surveys,'#33bdee')}</section>`;
  }
  function cell(ticket,lookup) {
    const m=match(ticket,lookup);
    return `<td class="audit-cell"><strong>${esc(ticket.auditOriginal||'Sin ID')}</strong><small>${esc(m.label)}${ticket.hasManualData?' · Datos manuales':''}</small><small>${ticket.origin==='historical'?'Histórico · Excel':'Plataforma'} · ${esc(ticket.reportingMonth||'Sin mes')}</small><button class="ghost" data-action="audit-detail" data-id="${esc(ticket.id)}">${ticket.origin==='historical'?'Ver PQR y auditoría':'Ver auditoría'}</button>${ticket.dataIssues?.length?`<button class="secondary" data-action="complete-data" data-id="${esc(ticket.id)}">Completar datos</button>`:''}</td>`;
  }
  function detail(ticket,lookup) {
    function panel(which,title) {
      const m=match(ticket,lookup,which),audit=which==='new'?ticket.audit:ticket.auditOriginal;
      const note=m.status==='not_found'?'No se encontró esta auditoría dentro del alcance: Ola desde 2026 y Survey KO o Lindley.':m.status==='pending'?'Esta auditoría aún no tiene un corte cargado. La sincronización se ejecuta a las 6:00 a. m. y 2:00 p. m. de Bogotá. «Consultar corte» solo relee los datos recibidos.':m.status==='ambiguous'?'Hay varias coincidencias para este ID. Se muestran todas y no se atribuye esta PQR en los rankings hasta aclarar la coincidencia.':m.label;
      return `<section class="audit-detail"><h3>${title} · ${esc(audit||'Sin ID')}</h3><p>${esc(note)}</p>${m.rows.map((row,i)=>`<h4>${m.rows.length>1?`Coincidencia ${i+1}`:'Datos de la auditoría'}</h4><dl class="audit-fields">${fields.map(([field,label])=>`<div><dt>${esc(label)}</dt><dd>${esc(row[field]||'Sin datos')}</dd></div>`).join('')}</dl>`).join('')}${m.at?`<small>Sincronizado: ${esc(new Date(m.at).toLocaleString('es-CO'))}</small>`:''}</section>`;
    }
    const legacy=ticket.origin==='historical'?`<section class="case-result"><h3>PQR histórica · ${esc(ticket.code)}</h3><p>Excel: BASE REQUERIDA PQR KO · fila ${esc(ticket.sourceRow)} · ID original ${esc(ticket.sourceId||'No indicado')}</p><p>${esc(ticket.country)} · ${esc(ticket.client)} · Mes analizado: ${esc(ticket.reportingMonth)} · Mes del Excel: ${esc(ticket.excelMonth)}</p><p><strong>${esc(ticket.status)} · ${esc(ticket.applies)}</strong></p><p>Analista: ${esc(ticket.analystName||'Sin dato')} · Tipificación: ${esc(ticket.tipology)} · Adjudicable a: ${esc(ticket.area)}</p><h4>Motivo</h4><p>${esc(ticket.description)}</p><h4>Respuesta</h4><p>${esc(ticket.response||'Sin dato')}</p><p>Fechas importadas sin reconstruir horas: solicitud ${esc(ticket.createdAt||'Sin dato')}; resolución ${esc(ticket.closedAt||'Sin dato')}. Excluida del promedio de SLA.</p></section>`:'';
    const fallback=ticket.auditData?`<section class="audit-detail"><h3>Datos utilizados en indicadores</h3><p class="sub">Databricks si cruza; respaldo del Excel y correcciones manuales cuando corresponda. No modifica la fuente.</p><dl class="audit-fields">${fields.filter(([f])=>['nombre_usuario','Validador','ciudad','region','canal'].includes(f)).map(([f,label])=>`<div><dt>${label}</dt><dd>${esc(ticket.auditData[f]||'Sin datos')}</dd></div>`).join('')}</dl>${ticket.correction?`<p>Última corrección: ${esc(new Date(ticket.correction.updated_at).toLocaleString('es-CO'))}. Motivo: ${esc(ticket.correction.reason)}</p>`:''}<button class="secondary" data-action="complete-data" data-id="${esc(ticket.id)}">Revisar / completar datos</button></section>`:'';
    return `${legacy}<p class="sub">Último corte de Databricks · Solo lectura · ${esc(ticket.code)}. El estado de Databricks es independiente del estado de la PQR.</p>${lookup?.error?`<p role="alert">${esc(lookup.error)}</p>`:''}<div class="actions"><button class="secondary" data-action="load-ticket-audit" data-id="${esc(ticket.id)}" ${lookup?.loading?'disabled':''}>Consultar corte</button></div>${panel('original','Auditoría original')}${id(ticket.audit)&&ticket.audit!==ticket.auditOriginal?panel('new','Nueva auditoría'):''}${fallback}`;
  }
  const exportRows = (tickets,lookup) => tickets.map(t=>{
    const original=match(t,lookup), latest=match(t,lookup,'new');
    return {ticket:t,original,latest};
  });
  return {empty,id,match,unique,stats,render,cell,detail,fields,exportRows};
})();
