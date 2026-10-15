# Databricks notebook source
"""Scheduled PQR audit push. No personal Databricks token."""
import re
import time
import uuid
import requests

CALLBACK_URL = 'https://niwkegxwwwoahcbsoujy.supabase.co/functions/v1/pqr-audit-sync'
FIELDS = ['ID_de_audito','ID_de_PDV','Ola','pais','segmento','canal',
          'Fecha_del_audito','FechaInicioValidacion','Survey','ciudad','region',
          'nombre_usuario','Validador','Estado']

def query_for(ids):
    if not ids or len(ids)>100 or any(not isinstance(v,str) or not re.fullmatch(r'[0-9]{1,30}',v) for v in ids):
        raise ValueError('Invalid audit IDs')
    columns = ', '.join(f'CAST(`{f}` AS STRING) AS `{f}`' for f in FIELDS)
    literals = ','.join(f"'{v}'" for v in ids)
    return f"""SELECT DISTINCT {columns}
    FROM hive_metastore.storeview.slv_sv_ceres_ag_export
    WHERE TRY_CAST(RIGHT(`Ola`,4) AS INT) >= 2026
      AND (LOWER(Survey) LIKE '%ko%' OR LOWER(Survey) LIKE '%lindley%')
      AND TRIM(CAST(ID_de_audito AS STRING)) IN ({literals})
    LIMIT 2001"""

def run_sync(spark_session,secrets):
    token=secrets.get(scope='portal-pqr-audit-sync',key='receiver-token').strip()
    session=requests.Session()
    run_id=str(uuid.uuid4())
    def send(body):
        for attempt in range(4):
            try:
                response=session.post(CALLBACK_URL,headers={'x-pqr-sync-token':token},json=body,timeout=90)
            except requests.RequestException:
                if attempt==3: raise RuntimeError('PQR receiver unavailable') from None
                time.sleep(2**attempt)
                continue
            if response.ok: return response.json()
            if response.status_code in (429,500,502,503,504) and attempt<3:
                time.sleep(2**attempt)
                continue
            raise RuntimeError(f'PQR receiver HTTP {response.status_code}')
    cursor=''
    total=found=missing=ambiguous=0
    try:
        while True:
            manifest=send({'action':'manifest','after':cursor})
            ids=manifest.get('ids')
            if not isinstance(ids,list) or len(ids)>100: raise ValueError('Invalid manifest')
            if not ids: break
            query=query_for(ids)
            if ids!=sorted(set(ids)) or ids[0]<=cursor: raise ValueError('Invalid order')
            rows=spark_session.sql(query).collect()
            if len(rows)>2000: raise ValueError('Truncated result; previous cache preserved')
            records={audit:[] for audit in ids}
            for source in rows:
                item=source.asDict()
                if any(f not in item for f in FIELDS): raise ValueError('Missing fields')
                row={f:None if item[f] is None else str(item[f]).strip() for f in FIELDS}
                audit=row['ID_de_audito']
                if audit not in records or any(v is not None and len(v)>1000 for v in row.values()):
                    raise ValueError('Invalid source record')
                records[audit].append(row)
                if len(records[audit])>20: raise ValueError('Too many matches; previous cache preserved')
            send({'action':'publish','runId':run_id,'entries':[{'auditId':audit,'rows':records[audit]} for audit in ids]})
            total+=len(ids)
            found+=sum(len(v)==1 for v in records.values())
            missing+=sum(len(v)==0 for v in records.values())
            ambiguous+=sum(len(v)>1 for v in records.values())
            following=manifest.get('next')
            if following is None: break
            if following!=ids[-1]: raise ValueError('Invalid cursor')
            cursor=following
    finally:
        session.close()
    print(f'PQR audit sync: {total} checked, {found} matched, {missing} not found, {ambiguous} ambiguous')

if 'dbutils' in globals() and 'spark' in globals():
    run_sync(spark,dbutils.secrets)
