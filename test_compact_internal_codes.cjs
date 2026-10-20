const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261020142435_compact_internal_codes.sql','utf8');
test('internal codes shorten to 19 chars while retaining 65 random bits',()=>{
 assert.match(sql,/alphabet constant text:='0123456789ABCDEFGHJKMNPQRSTVWXYZ'/);
 assert.match(sql,/extensions\.gen_random_bytes\(13\)/);
 assert.match(sql,/get_byte\(entropy,i\)%32/);
 assert.match(sql,/candidate:=p_kind\|\|'-I-'/);
 assert.match(sql,/code:=pqr_private\.new_internal_code\(kind\)/);
 assert.match(sql,/matched_generator is not null/);
});
test('legacy aliases are private, scope-checked and preserve data on rename',()=>{
 assert.match(sql,/internal_code_aliases enable row level security/);
 assert.match(sql,/revoke all on pqr_private\.internal_code_aliases from public,anon,authenticated/);
 assert.match(sql,/a\.old_code=v_code and t\.deleted_at is null and t\.data->>'scope'='internal'/);
 assert.match(sql,/\(t\.data-'code'\)=\(r\.data-'code'\)/);
 assert.match(sql,/before_receipts is not distinct from after_receipts/);
 assert.match(sql,/pqr_private\.internal_gate\('lookup'\)/);
 assert.doesNotMatch(sql,/grant (?:select|all) on .*internal_code_aliases/i);
});
