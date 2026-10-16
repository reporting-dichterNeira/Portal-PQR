/* Historical reporting is separate from operational queues and notifications. */
window.PQRHistory = (() => {
  const text = v => String(v ?? '').trim();
  const norm = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const esc = v => text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id = v => /^\d{1,30}$/.test(text(v)) ? text(v) : '';
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const month = v => {
    const s=norm(v), year=s.match(/20\d{2}/)?.[0];
    if(!year)return '';
    if(/^20\d{2}-\d{2}/.test(s))return /^(0[1-9]|1[0-2])$/.test(s.slice(5,7))?s.slice(0,7):'';
    const n=months.findIndex(m=>s.includes(m)||s.split(/\W+/).includes(m.slice(0,3)));
    return n<0?'':`${year}-${String(n+1).padStart(2,'0')}`;
  };
  const studies = ['KO moderno','KO tradicional','Lindley'];
  // Survey is parsed without a channel. For Excel fallback, Canal disambiguates KO.
  const study = (value,channel='') => {
    const s=norm(value).replace(/[_-]+/g,' '),c=norm(channel);
    if(/\blindley\b/.test(s))return 'Lindley';
    if(s&&!/\bko\b/.test(s))return '';
    if(/\bmod(?:erno)?\b/.test(c))return 'KO moderno';
    if(/\btrad(?:icional)?\b/.test(c))return 'KO tradicional';
    if(/\bko\s+mod(?:erno)?\b/.test(s))return 'KO moderno';
    if(/\bko\s+trad(?:icional)?\b/.test(s))return 'KO tradicional';
    return '';
  };
  const country = v => /guatemala/i.test(text(v))?'Guatemala':({peru:'Perú',panama:'Panamá','republica dominicana':'República Dominicana','r. dominicana':'República Dominicana',colombia:'Colombia',honduras:'Honduras','el salvador':'El Salvador',nicaragua:'Nicaragua',bolivia:'Bolivia',paraguay:'Paraguay','costa rica':'Costa Rica',ecuador:'Ecuador',chile:'Chile'})[norm(v)]||text(v);
  function sourceMonth(v) {
    const date=[v['Fecha de auditoría'],v['Fecha de solicitud'],v['Fecha de resolución']].map(text).find(x=>/^20\d{2}-/.test(x));
    const y=date?.slice(0,4);
    return y?month(`${v.Mes} ${y}`):'';
  }
  function auditCandidate(v) {
    return id(v['ID de auditoría'])||(/^[A-Z]{2,}[_-]\d+$/i.test(text(v['ID de auditoría']))?id(v['Quien responde el PQR']):'');
  }
  function normalize(record, rows=[]) {
    const v=record.values, audit=auditCandidate(v), unique=rows.length===1?rows[0]:null;
    const analyst=text(v['Quien responde el PQR']), validAnalyst=/\d{4,}/.test(analyst)?'':analyst;
    const applies=norm(v.Procede)==='si'?'Aplica':norm(v.Procede)==='no'?'No Aplica':'';
    const flags=[];
    if(audit&&audit!==id(v['ID de auditoría']))flags.push('Columnas desplazadas: ID recuperado; revisar responsable y fechas');
    if(text(v['ID de auditoría'])&&!audit)flags.push('ID de auditoría del Excel no numérico o no interpretable');
    const status=['cerrado','resuelto'].includes(norm(v.Status))?'Cerrado':norm(v.Status)==='abierto'?'En revisión':'Sin estado';
    return {
      origin:'historical',requestType:'PQR',code:`PQR-HIS-${month(unique?.Ola)||sourceMonth(v)||'SIN-MES'}-${record.row}`,sourceRow:record.row,sourceId:text(v.ID),
      auditOriginal:audit,audit:'',pdv:unique?id(unique.ID_de_PDV)||id(v['ID PDV']):id(v['ID PDV']),
      country:country(unique?.pais||v['País campo']),client:study(unique?.Survey)||study(v.Estudio,v.Canal),
      reportingMonth:month(unique?.Ola)||sourceMonth(v),monthSource:month(unique?.Ola)?'Databricks':'Excel',excelMonth:text(v.Mes),
      createdAt:/^20\d{2}-/.test(text(v['Fecha de solicitud']))?text(v['Fecha de solicitud']):null,
      closedAt:/^20\d{2}-/.test(text(v['Fecha de resolución']))?text(v['Fecha de resolución']):null,
      timingComplete:false,status,applies,tipology:text(v.Tipificacion),area:text(v['Adjudicable a']).replace(/OPS\s+Campo\s*\|\s*Validaci[oó]n/i,'OPS Campo/Validación'),
      analystName:validAnalyst,validatorPersonId:validAnalyst?`historical:${validAnalyst}`:'',
      commercialName:text(v.Solicitante),description:text(v['Comentario reclamo']),response:text(v['Comentario Auditoria interna']),
      auditFallback:{nombre_usuario:/^\d+$|^20\d{2}-/.test(text(v['Auditor Campo']))?'':text(v['Auditor Campo']),Validador:/^\d+$|^20\d{2}-/.test(text(v.Validador))?'':text(v.Validador),canal:text(v.Canal),region:text(v.Territorio),Fecha_del_audito:/^20\d{2}-/.test(text(v['Fecha de auditoría']))?text(v['Fecha de auditoría']):''},
      qualityFlags:flags,timeline:[],excelStudy:text(v.Estudio),excelCountry:text(v['País campo'])
    };
  }
  const editable = [ ['auditOriginal','ID de auditoría (histórico)'],['country','País'],['client','Estudio'],['reportingMonth','Mes de auditoría'],['pdv','ID de PDV'],['analystName','Analista de PQR'],['tipology','Tipificación'],['area','Adjudicable a'],['applies','Procede'],['auditAuditor','Auditor de campo'],['auditValidator','Validador de auditoría'],['auditCity','Ciudad'],['auditRegion','Región'] ];
  function resolve(ticket,lookup,correction) {
    const t={...ticket,origin:ticket.origin||'platform'},patch=correction?.patch||{};
    if(t.origin==='historical'&&Object.hasOwn(patch,'auditOriginal'))t.auditOriginal=patch.auditOriginal;
    // Routing must use the same reporting corrections as the cache RLS policy.
    if(Object.hasOwn(patch,'country'))t.country=country(patch.country);
    if(Object.hasOwn(patch,'client'))t.client=study(patch.client);
    const m=window.PQRAudits?.match(t,lookup),row=m?.status==='found'?window.PQRAudits.record(t,m.rows[0]):null;
    t.reportingMonth=month(row?.Ola)||t.reportingMonth||(t.origin==='platform'?text(t.createdAt).slice(0,7):'');
    t.monthSource=month(row?.Ola)?'Databricks':t.monthSource||(t.origin==='platform'?'Radicación':'Excel');
    const surveyStudy=m?.status==='found'&&window.PQRAudits.isSupi(t)?'KO moderno':study(row?.Survey),fallbackStudy=study(t.excelStudy||t.client,t.auditFallback?.canal);
    t.client=surveyStudy||fallbackStudy;
    t.studySource=surveyStudy?window.PQRAudits.source(t):fallbackStudy?(t.origin==='historical'?'Excel':'Plataforma'):'Sin clasificación';
    t.auditSource=window.PQRAudits.source(t);
    if(row){t.country=country(row.pais)||t.country;t.pdv=id(row.ID_de_PDV)||t.pdv;}
    const fallback={...(t.auditFallback||{})};
    for(const field of ['nombre_usuario','Validador'])if(/^\d+$|^20\d{2}-/.test(text(fallback[field])))fallback[field]='';
    t.auditData={...fallback,...Object.fromEntries(Object.entries(row||{}).filter(([,v])=>text(v)))};
    for(const [key] of editable)if(Object.hasOwn(patch,key)&&!key.startsWith('audit'))t[key]=patch[key];
    if(Object.hasOwn(patch,'client')){t.client=study(patch.client);t.studySource=t.client?'Manual':'Sin clasificación';}
    if(Object.hasOwn(patch,'reportingMonth'))t.monthSource='Manual';
    for(const [key,field] of [['auditAuditor','nombre_usuario'],['auditValidator','Validador'],['auditCity','ciudad'],['auditRegion','region']])if(Object.hasOwn(patch,key))t.auditData[field]=patch[key];
    t.hasManualData=Object.keys(patch).length>0;t.correction=correction||null;
    t.matchStatus=m?.status||'pending';
    t.dataIssues=[];
    const closed=['Cerrado','No Aplica'].includes(t.status);
    // This worksheet is an actionable ID queue, not a source-completeness audit.
    if((t.origin==='historical'||closed)&&!window.PQRAudits?.isSupi(t)&&!id(t.auditOriginal)){
      t.dataIssues.push(text(t.auditOriginal)?'ID de auditoría inválido':'Sin ID de auditoría');
    }
    if(patch.analystName)t.validatorPersonId=`reported:${patch.analystName}`;
    return t;
  }
  function pending(tickets) {
    const list=tickets.filter(t=>t.dataIssues?.length);
    return `<section class="card"><h2>Datos por completar</h2><p class="sub">${list.length} casos pendientes por ID de auditoría faltante o inválido. No se incluyen solicitudes de plataforma aún abiertas, ni KO moderno de Chile. Tener un ID válido sin cruce, región u otros datos de Databricks no requiere completar este listado. Los tickets permanecen en los indicadores generales.</p><div class="table-wrap"><table class="table"><thead><tr><th>Radicado / origen</th><th>País / estudio</th><th>Mes</th><th>Información pendiente</th><th>Acción</th></tr></thead><tbody>${list.map(t=>`<tr><td>${esc(t.code)}<small>${t.origin==='historical'?`Excel · fila ${t.sourceRow}`:'Plataforma'}</small></td><td>${esc(t.country)}<small>${esc(t.client)}</small></td><td>${esc(t.reportingMonth||'Sin mes')}</td><td>${esc(t.dataIssues.join(' · '))}</td><td><button class="secondary" data-action="complete-data" data-id="${esc(t.id)}">Completar datos</button></td></tr>`).join('')||'<tr><td colspan="5">No hay IDs de auditoría pendientes en esta selección.</td></tr>'}</tbody></table></div></section>`;
  }
  return {text,norm,id,month,study,studies,country,sourceMonth,auditCandidate,normalize,editable,resolve,pending};
})();
