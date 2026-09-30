/* Resumen gerencial y descargas del portal oficial. */
window.PQRReports = (() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const closedStatuses = new Set(['Cerrado','No Aplica']);
  const requestType = ticket => ticket.requestType || (ticket.code?.startsWith('EDC-') ? 'EDC' : ticket.directRedigitation || ticket.code?.startsWith('RDG-') ? 'RDG' : 'PQR');
  const requestLabels = {PQR:'PQR',RDG:'Redigitación',EDC:'Edición'};
  const fmt = value => new Intl.NumberFormat('es-CO').format(value);
  const pct = (part,total) => total ? Math.round(part / total * 100) : 0;
  const asDate = value => value ? new Date(value).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'}) : '';
  const group = (items, field) => {
    const counts = new Map();
    for (const item of items) {
      const label = String(item[field] || 'Sin clasificar').trim();
      counts.set(label,(counts.get(label)||0)+1);
    }
    return [...counts].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'es'));
  };
  const filterTickets = (tickets,filters={}) => tickets.filter(t => (filters.country==='all'||!filters.country||t.country===filters.country) && (filters.study==='all'||!filters.study||t.client===filters.study) && (filters.type==='all'||!filters.type||requestType(t)===filters.type));
  const breakdown = (tickets,field) => group(tickets,field).map(({name})=>{
    const own=tickets.filter(t=>String(t[field]||'Sin clasificar').trim()===name);
    const closed=own.filter(t=>closedStatuses.has(t.status)).length;
    return {name,total:own.length,closed,open:own.length-closed,aplica:own.filter(t=>t.applies==='Aplica').length,noAplica:own.filter(t=>t.applies==='No Aplica').length,rate:pct(closed,own.length)};
  });
  const trend = tickets => {
    const counts=new Map();
    for(const t of tickets){if(!t.createdAt)continue;const key=String(t.createdAt).slice(0,10);counts.set(key,(counts.get(key)||0)+1)}
    return [...counts].sort((a,b)=>a[0].localeCompare(b[0])).slice(-10).map(([name,count])=>({name:new Date(`${name}T12:00:00`).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}),count}));
  };

  function summarize(tickets,users=[],staff={}) {
    const decided=tickets.filter(t=>t.applies==='Aplica'||t.applies==='No Aplica');
    const aplica=decided.filter(t=>t.applies==='Aplica').length;
    const noAplica=decided.filter(t=>t.applies==='No Aplica').length;
    const closed=tickets.filter(t=>closedStatuses.has(t.status));
    const open=tickets.length-closed.length;
    const closureHours=closed.filter(t=>t.createdAt&&t.closedAt).map(t=>(new Date(t.closedAt)-new Date(t.createdAt))/36e5).filter(x=>Number.isFinite(x)&&x>=0);
    const avgClosure=closureHours.length ? Math.round(closureHours.reduce((a,b)=>a+b,0)/closureHours.length*10)/10 : null;
    const knownValidators=staff.validators||[];
    const validatorIds=new Set([...knownValidators.map(p=>p.id),...tickets.map(t=>t.validatorPersonId).filter(Boolean)]);
    const validators=[...validatorIds].map(personId=>{
      const own=tickets.filter(t=>t.validatorPersonId===personId);
      const person=knownValidators.find(p=>p.id===personId);
      return {name:person?.name||'Responsable histórico',active:person?.active!==false,assigned:own.length,decided:own.filter(t=>t.applies).length,closed:own.filter(t=>closedStatuses.has(t.status)).length};
    }).sort((a,b)=>b.assigned-a.assigned||a.name.localeCompare(b.name,'es'));
    const knownRedigitators=staff.redigitators||[];
    const redigitatorIds=new Set([...knownRedigitators.map(p=>p.id),...tickets.map(t=>t.redigitatorPersonId).filter(Boolean)]);
    const redigitators=[...redigitatorIds].map(personId=>{
      const own=tickets.filter(t=>t.redigitatorPersonId===personId);
      const person=knownRedigitators.find(p=>p.id===personId);
      return {name:person?.name||'Responsable histórico',active:person?.active!==false,assigned:own.length,completed:own.filter(t=>t.redigitAt).length,closed:own.filter(t=>t.status==='Cerrado').length};
    }).sort((a,b)=>b.assigned-a.assigned||a.name.localeCompare(b.name,'es'));
    return {
      total:tickets.length,open,closed:closed.length,decided:decided.length,aplica,noAplica,
      redigit:tickets.filter(t=>['Pendiente de Redigitación','Devuelto'].includes(t.status)).length,
      verification:tickets.filter(t=>t.status==='Pendiente de Verificación').length,
      redigitRequired:tickets.filter(t=>t.redigitAssignedAt).length,
      adjudicable:decided.filter(t=>t.area).length,
      avgClosure,tipologies:group(decided,'tipology'),areas:group(decided,'area'),
      statuses:group(tickets,'status'),countries:group(tickets,'country'),studies:group(tickets,'client'),
      direct:tickets.filter(t=>t.directRedigitation).length,fieldRedigit:tickets.filter(t=>t.redigitType==='Campo').length,
      validators,redigitators
    };
  }

  function metric(label,value,note='') {
    return `<div class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong>${note?`<small>${escapeHtml(note)}</small>`:''}</div>`;
  }
  function bars(rows,color) {
    if (!rows.length) return '<p class="empty-chart">No hay datos para esta selección.</p>';
    const max=Math.max(...rows.map(row=>row.count),1);
    return `<div class="bar-chart">${rows.slice(0,8).map(row=>`<div class="bar-row"><div class="bar-caption"><span>${escapeHtml(row.name)}</span><strong>${fmt(row.count)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,row.count/max*100)}%;background:${color}"></div></div></div>`).join('')}</div>`;
  }
  function decisionChart(summary) {
    const applicable=pct(summary.aplica,summary.decided);
    const nonApplicable=pct(summary.noAplica,summary.decided);
    return `<div class="decision-chart"><div class="decision-ring ${summary.decided?'':'is-empty'}" style="--ring-pct:${applicable}%"><div><strong>${fmt(summary.decided)}</strong><span>dictaminadas</span></div></div><div class="ring-legend"><div><i class="legend-dot applies"></i><span>Aplica</span><strong>${fmt(summary.aplica)} · ${applicable}%</strong></div><div><i class="legend-dot no-applies"></i><span>No aplica</span><strong>${fmt(summary.noAplica)} · ${nonApplicable}%</strong></div></div></div>`;
  }
  function breakdownTable(rows) {
    return `<div class="table-wrap"><table class="table detail-table"><thead><tr><th>Segmento</th><th>Solicitudes</th><th>Abiertas</th><th>Cerradas</th><th>% cierre</th><th>Aplican</th><th>No aplican</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${fmt(r.total)}</td><td>${fmt(r.open)}</td><td>${fmt(r.closed)}</td><td><strong>${r.rate}%</strong></td><td>${fmt(r.aplica)}</td><td>${fmt(r.noAplica)}</td></tr>`).join('')||'<tr><td colspan="7">No hay casos para esta selección.</td></tr>'}</tbody></table></div>`;
  }
  function renderDetails(tickets,allTickets,users,staff,filters) {
    const s=summarize(tickets,users,staff),countries=group(allTickets,'country'),countryBase=filters.country&&filters.country!=='all'?allTickets.filter(t=>t.country===filters.country):allTickets,studies=group(countryBase,'client');
    const option=(value,label,selected)=>`<option value="${escapeHtml(value)}" ${selected?'selected':''}>${escapeHtml(label)}</option>`;
    return `<section class="card detail-filter-panel"><div><h2>Indicadores detallados</h2><p class="sub">Selecciona un país y un estudio para revisar su desempeño. Las descargas de esta hoja respetan los filtros.</p></div><div class="detail-filters"><label>País<select id="manager-country-filter">${option('all','Todos los países',!filters.country||filters.country==='all')}${countries.map(x=>option(x.name,x.name,filters.country===x.name)).join('')}</select></label><label>Estudio / cliente<select id="manager-study-filter">${option('all','Todos los estudios',!filters.study||filters.study==='all')}${studies.map(x=>option(x.name,x.name,filters.study===x.name)).join('')}</select></label></div><p class="filter-result" role="status">Mostrando ${fmt(tickets.length)} de ${fmt(allTickets.length)} solicitudes.</p></section>
      <section class="metrics dashboard-metrics detail-metrics" aria-label="Indicadores detallados">${metric('Solicitudes del segmento',fmt(s.total))}${metric('Tasa de cierre',`${pct(s.closed,s.total)}%`,`${fmt(s.closed)} cerradas`)}${metric('En gestión',fmt(s.open))}${metric('Aplican',fmt(s.aplica),`${pct(s.aplica,s.decided)}% de dictámenes`)}${metric('No aplican',fmt(s.noAplica))}${metric('Redigitación pendiente',fmt(s.redigit))}${metric('Verificación pendiente',fmt(s.verification))}${metric('Cierre promedio',s.avgClosure===null?'—':`${s.avgClosure} h`)}${metric('Solicitudes directas',fmt(s.direct))}</section>
      <section class="manager-grid" aria-label="Gráficas de indicadores detallados"><article class="card manager-card"><div class="card-heading"><h2>Estado del segmento</h2><small>Distribución actual</small></div>${bars(s.statuses,'#0d5cab')}</article><article class="card manager-card"><div class="card-heading"><h2>Evolución de radicados</h2><small>Últimas 10 fechas con actividad</small></div>${bars(trend(tickets),'#33bdee')}</article><article class="card manager-card"><div class="card-heading"><h2>Tipologías</h2><small>Casos dictaminados</small></div>${bars(s.tipologies,'#6d37a9')}</article><article class="card manager-card"><div class="card-heading"><h2>Áreas adjudicables</h2><small>Responsabilidad asignada</small></div>${bars(s.areas,'#14a83b')}</article></section>
      <section class="manager-grid" aria-label="Comparativo por país y estudio"><article class="card manager-card"><div class="card-heading"><h2>Desglose por país</h2><small>Volumen y resultado</small></div>${breakdownTable(breakdown(tickets,'country'))}</article><article class="card manager-card"><div class="card-heading"><h2>Desglose por estudio</h2><small>Volumen y resultado</small></div>${breakdownTable(breakdown(tickets,'client'))}</article></section>
      <section class="card manager-card"><div class="card-heading"><h2>Casos incluidos en el análisis</h2><small>${fmt(tickets.length)} solicitudes</small></div><div class="table-wrap"><table class="table detail-table"><thead><tr><th>Radicado</th><th>País</th><th>Estudio</th><th>Estado</th><th>Dictamen</th><th>Tipología</th></tr></thead><tbody>${tickets.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(t=>`<tr><td>${escapeHtml(t.code)}</td><td>${escapeHtml(t.country)}</td><td>${escapeHtml(t.client)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.applies||'Pendiente')}</td><td>${escapeHtml(t.tipology||'—')}</td></tr>`).join('')||'<tr><td colspan="6">No hay solicitudes para esta selección.</td></tr>'}</tbody></table></div></section>`;
  }
  function render(tickets,users,staff,filters={}) {
    const selected=filterTickets(tickets,{type:filters.type});
    const s=summarize(selected,users,staff);
    const view=filters.view==='details'?'details':'overview';
    const shell=`<div class="topline manager-title"><div><span class="eyebrow">GERENCIA · SOLICITUDES</span><h1>Dashboard de gestión</h1><p class="sub">Indicadores de las solicitudes registradas en el portal.</p></div><div><div class="actions export-actions"><button class="ghost" data-action="export-pdf">Descargar PDF ejecutivo</button><button class="secondary" data-action="export-summary">Excel resumen</button><button class="primary" data-action="export-cases">Excel casos</button></div><p id="export-status" class="export-status" role="status" aria-live="polite"></p></div></div><nav class="manager-tabs" aria-label="Hojas de Gerencia"><button class="${view==='overview'?'active':''}" data-action="manager-view" data-manager-view="overview" aria-current="${view==='overview'?'page':'false'}">Resumen ejecutivo</button><button class="${view==='details'?'active':''}" data-action="manager-view" data-manager-view="details" aria-current="${view==='details'?'page':'false'}">Indicadores detallados</button></nav><div class="ticket-filter"><label>Tipo de solicitud<select id="manager-type-filter"><option value="all" ${!filters.type||filters.type==='all'?'selected':''}>Todos los tipos</option>${Object.entries(requestLabels).map(([kind,label])=>`<option value="${kind}" ${filters.type===kind?'selected':''}>${label}</option>`).join('')}</select></label><small>Mostrando ${fmt(selected.length)} de ${fmt(tickets.length)} solicitudes</small></div>`;
    if(view==='details')return shell+renderDetails(filterTickets(tickets,filters),tickets,users,staff,filters);
    const validatorRows=s.validators.map(v=>`<tr><td>${escapeHtml(v.name)}<small>${v.active?'Activo':'Inactivo'}</small></td><td>${fmt(v.assigned)}</td><td>${fmt(v.decided)}</td><td>${fmt(v.closed)}</td></tr>`).join('');
    const redigitatorRows=s.redigitators.map(v=>`<tr><td>${escapeHtml(v.name)}<small>${v.active?'Activo':'Inactivo'}</small></td><td>${fmt(v.assigned)}</td><td>${fmt(v.completed)}</td><td>${fmt(v.closed)}</td></tr>`).join('');
    const recent=selected.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    return `${shell}
      <section class="metrics dashboard-metrics" aria-label="Indicadores principales">
        ${metric('Solicitudes radicadas',fmt(s.total))}${metric('En gestión',fmt(s.open))}${metric('Cerradas',fmt(s.closed),`${pct(s.closed,s.total)}% del total`)}${metric('Aplican',fmt(s.aplica),`${pct(s.aplica,s.decided)}% dictaminadas`)}${metric('No aplican',fmt(s.noAplica),`${pct(s.noAplica,s.decided)}% dictaminadas`)}${metric('Redigitación pendiente',fmt(s.redigit))}${metric('Por verificar',fmt(s.verification))}${metric('Con área adjudicable',fmt(s.adjudicable))}${metric('Tiempo medio de cierre',s.avgClosure===null?'—':`${s.avgClosure} h`)}
      </section>
      <section class="manager-grid" aria-label="Gráficas gerenciales">
        <article class="card manager-card"><div class="card-heading"><h2>Resultado del dictamen</h2><small>Sobre ${fmt(s.decided)} PQR dictaminadas</small></div>${decisionChart(s)}</article>
        <article class="card manager-card"><div class="card-heading"><h2>Tipologías</h2><small>Clasificación de PQR dictaminadas</small></div>${bars(s.tipologies,'#0d5cab')}</article>
        <article class="card manager-card"><div class="card-heading"><h2>Área adjudicable</h2><small>Área responsable definida por Analistas de PQR</small></div>${bars(s.areas,'#33bdee')}</article>
        <article class="card manager-card"><div class="card-heading"><h2>Estado de los casos</h2><small>Distribución actual</small></div>${bars(s.statuses,'#6d37a9')}</article>
      </section>
      <section class="card manager-card"><div class="card-heading"><h2>Gestión por Analista de PQR</h2><small>Casos asignados, dictaminados y cerrados</small></div><div class="table-wrap"><table class="table manager-table"><thead><tr><th>Analista de PQR</th><th>Asignadas</th><th>Dictaminadas</th><th>Cerradas</th></tr></thead><tbody>${validatorRows||'<tr><td colspan="4">No hay Analistas de PQR registrados.</td></tr>'}</tbody></table></div></section>
      <section class="card manager-card"><div class="card-heading"><h2>Gestión por redigitador</h2><small>Casos asignados y auditorías enviadas a verificación</small></div><div class="table-wrap"><table class="table manager-table"><thead><tr><th>Redigitador</th><th>Asignadas</th><th>Redigitadas</th><th>Cerradas</th></tr></thead><tbody>${redigitatorRows||'<tr><td colspan="4">No hay redigitadores registrados.</td></tr>'}</tbody></table></div></section>
      <section class="card manager-card"><div class="card-heading"><div><h2>Detalle de solicitudes</h2><small id="dashboard-filter-count">${fmt(selected.length)} de ${fmt(selected.length)} casos</small></div><label class="dashboard-filter">Filtrar por estado<select id="dashboard-status-filter"><option value="all">Todos los estados</option>${s.statuses.map(row=>`<option value="${escapeHtml(row.name)}">${escapeHtml(row.name)} (${fmt(row.count)})</option>`).join('')}</select></label></div><div class="table-wrap"><table class="table manager-table"><thead><tr><th>Radicado</th><th>Cliente</th><th>País</th><th>Estado</th><th>Dictamen</th></tr></thead><tbody>${recent.map(t=>`<tr data-case-status="${escapeHtml(t.status)}"><td>${escapeHtml(t.code)}<small>${escapeHtml(asDate(t.createdAt))}</small></td><td>${escapeHtml(t.client)}</td><td>${escapeHtml(t.country)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.applies|| (requestType(t)==='RDG'?'Redigitación directa':requestType(t)==='EDC'?'Edición':'Pendiente'))}</td></tr>`).join('')||'<tr><td colspan="5">Aún no hay solicitudes radicadas.</td></tr>'}</tbody></table></div></section>`;
  }

  function pdf(tickets,users,staff,filters={}) {
    if (!window.jspdf?.jsPDF) throw new Error('No está disponible el generador de PDF.');
    const s=summarize(tickets,users,staff),doc=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    const navy=[36,51,95],blue=[13,92,171],cyan=[51,189,238],green=[20,168,59],pink=[248,56,117],ink=[36,51,95],muted=[82,96,117],line=[224,229,236],soft=[247,249,252];
    const fit=(value,maxWidth,size=8)=>{doc.setFontSize(size);let text=String(value??'');if(doc.getTextWidth(text)<=maxWidth)return text;while(text&&doc.getTextWidth(`${text}...`)>maxWidth)text=text.slice(0,-1);return `${text}...`};
    const panel=(x,y,w,h)=>{doc.setFillColor(255,255,255);doc.setDrawColor(...line);doc.roundedRect(x,y,w,h,3,3,'FD')};
    const header=(title,page)=>{doc.setFillColor(...navy);doc.rect(0,0,297,35,'F');doc.setFillColor(...cyan);doc.rect(0,34,297,1.2,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('dichter & neira',16,14);doc.setFontSize(13);doc.text(title,16,25);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('PORTAL PQR  /  INFORME DE GESTIÓN',281,15,{align:'right'});doc.setFontSize(8);doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`,281,25,{align:'right'});doc.setFillColor(234,247,252);doc.roundedRect(16,41,265,12,2,2,'F');doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text('ALCANCE',21,48.6);doc.setFont('helvetica','normal');doc.text(fit(`Tipo: ${requestLabels[filters.type]||'Todos'}   |   País: ${filters.country&&filters.country!=='all'?filters.country:'Todos'}   |   Estudio: ${filters.study&&filters.study!=='all'?filters.study:'Todos'}   |   ${fmt(s.total)} solicitudes`,221,8),43,48.6);doc.setDrawColor(...line);doc.line(16,194,281,194);doc.setTextColor(...muted);doc.setFontSize(7);doc.text('Datos de Portal PQR; corte al momento de la descarga.',16,199);doc.text(`${page} / 2`,281,199,{align:'right'})};
    const kpi=(x,y,w,label,value,note,color)=>{panel(x,y,w,29);doc.setFillColor(...color);doc.roundedRect(x,y,w,2.5,1,1,'F');doc.setTextColor(...muted);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(fit(label,w-10,8),x+5,y+9);doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(19);doc.text(fit(value,w-10,19),x+5,y+20);doc.setFont('helvetica','normal');doc.setTextColor(...muted);doc.setFontSize(7);doc.text(fit(note,w-10,7),x+5,y+26)};
    const barPanel=(x,y,w,h,title,rows,color)=>{panel(x,y,w,h);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...ink);doc.text(title,x+6,y+10);doc.setDrawColor(...line);doc.line(x+6,y+14,x+w-6,y+14);if(!rows.length){doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...muted);doc.text('Sin datos para este alcance',x+6,y+29);return}const top=rows.slice(0,6),max=Math.max(...top.map(r=>r.count),1),rowH=9.1;top.forEach((row,i)=>{const yy=y+24+i*rowH,trackX=x+52,trackW=w-72;doc.setFont('helvetica','normal');doc.setFontSize(7.8);doc.setTextColor(...ink);doc.text(fit(row.name,43,7.8),x+6,yy);doc.setFillColor(232,237,244);doc.roundedRect(trackX,yy-3,trackW,3.4,1.5,1.5,'F');doc.setFillColor(...color);doc.roundedRect(trackX,yy-3,Math.max(2,trackW*row.count/max),3.4,1.5,1.5,'F');doc.setFont('helvetica','bold');doc.text(String(row.count),x+w-6,yy,{align:'right'})})};
    const segmentPanel=(x,y,w,title,rows)=>{panel(x,y,w,94);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...ink);doc.text(title,x+6,y+10);doc.setDrawColor(...line);doc.line(x+6,y+14,x+w-6,y+14);doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor(...muted);doc.text('SEGMENTO',x+6,y+20);doc.text('PQR',x+66,y+20,{align:'right'});doc.text('% CIERRE',x+w-6,y+20,{align:'right'});if(!rows.length){doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Sin datos para este alcance',x+6,y+35);return}const shown=rows.slice(0,rows.length>14?13:14);if(rows.length>14){const rest=rows.slice(13),total=rest.reduce((n,r)=>n+r.total,0),closed=rest.reduce((n,r)=>n+r.closed,0);shown.push({name:`Otros (${rest.length})`,total,rate:pct(closed,total)})}shown.forEach((row,i)=>{const yy=y+26+i*4.8;doc.setFont('helvetica','normal');doc.setFontSize(7.2);doc.setTextColor(...ink);doc.text(fit(row.name,49,7.2),x+6,yy);doc.setFont('helvetica','bold');doc.text(String(row.total),x+66,yy,{align:'right'});doc.setFillColor(232,237,244);doc.roundedRect(x+75,yy-2.4,26,2.6,1,1,'F');if(row.rate){doc.setFillColor(...green);doc.roundedRect(x+75,yy-2.4,26*row.rate/100,2.6,1,1,'F')}doc.text(`${row.rate}%`,x+w-6,yy,{align:'right'})})};
    header('Resumen ejecutivo',1);
    const cardX=[16,70,124,178,232],cardW=49;
    kpi(cardX[0],59,cardW,'Solicitudes',fmt(s.total),'Casos del alcance',blue);
    kpi(cardX[1],59,cardW,'Cerradas',fmt(s.closed),`${pct(s.closed,s.total)}% de cierre`,green);
    kpi(cardX[2],59,cardW,'En gestión',fmt(s.open),'Pendientes de cierre',cyan);
    kpi(cardX[3],59,cardW,'Aplican',fmt(s.aplica),`${pct(s.aplica,s.decided)}% dictaminadas`,blue);
    kpi(cardX[4],59,cardW,'Cierre promedio',s.avgClosure===null?'N/D':`${s.avgClosure} h`,'Desde radicación',pink);
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...ink);doc.text(`DICTAMEN  ${fmt(s.decided)} CASOS`,16,99);doc.setFillColor(234,238,244);doc.roundedRect(89,94,192,7,2,2,'F');if(s.decided){const applicable=192*s.aplica/s.decided;doc.setFillColor(...green);if(applicable>0)doc.roundedRect(89,94,applicable,7,2,2,'F');doc.setFillColor(...pink);if(applicable<192)doc.roundedRect(89+applicable,94,192-applicable,7,2,2,'F')}doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(...muted);doc.text(`Aplica ${s.aplica} (${pct(s.aplica,s.decided)}%)`,89,107);doc.text(`No aplica ${s.noAplica} (${pct(s.noAplica,s.decided)}%)`,281,107,{align:'right'});
    barPanel(16,113,130,73,'Estado del portafolio',s.statuses,blue);
    barPanel(151,113,130,73,'Tipologías frecuentes',s.tipologies,cyan);
    doc.addPage();header('Indicadores detallados',2);
    kpi(cardX[0],59,cardW,'Redigitación',fmt(s.redigit),'Pendientes',blue);
    kpi(cardX[1],59,cardW,'Verificación',fmt(s.verification),'Pendientes',cyan);
    kpi(cardX[2],59,cardW,'No aplican',fmt(s.noAplica),`${pct(s.noAplica,s.decided)}% dictaminadas`,pink);
    kpi(cardX[3],59,cardW,'Área definida',fmt(s.adjudicable),'Casos adjudicables',green);
    kpi(cardX[4],59,cardW,'Directas',fmt(s.direct),'Redigitación comercial',blue);
    segmentPanel(16,94,130,'Resultados por país',breakdown(tickets,'country'));
    segmentPanel(151,94,130,'Resultados por estudio',breakdown(tickets,'client'));
    doc.save(`PQR_informe_ejecutivo_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  function excelSummary(tickets,users,staff) {
    if (!window.XLSX) throw new Error('No está disponible el generador de Excel.');
    const s=summarize(tickets,users,staff),rows=[
      ['Portal PQR - Resumen de gestión'],['Generado',new Date().toLocaleString('es-CO')],[],
      ['Indicador','Valor'],['Solicitudes radicadas',s.total],['En gestión',s.open],['Cerradas',s.closed],['Aplican',s.aplica],['No aplican',s.noAplica],['Pendientes de redigitación',s.redigit],['Pendientes de verificación',s.verification],['Con área adjudicable',s.adjudicable],['Tiempo medio de cierre (horas)',s.avgClosure??'Sin cierres'],[],
      ['Tipología','Casos'],...s.tipologies.map(x=>[x.name,x.count]),[],['Área adjudicable','Casos'],...s.areas.map(x=>[x.name,x.count]),[],['Estado','Casos'],...s.statuses.map(x=>[x.name,x.count]),[],['Analista de PQR','Asignadas','Dictaminadas','Cerradas'],...s.validators.map(v=>[v.name,v.assigned,v.decided,v.closed]),[],['Redigitador','Asignadas','Redigitadas','Cerradas'],...s.redigitators.map(v=>[v.name,v.assigned,v.completed,v.closed])
    ];
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:36},{wch:20},{wch:19},{wch:16}];XLSX.utils.book_append_sheet(wb,ws,'Resumen');XLSX.writeFile(wb,`PQR_resumen_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function excelCases(tickets,users=[],staff={}) {
    if (!window.XLSX) throw new Error('No está disponible el generador de Excel.');
  const baseHeaders=['Trámite','Radicado','Fecha/hora creación','Comercial','ID PDV','Cliente','País','Descripción','Estado','Dictamen','Tipología','Área adjudicable','Analista de PQR','Tipo redigitación','Responsable redigitación','ID auditoría','Nueva auditoría','Respuesta','Verificación final','Fecha/hora cierre','Archivo de referencia','Notas de redigitación','Retroalimentación satisfactoria','Comentario de retroalimentación'];
    const maxEvents=Math.max(0,...tickets.map(t=>Array.isArray(t.timeline)?t.timeline.length:0));
    const headers=[...baseHeaders,...Array.from({length:maxEvents},(_,i)=>[`Paso ${i+1} · etapa`,`Paso ${i+1} · fecha y hora`,`Paso ${i+1} · responsable`,`Paso ${i+1} · detalle`]).flat()];
    const excelDate=value=>{if(!value)return '';const result=new Date(value);return Number.isNaN(result.getTime())?'':result};
    const clean=value=>{if(value instanceof Date)return value;const text=String(value??'');return /^[=+\-@]/.test(text)?`'${text}`:text};
    const personName=(role,personId)=>staff[role]?.find(p=>p.id===personId)?.name||'';
    const commercialName=userId=>users.find(account=>account.id===userId)?.name||'Cuenta anterior';
    const rows=tickets.map(t=>{
      const events=(Array.isArray(t.timeline)?t.timeline:[]).slice().sort((a,b)=>new Date(a.at)-new Date(b.at));
      const history=Array.from({length:maxEvents},(_,i)=>{const item=events[i];return item?[item.action,excelDate(item.at),item.actor,item.detail]:['','','','']}).flat();
    return [requestLabels[requestType(t)],t.code,excelDate(t.createdAt),commercialName(t.commercial),t.pdv,t.client,t.country,t.description,t.status,t.applies,t.tipology,t.area,personName('validators',t.validatorPersonId),t.redigitType,t.fieldRedigitatorName||personName('redigitators',t.redigitatorPersonId),t.auditOriginal,t.audit,t.response,t.verifyComment,excelDate(t.closedAt),t.support,t.redigitNotes,t.feedback?(t.feedback.ok?'Sí':'No'):'',t.feedback?.comment,...history].map(clean);
    });
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([headers,...rows],{cellDates:true,dateNF:'dd/mm/yyyy hh:mm:ss'});
    ws['!cols']=headers.map(header=>({wch:header.includes('detalle')||['Descripción','Respuesta','Verificación final','Notas de redigitación','Comentario de retroalimentación'].includes(header)?55:header.includes('fecha')||header.includes('hora')?23:header.includes('responsable')?30:header==='Radicado'?23:header==='ID PDV'||header.includes('auditoría')?21:20}));
    ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(headers.length-1)}${Math.max(rows.length+1,2)}`};
    for(const cell of Object.values(ws))if(cell&&cell.t==='d')cell.z='dd/mm/yyyy hh:mm:ss';
    XLSX.utils.book_append_sheet(wb,ws,'Casos');XLSX.writeFile(wb,`PQR_casos_${new Date().toISOString().slice(0,10)}.xlsx`);
  }
  return {summarize,filterTickets,render,pdf,excelSummary,excelCases};
})();
