// Input files stay local. Never commit the generated SQL/JSON or place it in docs/.
// Usage: node scripts/prepare_history_import.mjs source.json lookup.json tmp/legacy-pqr 2026-09
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
const [sourceFile,lookupFile,outputDirectory,period]=process.argv.slice(2);
if(!sourceFile||!lookupFile||!outputDirectory||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))throw Error('Supply source.json, lookup.json, private output directory, YYYY-MM');
const output=path.resolve(outputDirectory),privateRoot=path.resolve('tmp');
if(!output.startsWith(privateRoot+path.sep))throw Error('Output must be under ignored tmp/');
const ctx=vm.createContext({window:{}});vm.runInContext(await fs.readFile('docs/assets/history.js','utf8'),ctx);
const h=ctx.window.PQRHistory,source=JSON.parse(await fs.readFile(sourceFile,'utf8')),lookup=JSON.parse(await fs.readFile(lookupFile,'utf8'));
if(source.sha256!==lookup.sha256)throw Error('Source/lookup fingerprints differ');
const sheet=source.sheets.find(s=>s.sheet==='BASE REQUERIDA PQR KO');if(!sheet)throw Error('Authoritative worksheet missing');
const selected=[],duplicates=[],sensitive=[],seen=new Map(),counts={};
for(const record of sheet.records){
 const aid=h.auditCandidate(record.values);
 if(aid&&!Object.hasOwn(lookup.records,aid))throw Error('Lookup incomplete; query errors are not unmatched IDs');
 const rows=aid?lookup.records[aid]:[],t=h.normalize(record,rows);if(t.reportingMonth!==period)continue;
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(record.values)).digest('hex');
 if(seen.has(fingerprint)){duplicates.push({row:record.row,duplicateOf:seen.get(fingerprint)});continue;}seen.set(fingerprint,record.row);
 if(/contrase[nñ]a|password|credencial|clave de acceso/i.test([t.description,t.response].join(' ')))sensitive.push(record.row);
 const hash=crypto.createHash('sha256').update(`${source.sha256}:${sheet.sheet}:${record.row}`).digest('hex');
 t.id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 t.code=`PQR-HIS-${period}-${record.row}`;
 selected.push({id:t.id,source_hash:source.sha256,source_sheet:sheet.sheet,source_row:record.row,source_data:record.values,data:t});
 const key=rows.length===1?'matched':rows.length?'ambiguous':aid?'notFound':'noId';counts[key]=(counts[key]||0)+1;
}
if(sensitive.length)throw Error(`Credential-related comments require private review in source rows: ${sensitive.join(',')}`);
await fs.mkdir(output,{recursive:true});
const jsonSql=value=>{const json=JSON.stringify(value);if(json.includes('$pqr_import$'))throw Error('SQL delimiter collision');return `$pqr_import$${json}$pqr_import$::jsonb`;};
const files=[];
for(let offset=0;offset<selected.length;offset+=200){
 const batch=selected.slice(offset,offset+200),name=`history-${String(offset/200+1).padStart(2,'0')}.sql`;
 const sql=`begin;\ninsert into public.pqr_historical_cases(id,source_hash,source_sheet,source_row,source_data,data)\nselect id,source_hash,source_sheet,source_row,source_data,data from jsonb_to_recordset(${jsonSql(batch)}) as x(id uuid,source_hash text,source_sheet text,source_row integer,source_data jsonb,data jsonb)\non conflict (source_hash,source_sheet,source_row) do nothing;\ncommit;\nselect count(*) as imported from public.pqr_historical_cases where source_hash='${source.sha256}';\n`;
 await fs.writeFile(path.join(output,name),sql);files.push({name,bytes:Buffer.byteLength(sql),rows:batch.length});
}
const ids=[...new Set(selected.map(r=>r.data.auditOriginal).filter(Boolean))],runId=crypto.randomUUID();
for(let offset=0;offset<ids.length;offset+=200){
 const batch=ids.slice(offset,offset+200).map(audit_id=>({audit_id,records:lookup.records[audit_id]})),name=`cache-${String(offset/200+1).padStart(2,'0')}.sql`;
 const sql=`begin;\ninsert into public.pqr_audit_cache(audit_id,records,checked_at,run_id)\nselect audit_id,records,now(),'${runId}'::uuid from jsonb_to_recordset(${jsonSql(batch)}) as x(audit_id text,records jsonb)\non conflict(audit_id) do nothing;\ncommit;\nselect count(*) as cache_entries from public.pqr_audit_cache;\n`;
 await fs.writeFile(path.join(output,name),sql);files.push({name,bytes:Buffer.byteLength(sql),rows:batch.length});
}
const manifest={sourceHash:source.sha256,sheet:sheet.sheet,period,selected:selected.length,counts,exactDuplicatesSkipped:duplicates,files,uniqueAuditIds:ids.length,createdAt:new Date().toISOString(),lookupCompletedAt:lookup.checkedAt};
await fs.writeFile(path.join(output,'prepared.json'),JSON.stringify(selected));await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
