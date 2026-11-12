/* The server honors this choice only for an active Universal account. */
window.PQRUniversal=(()=>{
  const profiles=[
    {role:'validador',title:'Analistas de PQR',description:'Asigna solicitudes, registra dictámenes y verifica las redigitaciones.',icon:'ticket'},
    {role:'redigitador',title:'Redigitación',description:'Asigna responsables y gestiona redigitaciones y ediciones de auditoría.',icon:'refresh'},
    {role:'gerente',title:'Gerencia',description:'Consulta indicadores, filtros, históricos y el detalle de las auditorías.',icon:'clients'}
  ];
  const allowed=role=>profiles.some(p=>p.role===role);
  let selected='',owner='';
  function reset(){selected='';owner='';}
  function identity(profile){
    if(owner!==profile.id||profile.role!=='universal'){selected='';owner=profile.id;}
    return profile.role==='universal'?{...profile,isUniversal:true,role:allowed(selected)?selected:'universal'}:profile;
  }
  function choose(role){if(!allowed(role))throw Error('Perfil no permitido.');selected=role;}
  function menu(profile,esc,icon){
    return `<header class="app-header"><div class="brand"><img src="assets/dn-icon-blue.webp" alt=""><div><small>dichter &amp; neira</small>Portal PQR</div></div><div class="user"><strong>${esc(profile.name)}</strong><button class="ghost" data-action="logout">Salir</button></div></header><main class="universal-menu layout"><section class="universal-intro"><span class="eyebrow">ACCESO UNIVERSAL</span><h1>¿En qué panel deseas trabajar?</h1><p>Selecciona un perfil para comenzar. Puedes cambiar de panel desde el botón «Cambiar perfil».</p><p id="universal-loading" role="status" aria-live="polite"></p></section><section class="universal-profiles" aria-label="Perfiles disponibles">${profiles.map(p=>`<button type="button" class="universal-profile" data-action="universal-profile" data-profile="${p.role}"><span class="universal-icon">${icon(p.icon)}</span><strong>${p.title}</strong><span>${p.description}</span><span class="universal-enter">Entrar al panel →</span></button>`).join('')}</section></main>`;
  }
  async function fetchWithProfile(input,init){
    const endpoint=new URL(typeof input==='string'?input:input.url);
    if(endpoint.origin==='https://niwkegxwwwoahcbsoujy.supabase.co'&&/^\/(rest|functions|storage)\/v1\//.test(endpoint.pathname)){
      const headers=new Headers(init?.headers||(typeof input!=='string'?input.headers:undefined));
      headers.delete('x-pqr-profile');if(allowed(selected))headers.set('x-pqr-profile',selected);
      return fetch(input,{...init,headers});
    }
    return fetch(input,init);
  }
  return{profiles,allowed,identity,choose,reset,menu,fetchWithProfile};
})();
