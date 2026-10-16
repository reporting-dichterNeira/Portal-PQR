/* Resumen gerencial y descargas del portal oficial. */
window.PQRReports = (() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const statusLabel = status => status === 'En Validación' ? 'En revisión' : status;
  const statusRows = rows => rows.map(row => ({ ...row, name: statusLabel(row.name) }));
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
  const filterTickets = (tickets,filters={}) => tickets.filter(t => Object.entries({country:t.country,study:t.client,month:t.reportingMonth||String(t.createdAt||'').slice(0,7),origin:t.origin||'platform',status:t.status,analyst:t.analystName||t.validatorPersonId||'',type:requestType(t)}).every(([key,value])=>!filters[key]||filters[key]==='all'||filters[key]===value));
  const breakdown = (tickets,field) => group(tickets,field).map(({name})=>{
    const own=tickets.filter(t=>String(t[field]||'Sin clasificar').trim()===name);
    const closed=own.filter(t=>closedStatuses.has(t.status)).length;
    return {name,total:own.length,closed,open:own.length-closed,aplica:own.filter(t=>t.applies==='Aplica').length,noAplica:own.filter(t=>t.applies==='No Aplica').length,rate:pct(closed,own.length)};
  });
  function monthlyTrend(tickets) {
    const counts=new Map();
    for(const t of tickets){
      if(requestType(t)!=='PQR')continue;
      const candidate=t.reportingMonth||(t.origin==='historical'?'':String(t.createdAt||'').slice(0,7));
      const key=/^20\d{2}-(0[1-9]|1[0-2])$/.test(candidate)?candidate:'Sin mes';
      if(!counts.has(key))counts.set(key,{month:key,total:0,aplica:0,noAplica:0,pending:0});
      const row=counts.get(key);row.total++;
      if(t.applies==='Aplica')row.aplica++;else if(t.applies==='No Aplica')row.noAplica++;else row.pending++;
    }
    const keys=[...counts.keys()].filter(k=>k!=='Sin mes').sort();
    // Keep zero-activity months visible, rather than drawing adjacent non-adjacent periods.
    if(keys.length){
      const end=keys.at(-1);let key=keys[0];
      while(key<=end){
        if(!counts.has(key))counts.set(key,{month:key,total:0,aplica:0,noAplica:0,pending:0});
        const [year,month]=key.split('-').map(Number);
        key=month===12?`${year+1}-01`:`${year}-${String(month+1).padStart(2,'0')}`;
      }
    }
    return [...counts.values()].sort((a,b)=>a.month==='Sin mes'?1:b.month==='Sin mes'?-1:a.month.localeCompare(b.month));
  }
  function monthlyChart(tickets) {
    const rows=monthlyTrend(tickets),dated=rows.filter(r=>r.month!=='Sin mes');
    const label=key=>key==='Sin mes'?key:new Date(`${key}-01T12:00:00`).toLocaleDateString('es-CO',{month:'short',year:'numeric'});
    const series=[{key:'total',name:'PQR registradas',color:'#0d5cab',dash:''},{key:'aplica',name:'Aplican',color:'#16703c',dash:'8 4'},{key:'noAplica',name:'No aplican',color:'#9d316f',dash:'2 4'}];
    const w=Math.max(780,dated.length*90),h=290,left=62,right=w-35,top=32,bottom=236;
    const max=Math.max(4,Math.ceil(Math.max(...dated.map(r=>r.total),1)/4)*4),x=i=>dated.length===1?(left+right)/2:left+i*(right-left)/(dated.length-1),y=value=>bottom-value/max*(bottom-top);
    const svg=dated.length?`<div class="monthly-chart-scroll"><svg class="monthly-chart" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="Evolutivo mensual de PQR registradas, aplican y no aplican. Valores exactos en la tabla inferior.">
      ${Array.from({length:5},(_,i)=>{const value=Math.ceil(max*i/4),yy=y(value);return `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#dce3ec"/><text x="${left-12}" y="${yy+4}" text-anchor="end">${fmt(value)}</text>`;}).join('')}
      ${dated.map((r,i)=>`<text x="${x(i)}" y="${bottom+28}" text-anchor="middle">${escapeHtml(label(r.month))}</text>`).join('')}
      ${series.map(s=>`<polyline points="${dated.map((r,i)=>`${x(i)},${y(r[s.key])}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="3" stroke-dasharray="${s.dash}"/>${dated.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r[s.key])}" r="4" fill="white" stroke="${s.color}" stroke-width="2"><title>${escapeHtml(label(r.month))} · ${s.name}: ${fmt(r[s.key])}</title></circle>`).join('')}`).join('')}
    </svg></div>`:'<p class="empty-chart">No hay PQR con mes identificado en esta selección.</p>';
    return `<section class="card manager-card monthly-panel" aria-label="Evolutivo mensual de PQR"><div class="card-heading"><h2>Evolutivo mensual de PQR</h2><small>Mes de auditoría · Ola / respaldo del Excel</small></div><p class="sub">Respeta los filtros superiores. Solo PQR, sin redigitaciones directas ni ediciones. Las PQR sin dictamen cuentan en el total, no en «No aplican». El periodo es el mes de la auditoría, no la fecha de recepción.</p><div class="monthly-legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>${svg}<div class="table-wrap"><table class="table monthly-table"><caption>Volumen y resultado por mes de auditoría</caption><thead><tr><th>Mes</th><th>PQR registradas</th><th>Aplican</th><th>No aplican</th><th>Sin dictamen</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${escapeHtml(label(r.month))}</th><td>${fmt(r.total)}</td><td>${fmt(r.aplica)}</td><td>${fmt(r.noAplica)}</td><td>${fmt(r.pending)}</td></tr>`).join('')||'<tr><td colspan="5">No hay PQR para esta selección.</td></tr>'}</tbody></table></div></section>`;
  }

  function summarize(tickets,users=[],staff={}) {
    const decided=tickets.filter(t=>t.applies==='Aplica'||t.applies==='No Aplica');
    const aplica=decided.filter(t=>t.applies==='Aplica').length;
    const noAplica=decided.filter(t=>t.applies==='No Aplica').length;
    const closed=tickets.filter(t=>closedStatuses.has(t.status));
    const open=tickets.length-closed.length;
    const closureHours=closed.filter(t=>t.timingComplete!==false&&t.createdAt&&t.closedAt).map(t=>(new Date(t.closedAt)-new Date(t.createdAt))/36e5).filter(x=>Number.isFinite(x)&&x>=0);
    const avgClosure=closureHours.length ? Math.round(closureHours.reduce((a,b)=>a+b,0)/closureHours.length*10)/10 : null;
    const knownValidators=staff.validators||[];
    const analystName=t=>t.analystName||knownValidators.find(p=>p.id===t.validatorPersonId)?.name||(t.validatorPersonId?'Responsable histórico':'');
    const validatorNames=new Set([...knownValidators.map(p=>p.name),...tickets.map(analystName).filter(Boolean)]);
    const validators=[...validatorNames].map(name=>{
      const own=tickets.filter(t=>analystName(t)===name);
      const person=knownValidators.find(p=>p.name===name);
      return {name,active:person?person.active!==false:null,assigned:own.length,decided:own.filter(t=>t.applies).length,closed:own.filter(t=>closedStatuses.has(t.status)).length};
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
      adjudicable:decided.filter(t=>t.area&&!/^(no\s*aplica|n\/?a)$/i.test(t.area.trim())).length,
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
    const s=summarize(tickets,users,staff);
    return `<section class="card"><h2>Indicadores detallados</h2><p class="sub">Los indicadores y todas las descargas respetan los filtros superiores. Los históricos sin horarios fiables no se incluyen en el cierre promedio.</p></section>
      ${monthlyChart(tickets)}
      ${window.PQRAudits?.render(tickets,filters.auditLookup,filters.auditDimension)||''}
      <section class="metrics dashboard-metrics detail-metrics" aria-label="Indicadores detallados">${metric('Solicitudes del segmento',fmt(s.total))}${metric('Tasa de cierre',`${pct(s.closed,s.total)}%`,`${fmt(s.closed)} cerradas`)}${metric('En gestión',fmt(s.open))}${metric('Aplican',fmt(s.aplica),`${pct(s.aplica,s.decided)}% de dictámenes`)}${metric('No aplican',fmt(s.noAplica))}${metric('Redigitación pendiente',fmt(s.redigit))}${metric('Verificación pendiente',fmt(s.verification))}${metric('Cierre promedio',s.avgClosure===null?'—':`${s.avgClosure} h`)}${metric('Solicitudes directas',fmt(s.direct))}</section>
      <section class="manager-grid" aria-label="Gráficas de indicadores detallados"><article class="card manager-card"><div class="card-heading"><h2>Estado del segmento</h2><small>Distribución actual</small></div>${bars(statusRows(s.statuses),'#0d5cab')}</article><article class="card manager-card"><div class="card-heading"><h2>Tipologías</h2><small>Casos dictaminados</small></div>${bars(s.tipologies,'#6d37a9')}</article><article class="card manager-card"><div class="card-heading"><h2>Áreas adjudicables</h2><small>Responsabilidad asignada</small></div>${bars(s.areas,'#14a83b')}</article></section>
      <section class="manager-grid" aria-label="Comparativo por país y estudio"><article class="card manager-card"><div class="card-heading"><h2>Desglose por país</h2><small>Volumen y resultado</small></div>${breakdownTable(breakdown(tickets,'country'))}</article><article class="card manager-card"><div class="card-heading"><h2>Desglose por estudio</h2><small>Volumen y resultado</small></div>${breakdownTable(breakdown(tickets,'client'))}</article></section>
      <section class="card manager-card"><div class="card-heading"><h2>Casos incluidos en el análisis</h2><small>${fmt(tickets.length)} solicitudes</small></div><div class="table-wrap"><table class="table detail-table"><thead><tr><th>Radicado</th><th>País</th><th>Estudio</th><th>Estado</th><th>Dictamen</th><th>Tipología</th><th>Auditoría</th></tr></thead><tbody>${tickets.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(t=>`<tr><td>${escapeHtml(t.code)}</td><td>${escapeHtml(t.country)}</td><td>${escapeHtml(t.client)}</td><td>${escapeHtml(statusLabel(t.status))}</td><td>${escapeHtml(t.applies||'Pendiente')}</td><td>${escapeHtml(t.tipology||'—')}</td>${window.PQRAudits?.cell(t,filters.auditLookup)||'<td>Sin consultar</td>'}</tr>`).join('')||'<tr><td colspan="7">No hay solicitudes para esta selección.</td></tr>'}</tbody></table></div></section>`;
  }
  function render(tickets,users,staff,filters={}) {
    const selected=filterTickets(tickets,filters);
    const s=summarize(selected,users,staff);
    const view=['details','pending'].includes(filters.view)?filters.view:'overview';
    const select=(key,label,values)=>`<label>${label}<select id="manager-${key}-filter"><option value="all">Todos</option>${values.map(([value,name])=>`<option value="${escapeHtml(value)}" ${filters[key]===value?'selected':''}>${escapeHtml(name)}</option>`).join('')}</select></label>`;
    const studies=['KO moderno','KO tradicional','Lindley'].map(name=>[name,name]);
    const values=field=>field==='client'?studies:group(tickets,field).map(r=>[r.name,r.name]);
    const months=[...new Set(tickets.map(t=>t.reportingMonth).filter(Boolean))].sort().reverse().map(m=>[m,m]);
    const analysts=[...new Map(tickets.map(t=>[t.analystName||t.validatorPersonId,t.analystName||staff.validators?.find(v=>v.id===t.validatorPersonId)?.name]).filter(([id,name])=>id&&name)).entries()];
    const shell=`<div class="topline manager-title"><div><span class="eyebrow">GERENCIA · SOLICITUDES</span><h1>Dashboard de gestión</h1><p class="sub">PQR históricas y solicitudes de la plataforma, con origen identificado.</p></div><div><div class="actions export-actions"><button class="ghost" data-action="export-pdf">Descargar PDF ejecutivo</button><button class="secondary" data-action="export-summary">Excel resumen</button><button class="primary" data-action="export-cases">Excel casos</button></div><p id="export-status" class="export-status" role="status" aria-live="polite"></p></div></div><nav class="manager-tabs" aria-label="Hojas de Gerencia">${[['overview','Resumen ejecutivo'],['details','Indicadores detallados'],['pending','Datos por completar']].map(([key,label])=>`<button class="${view===key?'active':''}" data-action="manager-view" data-manager-view="${key}" aria-current="${view===key?'page':'false'}">${label}</button>`).join('')}</nav><section class="card manager-global-filters" aria-label="Filtros del dashboard">${select('country','País',values('country'))}${select('study','Estudio',values('client'))}${select('month','Mes de auditoría',months)}${select('origin','Origen',[['historical','Histórico (Excel)'],['platform','Plataforma']])}${select('type','Tipo de solicitud',Object.entries(requestLabels))}${select('status','Estado',values('status').map(([v])=>[v,statusLabel(v)]))}${select('analyst','Analista de PQR',analysts)}<div><button class="ghost" data-action="reset-manager-filters">Limpiar filtros</button><small role="status">${fmt(selected.length)} de ${fmt(tickets.length)} solicitudes</small></div><p class="sub full">Mes = Ola de Databricks; si no cruza, mes del Excel en históricos y fecha de radicación en plataforma. Las correcciones manuales tienen prioridad y quedan identificadas. El histórico se conserva cerrado y no genera avisos ni SLA.</p></section>`;
    if(view==='pending')return shell+window.PQRHistory.pending(selected);
    const auditPanel=window.PQRAudits?.render(selected,filters.auditLookup,filters.auditDimension)||'';
    if(view==='details')return shell+renderDetails(filterTickets(tickets,filters),tickets,users,staff,filters);
    const validatorRows=s.validators.map(v=>`<tr><td>${escapeHtml(v.name)}<small>${v.active===null?'Histórico / dato de reporte':v.active?'Activo':'Inactivo'}</small></td><td>${fmt(v.assigned)}</td><td>${fmt(v.decided)}</td><td>${fmt(v.closed)}</td></tr>`).join('');
    const redigitatorRows=s.redigitators.map(v=>`<tr><td>${escapeHtml(v.name)}<small>${v.active?'Activo':'Inactivo'}</small></td><td>${fmt(v.assigned)}</td><td>${fmt(v.completed)}</td><td>${fmt(v.closed)}</td></tr>`).join('');
    const recent=selected.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    return `${shell}${monthlyChart(selected)}${auditPanel}
      <section class="metrics dashboard-metrics" aria-label="Indicadores principales">
        ${metric('Solicitudes radicadas',fmt(s.total))}${metric('En gestión',fmt(s.open))}${metric('Cerradas',fmt(s.closed),`${pct(s.closed,s.total)}% del total`)}${metric('Aplican',fmt(s.aplica),`${pct(s.aplica,s.decided)}% dictaminadas`)}${metric('No aplican',fmt(s.noAplica),`${pct(s.noAplica,s.decided)}% dictaminadas`)}${metric('Redigitación pendiente',fmt(s.redigit))}${metric('Por verificar',fmt(s.verification))}${metric('Con área adjudicable',fmt(s.adjudicable))}${metric('Tiempo medio de cierre',s.avgClosure===null?'—':`${s.avgClosure} h`)}
      </section>
      <section class="manager-grid" aria-label="Gráficas gerenciales">
        <article class="card manager-card"><div class="card-heading"><h2>Resultado del dictamen</h2><small>Sobre ${fmt(s.decided)} PQR dictaminadas</small></div>${decisionChart(s)}</article>
        <article class="card manager-card"><div class="card-heading"><h2>Tipologías</h2><small>Clasificación de PQR dictaminadas</small></div>${bars(s.tipologies,'#0d5cab')}</article>
        <article class="card manager-card"><div class="card-heading"><h2>Área adjudicable</h2><small>Área responsable definida por Analistas de PQR</small></div>${bars(s.areas,'#33bdee')}</article>
        <article class="card manager-card"><div class="card-heading"><h2>Estado de los casos</h2><small>Distribución actual</small></div>${bars(statusRows(s.statuses),'#6d37a9')}</article>
      </section>
      <section class="card manager-card"><div class="card-heading"><h2>Gestión por Analista de PQR</h2><small>Casos asignados, dictaminados y cerrados</small></div><div class="table-wrap"><table class="table manager-table"><thead><tr><th>Analista de PQR</th><th>Asignadas</th><th>Dictaminadas</th><th>Cerradas</th></tr></thead><tbody>${validatorRows||'<tr><td colspan="4">No hay Analistas de PQR registrados.</td></tr>'}</tbody></table></div></section>
      <section class="card manager-card"><div class="card-heading"><h2>Gestión por redigitador</h2><small>Casos asignados y auditorías enviadas a verificación</small></div><div class="table-wrap"><table class="table manager-table"><thead><tr><th>Redigitador</th><th>Asignadas</th><th>Redigitadas</th><th>Cerradas</th></tr></thead><tbody>${redigitatorRows||'<tr><td colspan="4">No hay redigitadores registrados.</td></tr>'}</tbody></table></div></section>
      <section class="card manager-card"><div class="card-heading"><div><h2>Detalle de solicitudes</h2><small id="dashboard-filter-count">${fmt(selected.length)} de ${fmt(selected.length)} casos</small></div><small>Estado y demás filtros: panel superior</small></div><div class="table-wrap"><table class="table manager-table"><thead><tr><th>Radicado</th><th>Cliente</th><th>País</th><th>Estado</th><th>Dictamen</th><th>Auditoría</th></tr></thead><tbody>${recent.map(t=>`<tr data-case-status="${escapeHtml(t.status)}"><td>${escapeHtml(t.code)}<small>${escapeHtml(asDate(t.createdAt))}</small></td><td>${escapeHtml(t.client)}</td><td>${escapeHtml(t.country)}</td><td>${escapeHtml(statusLabel(t.status))}</td><td>${escapeHtml(t.applies|| (requestType(t)==='RDG'?'Redigitación directa':requestType(t)==='EDC'?'Edición':'Pendiente'))}</td>${window.PQRAudits?.cell(t,filters.auditLookup)||'<td>Sin consultar</td>'}</tr>`).join('')||'<tr><td colspan="6">Aún no hay solicitudes radicadas.</td></tr>'}</tbody></table></div></section>`;
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
    barPanel(16,113,130,73,'Estado del portafolio',statusRows(s.statuses),blue);
    barPanel(151,113,130,73,'Tipologías frecuentes',s.tipologies,cyan);
    doc.addPage();header('Indicadores detallados',2);
    kpi(cardX[0],59,cardW,'Redigitación',fmt(s.redigit),'Pendientes',blue);
    kpi(cardX[1],59,cardW,'Verificación',fmt(s.verification),'Pendientes',cyan);
    kpi(cardX[2],59,cardW,'No aplican',fmt(s.noAplica),`${pct(s.noAplica,s.decided)}% dictaminadas`,pink);
    kpi(cardX[3],59,cardW,'Área definida',fmt(s.adjudicable),'Casos adjudicables',green);
    kpi(cardX[4],59,cardW,'Directas',fmt(s.direct),'Redigitación comercial',blue);
    segmentPanel(16,94,130,'Resultados por país',breakdown(tickets,'country'));
    segmentPanel(151,94,130,'Resultados por estudio',breakdown(tickets,'client'));
    for(const page of [1,2]){
      doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...muted);
      doc.text(fit(`Mes de auditoría: ${filters.month&&filters.month!=='all'?filters.month:'Todos'}  |  Origen: ${filters.origin==='historical'?'Histórico Excel':filters.origin==='platform'?'Plataforma':'Todos'}  |  Estado: ${filters.status&&filters.status!=='all'?statusLabel(filters.status):'Todos'}  |  Analista: ${filters.analyst&&filters.analyst!=='all'?filters.analyst:'Todos'}`,265,7),16,56);
      doc.text('Los históricos sin horas fiables no se incluyen en el cierre promedio. Las correcciones manuales conservan la fuente original.',16,191);
    }
    doc.save(`PQR_informe_ejecutivo_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  function excelSummary(tickets,users,staff,filters={}) {
    if (!window.XLSX) throw new Error('No está disponible el generador de Excel.');
    const s=summarize(tickets,users,staff),rows=[
      ['Portal PQR - Resumen de gestión'],['Generado',new Date().toLocaleString('es-CO')],['Mes de auditoría',filters.month||'all'],['Origen',filters.origin||'all'],['País',filters.country||'all'],['Estudio',filters.study||'all'],[],
      ['Indicador','Valor'],['Solicitudes radicadas',s.total],['En gestión',s.open],['Cerradas',s.closed],['Aplican',s.aplica],['No aplican',s.noAplica],['Pendientes de redigitación',s.redigit],['Pendientes de verificación',s.verification],['Con área adjudicable',s.adjudicable],['Tiempo medio de cierre (horas)',s.avgClosure??'Sin cierres'],[],
      ['Tipología','Casos'],...s.tipologies.map(x=>[x.name,x.count]),[],['Área adjudicable','Casos'],...s.areas.map(x=>[x.name,x.count]),[],['Estado','Casos'],...s.statuses.map(x=>[statusLabel(x.name),x.count]),[],['Analista de PQR','Asignadas','Dictaminadas','Cerradas'],...s.validators.map(v=>[v.name,v.assigned,v.decided,v.closed]),[],['Redigitador','Asignadas','Redigitadas','Cerradas'],...s.redigitators.map(v=>[v.name,v.assigned,v.completed,v.closed])
    ];
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:36},{wch:20},{wch:19},{wch:16}];XLSX.utils.book_append_sheet(wb,ws,'Resumen');XLSX.writeFile(wb,`PQR_resumen_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function excelCases(tickets,users=[],staff={}) {
    if (!window.XLSX) throw new Error('No está disponible el generador de Excel.');
  const baseHeaders=['Trámite','Radicado','Fecha/hora creación','Comercial','ID PDV','Cliente','País','Descripción','Estado','Dictamen','Tipología','Área adjudicable','Analista de PQR','Tipo redigitación','Responsable redigitación','ID auditoría','Nueva auditoría','Respuesta','Verificación final','Fecha/hora cierre','Archivo de referencia','Notas de redigitación','Retroalimentación satisfactoria','Comentario de retroalimentación','Origen','Mes de auditoría','Mes Excel','Fuente del mes','Fila Excel','ID original Excel','Estudio Excel','País Excel','Auditor de campo','Validador de auditoría','Ciudad','Región','Datos manuales','Información pendiente'];
    const maxEvents=Math.max(0,...tickets.map(t=>Array.isArray(t.timeline)?t.timeline.length:0));
    const headers=[...baseHeaders,...Array.from({length:maxEvents},(_,i)=>[`Paso ${i+1} · etapa`,`Paso ${i+1} · fecha y hora`,`Paso ${i+1} · responsable`,`Paso ${i+1} · detalle`]).flat()];
    const excelDate=value=>{if(!value)return '';const result=new Date(value);return Number.isNaN(result.getTime())?'':result};
    const clean=value=>{if(value instanceof Date)return value;const text=String(value??'');return /^[=+\-@]/.test(text)?`'${text}`:text};
    const personName=(role,personId)=>staff[role]?.find(p=>p.id===personId)?.name||'';
    const commercialName=t=>t.commercialName||(t.commercial?(users.find(account=>account.id===t.commercial)?.name||'Cuenta anterior'):'No indicado');
    const rows=tickets.map(t=>{
      const events=(Array.isArray(t.timeline)?t.timeline:[]).slice().sort((a,b)=>new Date(a.at)-new Date(b.at));
      const history=Array.from({length:maxEvents},(_,i)=>{const item=events[i];return item?[item.action,excelDate(item.at),item.actor,item.detail]:['','','','']}).flat();
    return [requestLabels[requestType(t)],t.code,t.origin==='historical'?t.createdAt:excelDate(t.createdAt),commercialName(t),t.pdv,t.client,t.country,t.description,statusLabel(t.status),t.applies,t.tipology,t.area,t.analystName||personName('validators',t.validatorPersonId),t.redigitType,t.fieldRedigitatorName||personName('redigitators',t.redigitatorPersonId),t.auditOriginal,t.audit,t.response,t.verifyComment,t.origin==='historical'?t.closedAt:excelDate(t.closedAt),t.support,t.redigitNotes,t.feedback?(t.feedback.ok?'Sí':'No'):'',t.feedback?.comment,t.origin==='historical'?'Histórico (Excel)':'Plataforma',t.reportingMonth,t.excelMonth,t.correction?.patch?.reportingMonth?'Manual':t.monthSource,t.sourceRow,t.sourceId,t.excelStudy,t.excelCountry,t.auditData?.nombre_usuario,t.auditData?.Validador,t.auditData?.ciudad,t.auditData?.region,t.hasManualData?'Sí':'No',t.dataIssues?.join(' · '),...history].map(clean);
    });
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([headers,...rows],{cellDates:true,dateNF:'dd/mm/yyyy hh:mm:ss'});
    ws['!cols']=headers.map(header=>({wch:header.includes('detalle')||['Descripción','Respuesta','Verificación final','Notas de redigitación','Comentario de retroalimentación'].includes(header)?55:header.includes('fecha')||header.includes('hora')?23:header.includes('responsable')?30:header==='Radicado'?23:header==='ID PDV'||header.includes('auditoría')?21:20}));
    ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(headers.length-1)}${Math.max(rows.length+1,2)}`};
    for(const cell of Object.values(ws))if(cell&&cell.t==='d')cell.z='dd/mm/yyyy hh:mm:ss';
    XLSX.utils.book_append_sheet(wb,ws,'Casos');XLSX.writeFile(wb,`PQR_casos_${new Date().toISOString().slice(0,10)}.xlsx`);
  }
  return {statusLabel,summarize,filterTickets,monthlyTrend,render,pdf,excelSummary,excelCases};
})();
