// One-time setup: generate in memory, send through stdin, print only SHA-256.
// Never read or reuse another project's secret, and never overwrite an existing scope.
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
const scope='portal-pqr-audit-sync';
const call=(args,options={})=>execFileSync('databricks',[...args,'-p','reporting','-o','json'],{encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe'],...options});
try {
  const result=JSON.parse(call(['secrets','list-scopes']));
  const scopes=Array.isArray(result)?result:result.scopes||[];
  if(scopes.some(item=>item.name===scope))throw Error('SCOPE_EXISTS: refusing to overwrite its key');
  call(['secrets','create-scope',scope,'--initial-manage-principal','users']);
  let token=randomBytes(48).toString('base64url');
  call(['secrets','put-secret',scope,'receiver-token'],{input:token});
  console.log(JSON.stringify({scope,key:'receiver-token',sha256:createHash('sha256').update(token).digest('hex')}));
  token='';
} catch(error) {
  console.error(error.message?.startsWith('SCOPE_EXISTS')?error.message:'Receiver setup failed; inspect scope/key metadata before retrying. No key was printed.');
  process.exitCode=1;
}
