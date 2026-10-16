/* Enriquecimiento de auditorías. Nunca contiene credenciales de Databricks. */
window.PQRAudits = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id = value => /^\d{1,30}$/.test(String(value ?? '').trim()) ? String(value).trim() : '';
  const fields = [['ID_de_audito','ID de auditoría'],['ID_de_PDV','ID de PDV'],['Ola','Ola'],['pais','País'],['segmento','Segmento'],['canal','Canal'],['Fecha_del_audito','Fecha de auditoría'],['FechaInicioValidacion','Inicio de validación'],['Survey','Survey / estudio'],['ciudad','Ciudad'],['region','Región'],['nombre_usuario','Auditor de campo'],['Validador','Validador de auditoría'],['Estado','Estado en Databricks']];
  const type = t => t.requestType || (t.code?.startsWith('EDC-')?'EDC':t.directRedigitation||t.code?.startsWith('RDG-')?'RDG':'PQR');
  const empty = () => ({entries:{},loading:false,error:'',progress:'',checkedAt:null,loaded:false});
  const normalized = value => String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const integrationExcluded = ticket => normalized(ticket.country)==='chile' && (
    /^ko[\s_-]*moderno(?:\b|_)/.test(normalized(ticket.client)) ||
    (normalized(ticket.client)==='ko' && normalized(ticket.auditFallback?.canal||ticket.auditData?.canal)==='moderno')
  );
  function match(ticket,lookup,which='original') {
    if(integrationExcluded(ticket))return {status:'excluded',label:'Sin integración: KO moderno Chile',rows:[]};
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
    const result = {total:pqr.length,found:0,notFound:0,ambiguous:0,pending:0,missing:0,excluded:0,auditors:[],validators:[],cities:[],regions:[],channels:[],surveys:[]};
    const matches = [];
    for (const ticket of pqr) {
      const m=match(ticket,lookup);
      result[{found:'found',not_found:'notFound',ambiguous:'ambiguous',pending:'pending',missing_id:'missing',excluded:'excluded'}[m.status]]++;
      if(m.status==='found'||ticket.auditData) matches.push({ticket,row:{...(m.status==='found'?m.rows[0]:{}),...(ticket.auditData||{}),pais:ticket.country||m.rows[0]?.pais,ID_de_audito:ticket.auditOriginal}});
    }
    for (const [key,field] of [['auditors','nombre_usuario'],['validators','Validador'],['cities','ciudad'],['regions','region'],['channels','canal'],['surveys','Survey']]) {
      const groups=new Map();
      for(const {ticket,row} of matches) {
        // Group locations by country to avoid merging e.g. cities with identical names.
        const base=String(field==='Survey'?(ticket.client||window.PQRHistory?.study(row.Survey)||row.Survey||''):row[field]||'').trim();
        if(!base)continue; // Unknown people/locations must not appear as ranked entities.
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
  const dimensions = [
    {key:'auditors',label:'Auditores',title:'Auditores con más PQR',column:'Auditor de campo',color:'#0d5cab',file:'auditores'},
    {key:'validators',label:'Validadores',title:'Validadores con más PQR',column:'Validador de auditoría',color:'#1696b5',file:'validadores'},
    {key:'cities',label:'Ciudad',title:'PQR por ciudad',column:'Ciudad / país',color:'#6d37a9',file:'ciudades'},
    {key:'regions',label:'Región',title:'PQR por región',column:'Región / país',color:'#16823a',file:'regiones'},
    {key:'channels',label:'Canal',title:'PQR por canal',column:'Canal',color:'#0d5cab',file:'canales'},
    {key:'surveys',label:'Estudio',title:'PQR por estudio',column:'Estudio',color:'#1696b5',file:'estudios'}
  ];
  const dimension = key => dimensions.find(item=>item.key===key);
  function explorer(s,key='',loading=false) {
    const selected=dimension(key),rows=selected?s[selected.key]:[];
    const headers=[selected?.column||'Categoría','PQR','Auditorías únicas','Aplican','No aplican','Sin dictamen'];
    return `<section class="card audit-explorer" aria-label="Explorar indicadores de auditoría"><div class="card-heading"><h2>Explorar indicadores</h2><small>Selecciona una categoría</small></div><div class="audit-dimension-buttons" role="group" aria-label="Categorías de auditoría">${dimensions.map(d=>`<button class="${d===selected?'primary':'ghost'}" id="audit-dimension-${d.key}" data-action="audit-dimension" data-audit-dimension="${d.key}" aria-expanded="${d===selected}" aria-controls="audit-breakdown-panel">${esc(d.label)}</button>`).join('')}</div><div id="audit-breakdown-panel" ${selected?`role="region" aria-labelledby="audit-dimension-${selected.key}"`:''}>${selected?`<div class="audit-breakdown-toolbar"><p class="sub">${loading?'Leyendo el último corte; espera para exportar. ':''}Gráfica: top 10. Tabla y exportación: ${rows.length} registros, sin limitar al top 10. Se respetan todos los filtros superiores.</p><div class="actions"><button class="secondary" data-action="export-audit-table" data-audit-dimension="${selected.key}" ${!rows.length||loading?'disabled':''}>Exportar tabla (Excel)</button><button class="ghost" data-action="audit-dimension" data-audit-dimension="${selected.key}">Ocultar</button></div></div><div class="audit-breakdown-layout">${chart(selected.title,rows,selected.color)}<div class="audit-ranking-table"><table class="table"><caption>${esc(selected.title)} · Tabla completa</caption><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${esc(r.name)}</th><td>${r.count}</td><td>${r.audits}</td><td>${r.aplica}</td><td>${r.noAplica}</td><td>${r.count-r.aplica-r.noAplica}</td></tr>`).join('')||'<tr><td colspan="6">Sin datos vinculados para esta selección.</td></tr>'}</tbody></table></div></div>`:'<p class="sub audit-explorer-empty">Pulsa un botón para desplegar su gráfica y consultar o exportar la tabla completa.</p>'}</div><p class="audit-export-status sub" role="status" aria-live="polite"></p></section>`;
  }
  const renderExplorer = (tickets,lookup,key='') => explorer(stats(tickets,lookup),key,lookup?.loading);
  function exportTable(tickets,lookup,key,filters={}) {
    const d=dimension(key);
    if(!d)throw new Error('Selecciona una categoría válida para exportar.');
    if(lookup?.loading)throw new Error('Espera a que termine la lectura del corte para exportar la tabla.');
    const rows=stats(tickets,lookup)[key];
    if(!rows.length)throw new Error('No hay datos de esta categoría para los filtros seleccionados.');
    const XLSX=window.XLSX;
    if(!XLSX)throw new Error('No está disponible el generador de Excel.');
    const filterValue=value=>!value||value==='all'?'Todos':value;
    const content=[
      [d.title],['Generado',new Date().toLocaleString('es-CO')],
      ['País',filterValue(filters.country)],['Estudio',filterValue(filters.study)],['Mes de auditoría',filterValue(filters.month)],
      ['Origen',filters.origin==='historical'?'Histórico (Excel)':filters.origin==='platform'?'Plataforma':'Todos'],
      ['Tipo de solicitud',filterValue(filters.type)],['Estado',filters.status==='En Validación'?'En revisión':filterValue(filters.status)],
      ['Analista de PQR',filterValue(filters.analystLabel||filters.analyst)],
      ['Alcance','Solo PQR por auditoría original. Incluye todos los registros de la categoría, no solo el top 10.'],
      ['Fuentes','Databricks, respaldo del Excel y correcciones manuales identificadas en el portal.'],
      ['Corte más antiguo del panel',lookup?.checkedAt?new Date(lookup.checkedAt).toLocaleString('es-CO'):'Sin corte disponible'],[]
    ];
    const headerRow=content.length;
    content.push([d.column,'PQR','Auditorías únicas','Aplican','No aplican','Sin dictamen']);
    content.push(...rows.map(r=>[r.name,r.count,r.audits,r.aplica,r.noAplica,r.count-r.aplica-r.noAplica]));
    const safe=content.map(row=>row.map(value=>typeof value==='string'&&/^[=+\-@]/.test(value)?`'${value}`:value));
    const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(safe);
    sheet['!cols']=[{wch:54},...Array.from({length:5},()=>({wch:20}))];
    sheet['!autofilter']={ref:`A${headerRow+1}:F${content.length}`};
    for(const cell of Object.values(sheet))if(cell?.t==='n')cell.z='#,##0';
    XLSX.utils.book_append_sheet(workbook,sheet,d.label);
    XLSX.writeFile(workbook,`PQR_${d.file}_${new Date().toISOString().slice(0,10)}.xlsx`);
    return rows.length;
  }
  function render(tickets,lookup=empty(),key='') {
    const s=stats(tickets,lookup);
    const kpi=(label,value)=>`<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
    return `<section class="card audit-connection"><div class="staff-heading"><div><span class="eyebrow">DATABRICKS · AUDITORÍA ORIGINAL</span><h2>Análisis de origen de las PQR</h2><p class="sub">Cruce por ID de auditoría. Los gráficos usan Databricks, respaldo del Excel y correcciones manuales identificadas; los KPI de cruce distinguen su disponibilidad real. Ola desde 2026 y Survey KO o Lindley. Cortes a las 6:00 a. m. y 2:00 p. m. de Bogotá. No modifica los tickets.</p></div><button class="secondary" data-action="refresh-audits" ${lookup.loading?'disabled':''}>${lookup.loading?'Consultando…':'Actualizar panel'}</button></div><p class="audit-status" role="status" aria-live="polite">${esc(lookup.loading?lookup.progress:lookup.error|| (lookup.checkedAt?`Corte más antiguo mostrado: ${new Date(lookup.checkedAt).toLocaleString('es-CO')}`:lookup.loaded?'Sin corte disponible para estas auditorías; espera la siguiente sincronización.':'Pulsa «Actualizar panel» para leer el último corte de auditorías.'))}</p><p class="sub">Los rankings cuentan PQR, no RDG ni EDC, y usan la auditoría original. Una auditoría puede tener varias PQR. Es volumen de casos registrados, no una tasa de error sobre todas las auditorías.</p></section><section class="metrics dashboard-metrics audit-metrics">${kpi('PQR con datos',s.found)}${kpi('Sin datos en el origen',s.notFound)}${kpi('Sin ID de auditoría',s.missing)}${kpi('Por consultar',s.pending)}${kpi('Coincidencias múltiples',s.ambiguous)}${kpi('Sin integración · Chile moderno',s.excluded)}</section>${explorer(s,key,lookup.loading)}`;
  }
  function cell(ticket,lookup) {
    const m=match(ticket,lookup);
    return `<td class="audit-cell"><strong>${esc(ticket.auditOriginal||'Sin ID')}</strong><small>${esc(m.label)}${ticket.hasManualData?' · Datos manuales':''}</small><small>${ticket.origin==='historical'?'Histórico · Excel':'Plataforma'} · ${esc(ticket.reportingMonth||'Sin mes')}</small><button class="ghost" data-action="audit-detail" data-id="${esc(ticket.id)}">${ticket.origin==='historical'?'Ver PQR y auditoría':'Ver auditoría'}</button>${ticket.dataIssues?.length?`<button class="secondary" data-action="complete-data" data-id="${esc(ticket.id)}">Completar datos</button>`:''}</td>`;
  }
  function detail(ticket,lookup) {
    function panel(which,title) {
      const m=match(ticket,lookup,which),audit=which==='new'?ticket.audit:ticket.auditOriginal;
      const note=m.status==='excluded'?'KO moderno de Chile no tiene integración con Databricks. El ticket sigue incluido en los indicadores generales.':m.status==='not_found'?'No se encontró esta auditoría dentro del alcance: Ola desde 2026 y Survey KO o Lindley.':m.status==='pending'?'Esta auditoría aún no tiene un corte cargado. La sincronización se ejecuta a las 6:00 a. m. y 2:00 p. m. de Bogotá. «Consultar corte» solo relee los datos recibidos.':m.status==='ambiguous'?'Hay varias coincidencias para este ID. Se muestran todas y no se atribuye esta PQR en los rankings hasta aclarar la coincidencia.':m.label;
      return `<section class="audit-detail"><h3>${title} · ${esc(audit||'Sin ID')}</h3><p>${esc(note)}</p>${m.rows.map((row,i)=>`<h4>${m.rows.length>1?`Coincidencia ${i+1}`:'Datos de la auditoría'}</h4><dl class="audit-fields">${fields.map(([field,label])=>`<div><dt>${esc(label)}</dt><dd>${esc(row[field]||'Sin datos')}</dd></div>`).join('')}</dl>`).join('')}${m.at?`<small>Sincronizado: ${esc(new Date(m.at).toLocaleString('es-CO'))}</small>`:''}</section>`;
    }
    const legacy=ticket.origin==='historical'?`<section class="case-result"><h3>PQR histórica · ${esc(ticket.code)}</h3><p>Excel: BASE REQUERIDA PQR KO · fila ${esc(ticket.sourceRow)} · ID original ${esc(ticket.sourceId||'No indicado')}</p><p>${esc(ticket.country)} · ${esc(ticket.client)} · Mes analizado: ${esc(ticket.reportingMonth)} · Mes del Excel: ${esc(ticket.excelMonth)}</p><p><strong>${esc(ticket.status)} · ${esc(ticket.applies)}</strong></p><p>Analista: ${esc(ticket.analystName||'Sin dato')} · Tipificación: ${esc(ticket.tipology)} · Adjudicable a: ${esc(ticket.area)}</p><h4>Motivo</h4><p>${esc(ticket.description)}</p><h4>Respuesta</h4><p>${esc(ticket.response||'Sin dato')}</p><p>Fechas importadas sin reconstruir horas: solicitud ${esc(ticket.createdAt||'Sin dato')}; resolución ${esc(ticket.closedAt||'Sin dato')}. Excluida del promedio de SLA.</p></section>`:'';
    const fallback=ticket.auditData?`<section class="audit-detail"><h3>Datos utilizados en indicadores</h3><p class="sub">Databricks si cruza; respaldo del Excel y correcciones manuales cuando corresponda. No modifica la fuente.</p><dl class="audit-fields">${fields.filter(([f])=>['nombre_usuario','Validador','ciudad','region','canal'].includes(f)).map(([f,label])=>`<div><dt>${label}</dt><dd>${esc(ticket.auditData[f]||'Sin datos')}</dd></div>`).join('')}</dl>${ticket.correction?`<p>Última corrección: ${esc(new Date(ticket.correction.updated_at).toLocaleString('es-CO'))}. Motivo: ${esc(ticket.correction.reason)}</p>`:''}<button class="secondary" data-action="complete-data" data-id="${esc(ticket.id)}">Revisar / completar datos</button></section>`:'';
    return `${legacy}<p class="sub">Último corte de Databricks · Solo lectura · ${esc(ticket.code)}. El estado de Databricks es independiente del estado de la PQR.</p>${lookup?.error?`<p role="alert">${esc(lookup.error)}</p>`:''}<div class="actions"><button class="secondary" data-action="load-ticket-audit" data-id="${esc(ticket.id)}" ${lookup?.loading||integrationExcluded(ticket)?'disabled':''}>Consultar corte</button></div>${panel('original','Auditoría original')}${id(ticket.audit)&&ticket.audit!==ticket.auditOriginal?panel('new','Nueva auditoría'):''}${fallback}`;
  }
  const exportRows = (tickets,lookup) => tickets.map(t=>{
    const original=match(t,lookup), latest=match(t,lookup,'new');
    return {ticket:t,original,latest};
  });
  return {empty,id,match,unique,stats,render,renderExplorer,dimension,exportTable,cell,detail,fields,exportRows,integrationExcluded};
})();
