/* Placement and guidance only: no records, credentials or permission changes. */
window.PQRNavigation=(()=>{
  // The old internal entry now opens the menu; #gestion is the private panel.
  const homeRoute=hash=>!hash||hash==='#inicio'||hash==='#internas';
  const header=()=>`<header class="app-header"><div class="brand"><img src="assets/dn-icon-blue.webp" alt=""><div><small>dichter &amp; neira</small>Portal PQR</div></div><nav class="portal-quick-nav" aria-label="Navegación del portal"><a href="#inicio">Inicio</a><a href="#clientes">Área del equipo · con cuenta</a></nav></header>`;
  function home(){
    return `${header()}<main class="portal-entry"><section class="entry-intro"><span class="eyebrow">PORTAL PQR · MENÚ PRINCIPAL</span><h1>¿Qué deseas hacer?</h1><p>Elige entre enviar una solicitud o gestionar los casos del equipo.</p></section><section class="entry-grid" aria-label="Menú principal"><article class="entry-card entry-ticketing"><span class="entry-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 9a2 2 0 0 1 2-2h18a2 2 0 0 1 2 2v5a3 3 0 0 0 0 6v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3a3 3 0 0 0 0-6V9Z" stroke="currentColor" stroke-width="2"/><path d="M19 10v3m0 3v3m0 3v1" stroke="currentColor" stroke-width="2"/></svg></span><span class="entry-access">Sin usuario ni contraseña</span><h2>Ticketera</h2><p>Envía una PQR interna, una redigitación directa o una edición de auditoría. También puedes consultar el estado de tu ticket.</p><div class="entry-kinds"><span>PQR</span><span>Redigitaciones</span><span>Ediciones</span></div><div class="entry-actions"><a class="primary module-link" href="#solicitud-interna">Ir a la ticketera →</a><a class="entry-lookup" href="#consultar-ticket">Consultar mi ticket</a></div></article><article class="entry-card entry-management"><span class="entry-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="6" y="7" width="20" height="20" rx="3" stroke="currentColor" stroke-width="2"/><rect x="12" y="4" width="8" height="6" rx="2" fill="white" stroke="currentColor" stroke-width="2"/><path d="m10 16 2 2 4-4m2 3h4m-12 6h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="entry-access">Acceso del equipo autorizado</span><h2>Gestión de analistas</h2><p>Ingresa para asignar, revisar y responder solicitudes. Dentro del panel podrás cambiar entre PQR internas y PQR de clientes.</p><p class="entry-team">Analistas · Redigitación · Gerencia · Administración</p><div class="entry-actions"><a class="primary module-link" href="#gestion">Entrar a gestión de analistas →</a><small>Requiere el usuario y la contraseña asignados por Administración.</small></div></article></section><p class="entry-client-access">¿Tienes una cuenta Comercial para PQR de clientes? <a href="#clientes">Ingresa aquí</a>.</p></main>`;
  }
  function workspaceNav(scope,role){
    const team=['validador','redigitador','gerente','admin'].includes(role);
    const switcher=team?`<div class="workspace-switch" role="group" aria-label="Tipo de bandeja">${[
      ['external','clients','PQR de clientes'],['internal','ticket','PQR internas']
    ].map(([value,glyph,label])=>`<button type="button" data-action="workspace" data-scope="${value}" class="workspace-tab${scope===value?' active':''}" aria-current="${scope===value?'page':'false'}">${icon(glyph)}<span>${label}</span></button>`).join('')}</div>`:`<span class="workspace-label">${icon('clients')}PQR de clientes</span>`;
    return `<nav class="workspace-toolbar layout" aria-label="Navegación de bandejas"><a class="workspace-home" href="#inicio" aria-label="Inicio" title="Inicio">${icon('home')}</a>${switcher}<a class="workspace-create" href="#solicitud-interna" aria-label="Nueva solicitud interna sin cuenta" title="Enviar una solicitud interna">${icon('plus')}<span>Nueva interna</span></a></nav>`;
  }
  const glyphs={
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    clients:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5"/>',
    ticket:'<path d="M4 7h16v4a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Z"/><path d="M15 7v3m0 3v2m0 2v1"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
    back:'<path d="M19 12H5m5-5-5 5 5 5"/>',
    edit:'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z"/>',
    refresh:'<path d="M20 8a8 8 0 0 0-13-3L4 8m0-5v5h5m-5 8a8 8 0 0 0 13 3l3-3m0 5v-5h-5"/>',
    check:'<path d="m5 12 4 4L19 6"/>'
  };
  function icon(name){return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]||glyphs.ticket}</svg>`;}
  function publicHeader(){return `<header class="app-header public-header"><a class="brand" href="#inicio" aria-label="Portal PQR · Menú principal"><img src="assets/dn-icon-blue.webp" alt=""><div><small>dichter &amp; neira</small>Ticketera interna</div></a><nav class="public-header-actions" aria-label="Navegación de la ticketera"><a href="#inicio">${icon('back')}Menú principal</a><a href="#gestion" class="team-access">${icon('lock')}Gestión del equipo</a></nav></header>`;}
  function intakeChoices(){return `<div class="internal-flow-cards intake-choices" role="group" aria-label="Elige el tipo de solicitud">${[
    ['PQR','ticket','PQR interna','Analistas revisa tu solicitud y coordina la solución.'],
    ['RDG','refresh','Redigitación directa','Solicita una nueva auditoría al equipo de Redigitación.'],
    ['EDC','edit','Edición de auditoría','Pide un ajuste en la auditoría existente, sin crear otra.']
  ].map(([kind,glyph,title,description])=>`<button type="button" data-intake-kind="${kind}" aria-pressed="${kind==='PQR'}" aria-label="Seleccionar ${title}"><span class="choice-icon">${icon(glyph)}</span><span class="choice-content"><strong>${title}</strong><span>${description}</span></span><span class="choice-check">${icon('check')}</span></button>`).join('')}</div>`;}
  function publicTabs(active){return `<nav class="internal-public-tabs" aria-label="Hojas de la ticketera interna"><a href="#solicitud-interna" ${active==='send'?'aria-current="page"':''}>Enviar solicitud</a><a href="#consultar-ticket" ${active==='lookup'?'aria-current="page"':''}>Consultar mi ticket</a></nav>`;}
  function publicIntro(){return `<nav class="public-breadcrumb" aria-label="Ruta de navegación"><a href="#inicio">Inicio</a><span aria-hidden="true">/</span><span>Ticketera interna</span></nav>${publicTabs('send')}<aside class="public-placement-note">${icon('lock')}<div><strong>Envía tu solicitud sin crear una cuenta</strong><p>El equipo la atenderá en su bandeja interna. Después podrás seguir el estado con tu radicado.</p></div></aside>`;}
  function loginInfo(scope){return `<div class="login-module-context"><a href="#inicio">← Volver al menú principal</a><p><strong>${scope==='internal'?'Gestión de analistas · PQR internas':'Módulo de PQR de clientes'}</strong></p><p>Este acceso es para usuarios con cuenta. Ingresa con el usuario asignado por Administración.</p><a href="#solicitud-interna">Solo quiero enviar una solicitud interna, sin cuenta →</a></div>`;}
  return{homeRoute,home,workspaceNav,publicIntro,publicTabs,loginInfo,icon,publicHeader,intakeChoices};
})();

