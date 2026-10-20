const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261020143957_sequential_internal_codes.sql','utf8');
test('one internal sequence shared by PQR/RDG/EDC, year and untruncated padded serial',()=>{
 assert.match(sql,/nextval\('pqr_private.internal_code_seq'\)/);
 assert.match(sql,/p_kind\|\|'-INT-'\|\|extract\(year from now\(\) at time zone 'America\/Bogota'\)/);
 assert.match(sql,/lpad\(serial,greatest\(4,length\(serial\)\),'0'\)/);
 assert.doesNotMatch(sql,/gen_random_bytes|setval|restart with/i);
 assert.match(sql,/revoke all on sequence pqr_private.internal_code_seq from public,anon,authenticated/);
});
test('both previous codes remain private aliases, no ticket content or customer cases change',()=>{
 assert.match(sql,/insert into pqr_private.internal_code_aliases\(old_code,ticket_id\) values\(r.code,r.id\)/);
 assert.match(sql,/a.old_code=v_code and t.deleted_at is null and t.data->>'scope'='internal'/);
 assert.match(sql,/\(t.data-'code'\)=\(r.data-'code'\)/);
 assert.match(sql,/before_receipts is not distinct from after_receipts/);
 assert.match(sql,/before_external is not distinct from/);
 const lookup=sql.slice(sql.indexOf('create or replace function pqr_private.lookup_internal'),sql.indexOf('-- Restore the original serial'));
 assert.match(lookup,/internal_gate\('lookup'\)/);
 assert.doesNotMatch(lookup,/requesterName|requesterEmail|description|timeline|uploadPaths|response/);
 assert.equal((lookup.match(/'code',r.code,'requestType'.*'status',r.status/s)||[]).length,1);
});
