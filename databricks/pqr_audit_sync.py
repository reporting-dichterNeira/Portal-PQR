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

def query_for_pdvs(targets):
    if not targets or len(targets)>100:
        raise ValueError('Invalid PDV targets')
    values=[]
    for t in targets:
        if (not re.fullmatch(r'[a-f0-9]{32}',t.get('target_key',''))
            or not re.fullmatch(r'[0-9]{1,80}',t.get('pdv',''))
            or not re.fullmatch(r'[a-z ]{1,50}',t.get('country',''))
            or t.get('study') not in ('ko moderno','ko tradicional','lindley')):
            raise ValueError('Invalid PDV tuple')
        values.append('('+','.join("'"+t[k]+"'" for k in ('target_key','pdv','country','study'))+')')
    # This new lookup alone uses 60 calendar days including today, in Bogota.
    # Audit-ID enrichment above deliberately retains its original scope.
    return f"""WITH targets(target_key,pdv,country,study) AS (VALUES {','.join(values)}),
    clock AS (SELECT CAST(from_utc_timestamp(current_timestamp(),'America/Bogota') AS DATE) AS today),
    source AS (
      SELECT DISTINCT TRIM(CAST(ID_de_PDV AS STRING)) AS pdv,
        REGEXP_REPLACE(LOWER(TRANSLATE(TRIM(pais),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')), '\\\\s+', ' ') AS country,
        CASE WHEN LOWER(Survey) RLIKE '(^|[^a-z])lindley([^a-z]|$)' THEN 'lindley'
          WHEN LOWER(Survey) RLIKE '(^|[^a-z])ko[ _-]+mod(erno)?([^a-z]|$)' THEN 'ko moderno'
          WHEN LOWER(Survey) RLIKE '(^|[^a-z])ko[ _-]+trad(icional)?([^a-z]|$)' THEN 'ko tradicional' ELSE '' END AS study,
        TRIM(CAST(ID_de_audito AS STRING)) AS auditId, TRY_CAST(Fecha_del_audito AS TIMESTAMP) AS audit_at,
        CAST(Ola AS STRING) AS ola, CAST(Survey AS STRING) AS survey
      FROM hive_metastore.storeview.slv_sv_ceres_ag_export
      WHERE TRY_CAST(RIGHT(`Ola`,4) AS INT)>=2026
        AND TRIM(CAST(ID_de_PDV AS STRING)) IN ({','.join("'"+t['pdv']+"'" for t in targets)})
        AND (LOWER(Survey) LIKE '%ko%' OR LOWER(Survey) LIKE '%lindley%')
    ), ranked AS (
      SELECT t.target_key AS key,s.*,ROW_NUMBER() OVER(PARTITION BY t.target_key
        ORDER BY s.audit_at DESC,TRY_CAST(s.auditId AS DECIMAL(38,0)) DESC,s.auditId DESC,s.survey DESC,s.ola DESC) AS rn
      FROM targets t JOIN source s ON s.pdv=t.pdv AND s.country=t.country AND s.study=t.study CROSS JOIN clock c
      WHERE s.auditId RLIKE '^[0-9]{{1,30}}$' AND CAST(s.audit_at AS DATE) BETWEEN DATE_SUB(c.today,59) AND c.today
    ) SELECT key,pdv,country,study,auditId,CAST(audit_at AS STRING) AS auditDate,ola,survey FROM ranked WHERE rn=1"""

def sync_pdv_suggestions(spark_session,send,run_id):
    cursor=''
    total=found=0
    while True:
        manifest=send({'action':'pdv_manifest','after':cursor})
        targets=manifest.get('targets')
        if not isinstance(targets,list) or len(targets)>100: raise ValueError('Invalid PDV manifest')
        if not targets: break
        keys=[t['target_key'] for t in targets]
        if keys!=sorted(set(keys)) or keys[0]<=cursor: raise ValueError('Invalid PDV order')
        rows=spark_session.sql(query_for_pdvs(targets)).collect()
        if len(rows)>len(targets): raise ValueError('Invalid ranked PDV result')
        records={}
        for source in rows:
            item={k:None if v is None else str(v).strip() for k,v in source.asDict().items()}
            key=item.get('key')
            if key not in keys or key in records: raise ValueError('Unexpected PDV result')
            target=targets[keys.index(key)]
            if any(item.get(k)!=target[k] for k in ('pdv','country','study')): raise ValueError('PDV tuple mismatch')
            records[key]=item
        entries=[records.get(t['target_key'],{'key':t['target_key'],'pdv':t['pdv'],'country':t['country'],'study':t['study'],'auditId':None}) for t in targets]
        send({'action':'pdv_publish','runId':run_id,'entries':entries})
        total+=len(targets);found+=len(records)
        following=manifest.get('next')
        if following is None: break
        if following!=keys[-1]: raise ValueError('Invalid PDV cursor')
        cursor=following
    print(f'PQR PDV suggestions: {total} checked, {found} matched in last 60 days')

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
        sync_pdv_suggestions(spark_session,send,run_id)
    finally:
        session.close()
    print(f'PQR audit sync: {total} checked, {found} matched, {missing} not found, {ambiguous} ambiguous')

if 'dbutils' in globals() and 'spark' in globals():
    run_sync(spark,dbutils.secrets)
