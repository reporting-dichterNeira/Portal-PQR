// Only fixed SELECT queries are accepted. No SQL, host or cluster comes from the browser.
export const HOST = 'https://adb-7299547680484260.0.azuredatabricks.net';
export const FIELDS = ['ID_de_audito','ID_de_PDV','Ola','pais','segmento','canal','Fecha_del_audito','FechaInicioValidacion','Survey','ciudad','region','nombre_usuario','Validador','Estado'];
export const auditId = value => /^\d{1,30}$/.test(String(value ?? '').trim()) ? String(value).trim() : '';

export function idsForTickets(tickets) {
  return [...new Set(tickets.flatMap(t => [auditId(t.auditOriginal),auditId(t.audit)]).filter(Boolean))];
}

export function buildQuery(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !auditId(id))) throw new Error('INVALID_IDS');
  const columns = FIELDS.map(field => `CAST(\`${field}\` AS STRING) AS \`${field}\``).join(', ');
  // TRY_CAST keeps malformed Ola values from failing the entire lookup.
  return `SELECT DISTINCT ${columns}\nFROM hive_metastore.storeview.slv_sv_ceres_ag_export\nWHERE TRY_CAST(RIGHT(\`Ola\`,4) AS INT) >= 2026\nAND (LOWER(Survey) LIKE '%ko%' OR LOWER(Survey) LIKE '%lindley%')\nAND TRIM(CAST(ID_de_audito AS STRING)) IN (${[...new Set(ids)].map(id => `'${auditId(id)}'`).join(',')})\nLIMIT 1001`;
}

export function parseResult(results, ids) {
  if (results?.resultType !== 'table' || results.truncated || !Array.isArray(results.data) || results.data.length > 1000) throw new Error('INCOMPLETE_RESULT');
  const schema = results.schema;
  if (!Array.isArray(schema)) throw new Error('INVALID_RESULT');
  const indexes = FIELDS.map(field => schema.findIndex(col => String(col.name).toLowerCase() === field.toLowerCase()));
  if (indexes.some(index => index < 0)) throw new Error('INVALID_RESULT');
  const allowed = new Set(ids), records = Object.fromEntries(ids.map(id => [id,[]]));
  for (const cells of results.data) {
    const row = Object.fromEntries(FIELDS.map((field,i) => [field,cells[indexes[i]] == null ? null : String(cells[indexes[i]])]));
    const id = auditId(row.ID_de_audito);
    if (allowed.has(id)) records[id].push(row);
  }
  return records;
}

export async function queryCluster({clusterId,token,ids,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}) {
  if (!/^[a-zA-Z0-9-]+$/.test(clusterId || '') || !token) throw new Error('NOT_CONFIGURED');
  const query = buildQuery(ids);
  async function api(path,body) {
    const response = await fetchImpl(`${HOST}${path}`, {
      method: body ? 'POST' : 'GET', redirect:'error',
      headers: {Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'DATABRICKS_ACCESS' : 'DATABRICKS_UNAVAILABLE');
    return await response.json();
  }
  const cluster = await api(`/api/2.0/clusters/get?cluster_id=${encodeURIComponent(clusterId)}`);
  if (cluster.state !== 'RUNNING') throw new Error('CLUSTER_STOPPED');
  let contextId, commandId, terminal = false;
  try {
    const context = await api('/api/1.2/contexts/create',{clusterId,language:'sql'});
    contextId = String(context.id || '');
    if (!contextId) throw new Error('DATABRICKS_UNAVAILABLE');
    const command = await api('/api/1.2/commands/execute',{clusterId,contextId,language:'sql',command:query});
    commandId = String(command.id || '');
    if (!commandId) throw new Error('DATABRICKS_UNAVAILABLE');
    const deadline = now()+45000;
    while (now() < deadline) {
      const result = await api(`/api/1.2/commands/status?clusterId=${encodeURIComponent(clusterId)}&contextId=${encodeURIComponent(contextId)}&commandId=${encodeURIComponent(commandId)}`);
      if (['Finished','Error','Cancelled'].includes(result.status)) {
        terminal = true;
        if (result.status !== 'Finished' || result.results?.resultType === 'error') throw new Error('QUERY_FAILED');
        return parseResult(result.results,ids);
      }
      await sleep(1000);
    }
    throw new Error('QUERY_TIMEOUT');
  } finally {
    // Destroy only the context created here; never touch user notebooks or cluster lifecycle.
    if (commandId && !terminal) await api('/api/1.2/commands/cancel',{clusterId,contextId,commandId}).catch(()=>{});
    if (contextId) await api('/api/1.2/contexts/destroy',{clusterId,contextId}).catch(()=>{});
  }
}
