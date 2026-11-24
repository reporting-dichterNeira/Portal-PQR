/* Production scopes: client and internal queues are never combined implicitly. */
window.PQRScopes=(()=>{
  const of=t=>t.scope==='internal'?'internal':'external';
  const select=(tickets,scope)=>tickets.filter(t=>of(t)===scope);
  const label=scope=>scope==='internal'?'PQR internas':'PQR de clientes';
  const eligible=role=>['validador','gerente','redigitador','admin','campo'].includes(role);
  const forRole=(scope,role)=>role==='campo'?'internal':scope;
  return{of,select,label,eligible,forRole};
})();

