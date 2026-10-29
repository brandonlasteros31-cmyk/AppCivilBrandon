const SHARE_TOKEN = 'cc_share_token';
const shareRoot = document.getElementById('shareRoot');
let sharedReportItems = [];
let liveAuditLog = [];
let liveWorkspace = {};
let liveRevision = -1;
let liveSyncTimer = null;
let liveSyncBusy = false;
let currentUser = null;
let sourceSaveTimer = null;
let projectSaveTimer = null;
let workerDraft = { report: {}, valuation: {}, conformity: {} };
let workerDraftTimer = null;
let workerDraftLoading = false;
let workerDraftLoadedFor = '';

function shareEscape(value) {
  return esc(String(value ?? ''));
}

function roleLabel(role) {
  if (role === 'admin') return 'Administrador';
  if (role === 'staff') return 'Trabajador';
  return 'Invitación pendiente';
}

function shareMessage(text, isError = false) {
  const gate = document.getElementById('entryGate');
  const box = gate && gate.style.display !== 'none'
    ? document.getElementById('entryMessage')
    : document.getElementById('shareMessage');
  if (!box) return;
  box.textContent = text;
  box.style.color = isError ? 'var(--bad)' : 'var(--ok)';
}

function closeEntryGate() {
  const gate = document.getElementById('entryGate');
  if (gate) gate.style.display = 'none';
  document.body.style.overflow = '';
}

let ubigeoCatalog = null;
let ubigeoReady = null;

function prepareProjectForm() {
  const locationInput = document.getElementById('location');
  if (locationInput) {
    const field = locationInput.closest('.field');
    field.innerHTML = '<label>Ubicación del proyecto</label><div class="grid2"><div class="field"><label>Departamento</label><select id="projectDepartment"><option value="">Selecciona un departamento</option></select></div><div class="field"><label>Provincia</label><select id="projectProvince" disabled><option value="">Primero selecciona un departamento</option></select></div><div class="field"><label>Distrito</label><select id="projectDistrict" disabled><option value="">Primero selecciona una provincia</option></select></div></div>';
  }
  const projectCard = document.getElementById('projectName')?.closest('.card');
  if (projectCard && !document.getElementById('projectAccessMessage')) {
    const message = document.createElement('p');
    message.id = 'projectAccessMessage';
    message.className = 'mini';
    message.textContent = 'Solo el administrador puede editar la información del proyecto.';
    projectCard.insertBefore(message, projectCard.querySelector('#projectName').parentElement);
  }
  document.getElementById('projectDepartment')?.addEventListener('change', () => {
    populateProjectProvinces();
    populateProjectDistricts();
  });
  document.getElementById('projectProvince')?.addEventListener('change', populateProjectDistricts);
  const saveButton = document.getElementById('saveProject');
  if (saveButton) saveButton.onclick = saveSharedProject;
  ubigeoReady = loadUbigeoCatalog();
  setProjectAccess(null);
  bindAutosave();
}

async function loadUbigeoCatalog() {
  try {
    ubigeoCatalog = await fetch('/centro-control-ubigeo.json', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('No se pudo cargar la lista de ubicaciones.');
      return response.json();
    });
    const select = document.getElementById('projectDepartment');
    if (!select) return;
    select.innerHTML = '<option value="">Selecciona un departamento</option>' + ubigeoCatalog.departments.map(item => `<option value="${shareEscape(item.id)}">${shareEscape(item.name)}</option>`).join('');
  } catch (error) {
    const select = document.getElementById('projectDepartment');
    if (select) select.innerHTML = '<option value="">No se pudo cargar la lista</option>';
    console.error(error);
  }
}

function populateProjectProvinces(selectedCode = '') {
  const department = document.getElementById('projectDepartment')?.value;
  const select = document.getElementById('projectProvince');
  if (!select) return;
  const provinces = (ubigeoCatalog?.provinces || []).filter(item => String(item.department_id) === String(department));
  select.disabled = !department;
  select.innerHTML = '<option value="">Selecciona una provincia</option>' + provinces.map(item => `<option value="${shareEscape(item.id)}">${shareEscape(item.name)}</option>`).join('');
  if (selectedCode) select.value = selectedCode;
}

function populateProjectDistricts(selectedCode = '') {
  const province = document.getElementById('projectProvince')?.value;
  const select = document.getElementById('projectDistrict');
  if (!select) return;
  const districts = (ubigeoCatalog?.districts || []).filter(item => String(item.province_id) === String(province));
  select.disabled = !province;
  select.innerHTML = '<option value="">Selecciona un distrito</option>' + districts.map(item => `<option value="${shareEscape(item.id)}">${shareEscape(item.name)}</option>`).join('');
  if (selectedCode) select.value = selectedCode;
}

function setProjectAccess(me) {
  const email = String(me?.email || '').trim().toLowerCase();
  const role = String(me?.role || '').trim().toLowerCase();
  const canEdit = role === 'admin' && email === 'brandonlasteros31@gmail.com';
  const ids = ['projectName', 'entity', 'projectCode', 'cutoff', 'projectDesc', 'projectDepartment', 'projectProvince', 'projectDistrict'];
  ids.forEach(id => {
    const control = document.getElementById(id);
    if (control) control.disabled = !canEdit;
  });
  const save = document.getElementById('saveProject');
  if (save) save.hidden = !canEdit;
  const message = document.getElementById('projectAccessMessage');
  if (message) message.textContent = canEdit
    ? `Sesión: ${email} · Administrador. Puedes editar y guardar el proyecto.`
    : me
      ? `Sesión: ${email} · ${roleLabel(role)}. Esta cuenta solo puede ver el proyecto.`
      : 'Inicia sesión con brandonlasteros31@gmail.com para editar el proyecto.';
}

async function loadSharedProject() {
  try {
    if (ubigeoReady) await ubigeoReady;
    const me = await shareApi('/api/me');
    currentUser = me;
    if (me.role === 'staff' && workerDraftLoadedFor !== me.email) {
      const savedDraft = await shareApi('/api/draft');
      workerDraft = savedDraft.draft || workerDraft;
      workerDraftLoadedFor = me.email;
    }
    const saved = await shareApi('/api/project');
    setProjectAccess(me);
    ['name', 'entity', 'code', 'cutoff', 'description'].forEach(key => {
      const inputId = { name: 'projectName', entity: 'entity', code: 'projectCode', cutoff: 'cutoff', description: 'projectDesc' }[key];
      const field = document.getElementById(inputId);
      if (field && saved[key] !== undefined) field.value = saved[key];
    });
    if (ubigeoCatalog && saved.departmentCode) {
      document.getElementById('projectDepartment').value = saved.departmentCode;
      populateProjectProvinces(saved.provinceCode);
      populateProjectDistricts(saved.districtCode);
    }
    project = { name: saved.name || '', entity: saved.entity || '', location: saved.location || '', code: saved.code || '', cutoff: saved.cutoff || today(), desc: saved.description || '' };
    renderReportDocument();
    await refreshLiveState(true);
    startLiveSync();
  } catch (error) {
    setProjectAccess(null);
    const message = document.getElementById('projectAccessMessage');
    if (message) message.textContent = `No se pudo verificar el acceso: ${error.message}`;
  }
}

async function saveSharedProject(silent = false) {
  try {
    await shareApi('/api/project', { method: 'POST', body: JSON.stringify({
      name: document.getElementById('projectName').value,
      entity: document.getElementById('entity').value,
      code: document.getElementById('projectCode').value,
      cutoff: document.getElementById('cutoff').value,
      description: document.getElementById('projectDesc').value,
      departmentCode: document.getElementById('projectDepartment').value,
      provinceCode: document.getElementById('projectProvince').value,
      districtCode: document.getElementById('projectDistrict').value
    }) });
    await loadSharedProject();
    if (!silent) toast('Informacion del proyecto guardada para todos.');
  } catch (error) {
    if (silent) shareMessage(error.message, true); else alert(error.message);
  }
}

async function renderEntryGate(message = '') {
  let status;
  try {
    status = await shareApi('/api/status');
    const me = await shareApi('/api/me').catch(() => null);
    if (me) {
      closeEntryGate();
      await loadSharedProject();
      return;
    }
  } catch {
    status = { setup: false };
    sessionStorage.removeItem(SHARE_TOKEN);
  }
    setProjectAccess(null);
  let gate = document.getElementById('entryGate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'entryGate';
    document.body.appendChild(gate);
  }
  gate.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow:auto;background:var(--bg);display:grid;place-items:center;padding:18px';
  document.body.style.overflow = 'hidden';
  if (status.setup) {
    gate.innerHTML = `<div class="card" style="width:min(440px,100%);margin:0"><h2>Crear acceso de administrador</h2><p class="muted">Configura la cuenta que administrará los informes.</p><label>Correo</label><input id="adminEmail" type="email" value="brandonlasteros31@gmail.com" readonly><label>Contraseña (mínimo 10 caracteres)</label><input id="adminPassword" type="password" autocomplete="new-password"><label>Repite la contraseña</label><input id="adminConfirm" type="password" autocomplete="new-password"><div class="actions"><button class="primary" data-action="setup">Crear acceso</button></div><p id="entryMessage">${shareEscape(message)}</p></div>`;
    return;
  }
  gate.innerHTML = `<div style="width:min(820px,100%)"><div class="card" style="margin:0 0 12px"><h1 style="font-size:22px;margin:0 0 5px">Centro de control</h1><p class="muted" style="margin:0">Inicia sesión para continuar.</p></div><div class="grid2"><div class="card" style="margin:0"><h2>Iniciar sesión</h2><label>Correo autorizado</label><input id="loginEmail" type="email" autocomplete="username"><label>Contraseña</label><input id="loginPassword" type="password" autocomplete="current-password"><div class="actions"><button class="primary" data-action="login">Entrar</button></div></div><div class="card" style="margin:0"><h2>Activar cuenta</h2><p class="muted">Primero pide una invitación a la persona administradora.</p><label>Nombre completo</label><input id="activateName" autocomplete="name"><label>Correo autorizado</label><input id="activateEmail" type="email" autocomplete="email"><label>Código de invitación</label><input id="inviteCode" autocomplete="one-time-code"><label>Crea una contraseña</label><input id="activatePassword" type="password" autocomplete="new-password"><label>Repite la contraseña</label><input id="activateConfirm" type="password" autocomplete="new-password"><div class="actions"><button data-action="activate">Activar cuenta</button></div></div></div><p id="entryMessage" style="text-align:center">${shareEscape(message)}</p></div>`;
}

function prepareControlInbox() {
  const control = document.getElementById('control');
  if (!control) return;
  if (!document.getElementById('sharedControlList')) {
    const inbox = document.createElement('div');
    inbox.id = 'sharedControlList';
    control.appendChild(inbox);
  }
  const oldInput = document.getElementById('reportResponsible');
  if (oldInput && oldInput.tagName !== 'SELECT') {
    if (oldInput.previousElementSibling?.tagName === 'LABEL') oldInput.previousElementSibling.textContent = 'Responsable del informe *';
    const select = document.createElement('select');
    select.id = 'reportResponsible';
    select.className = oldInput.className;
    select.required = true;
    oldInput.replaceWith(select);
    const hint = document.createElement('div');
    hint.className = 'mini';
    hint.textContent = 'El remitente queda identificado automáticamente con su correo.';
    select.after(hint);
  }
  const fileHelp = document.querySelector('#reportFile')?.parentElement.querySelector('.mini');
  if (fileHelp) fileHelp.textContent = 'Puedes adjuntar hasta 20 archivos (15 MB cada uno, 100 MB en total). Se guardan para descargarlos desde otras laptops.';
  const legacyReview = document.getElementById('loginPanel')?.closest('.card');
  if (legacyReview) {
    legacyReview.id = 'privateReviewCard';
    legacyReview.innerHTML = '<h2>Revisión privada</h2><p class="muted">Solo el administrador puede aprobar informes o autorizar correcciones.</p><div id="privateReviewList"></div>';
    legacyReview.classList.add('hidden');
  }
}

function populateResponsible(people, selectedEmail = '') {
  const select = document.getElementById('reportResponsible');
  if (!select) return;
  const active = people.filter(person => person.active && person.role === 'staff');
  select.innerHTML = '<option value="">Selecciona una persona registrada</option>' + active.map(person => `<option value="${shareEscape(person.email)}">${shareEscape(person.displayName)} · ${shareEscape(person.email)}</option>`).join('');
  if (selectedEmail && active.some(person => person.email === selectedEmail)) select.value = selectedEmail;
}

function sharedSubmissionCards(items, adminMode) {
  if (!items.length) return '<div class="item">Todavía no hay entregas compartidas.</div>';
  return items.map(item => `<div class="item"><div class="itemtop"><div><h3>${shareEscape(item.title)}</h3><div class="mini">Entregado por: ${shareEscape(item.submitterName || item.email)} · ${shareEscape(item.email)}</div><div class="mini">Responsable: ${shareEscape(item.responsibleName || item.responsibleEmail || item.email)}${item.number ? ' · N.º ' + shareEscape(item.number) : ''}${item.documentDate ? ' · ' + fmt(item.documentDate) : ''} · ${new Date(item.created).toLocaleString('es-PE')}</div></div><b>${shareEscape(item.status)}</b></div>${item.note ? `<p>${shareEscape(item.note)}</p>` : ''}<div class="actions">${item.files.map(file => `<button data-action="download" data-id="${shareEscape(file.id)}" data-name="${shareEscape(file.name)}">Descargar ${shareEscape(file.name)}</button>`).join('')}</div>${adminMode && item.status === 'Pendiente' ? `<div class="field"><label>Observaciones (obligatorias si devuelves)</label><textarea id="review-${shareEscape(item.id)}" placeholder="Qué debe corregirse"></textarea></div><div class="actions"><button class="good" data-action="review" data-id="${shareEscape(item.id)}" data-status="Aprobada">Aprobar</button><button class="warn" data-action="review" data-id="${shareEscape(item.id)}" data-status="Observada">Devolver con observaciones</button></div>` : item.review ? `<p><b>Observaciones:</b> ${shareEscape(item.review)}</p>` : ''}${adminMode && item.editRequestStatus === 'pending' ? `<div class="notice"><b>Solicita corregir este envío.</b><p>${shareEscape(item.editRequestNote || 'Sin motivo indicado')}</p><div class="actions"><button class="good" data-action="edit-decision" data-id="${shareEscape(item.id)}" data-status="authorized">Autorizar corrección</button><button data-action="edit-decision" data-id="${shareEscape(item.id)}" data-status="denied">Rechazar solicitud</button></div></div>` : ''}${!adminMode ? staffEditControls(item) : ''}</div>`).join('');
}

function staffEditControls(item) {
  if (item.editAuthorized) return `<div class="notice"><b>Corrección autorizada.</b><label>Asunto</label><input id="edit-title-${shareEscape(item.id)}" value="${shareEscape(item.title)}"><label>Comentario</label><textarea id="edit-note-${shareEscape(item.id)}">${shareEscape(item.note || '')}</textarea><label>Nuevo archivo (opcional, reemplaza el anterior)</label><input id="edit-file-${shareEscape(item.id)}" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt,.csv"><div class="mini">Hasta 20 archivos por envío, 15 MB cada uno y 100 MB en total.</div><div class="actions"><button class="primary" data-action="save-edit" data-id="${shareEscape(item.id)}">Guardar corrección y reenviar</button></div></div>`;
  if (item.editRequestStatus === 'pending') return '<p class="muted">Solicitud de corrección pendiente de autorización del administrador.</p>';
  return `${item.editRequestStatus === 'denied' ? '<p class="muted">La solicitud de corrección fue rechazada.</p>' : ''}<button data-action="request-edit" data-id="${shareEscape(item.id)}">Solicitar autorización para corregir</button>`;
}

function adminSubmissionGroups(items) {
  const reports = items.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity');
  const valuations = items.filter(item => item.kind === 'valuation');
  const conformities = items.filter(item => item.kind === 'conformity');
  const groups = [
    ['Pendientes de revisión', 'Pendiente'],
    ['Informes aprobados', 'Aprobada'],
    ['Entregas con observaciones', 'Observada']
  ];
  return `<div><h2>Entregas realizadas por el personal (${items.length})</h2><p class="muted">Cada entrega muestra el correo de quien la envió. Puedes descargar sus archivos y revisar los pendientes.</p>${groups.map(([title, status]) => {
    const matches = reports.filter(item => item.status === status);
    return `<section class="report-section"><h3>${title} (${matches.length})</h3>${matches.length ? sharedSubmissionCards(matches, true) : '<p class="muted">No hay entregas en esta sección.</p>'}</section>`;
  }).join('')}<section class="report-section"><h3>Valorizaciones del proyecto (${valuations.length})</h3>${valuations.length ? sharedSubmissionCards(valuations, true) : '<p class="muted">No hay valorizaciones cargadas.</p>'}</section><section class="report-section"><h3>Conformidades de equipos, bienes y servicios (${conformities.length})</h3>${conformities.length ? sharedSubmissionCards(conformities, true) : '<p class="muted">No hay conformidades cargadas.</p>'}</section></div>`;
}

function renderValuationsReport(items) {
  const valuations = items.filter(item => item.kind === 'valuation').sort((a, b) => String(a.valuationPeriod).localeCompare(String(b.valuationPeriod)));
  const root = document.getElementById('outValuations');
  const chart = document.getElementById('valuationCurve');
  if (!root || !chart) return;
  if (!valuations.length) {
    root.innerHTML = '<div class="empty">Todavía no hay valorizaciones registradas.</div>';
    chart.innerHTML = '<p class="muted">La curva S aparecerá al registrar valorizaciones.</p>';
    return;
  }
  root.innerHTML = valuations.map(item => {
    const overdue = item.status === 'Pendiente' && item.valuationDue && item.valuationDue < today();
    return `<div class="item"><div class="itemtop"><div><b>${shareEscape(item.valuationNumber || item.title)}</b><div class="mini">Período: ${fmt(item.valuationPeriod)} · Fecha límite: ${fmt(item.valuationDue)}${overdue ? ' · PLAZO VENCIDO' : ''}</div><div class="mini">Enviada por: ${shareEscape(item.submitterName || item.email)} · ${shareEscape(item.email)} · ${shareEscape(item.status)}</div></div></div><div class="statline"><span>Avance programado acumulado</span><b>${Number(item.plannedProgress).toFixed(2)}%</b></div><div class="statline"><span>Avance ejecutado acumulado</span><b>${Number(item.actualProgress).toFixed(2)}%</b></div>${item.review ? `<p><b>Observaciones:</b> ${shareEscape(item.review)}</p>` : ''}<div class="actions">${item.files.map(file => `<button data-action="download" data-id="${shareEscape(file.id)}" data-name="${shareEscape(file.name)}">Descargar ${shareEscape(file.name)}</button>`).join('')}</div></div>`;
  }).join('');
  const width = 720, height = 300, left = 54, right = 18, top = 20, bottom = 52;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = index => left + (valuations.length === 1 ? 0.5 : index / (valuations.length - 1)) * plotWidth;
  const y = value => top + (100 - Math.max(0, Math.min(100, Number(value) || 0))) / 100 * plotHeight;
  const makePath = key => valuations.map((item, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(item[key]).toFixed(1)}`).join(' ');
  const grid = [0, 25, 50, 75, 100].map(value => `<g><line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#d8dee7"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end" fill="#667389" font-size="11">${value}%</text></g>`).join('');
  const dots = key => valuations.map((item, index) => `<circle cx="${x(index)}" cy="${y(item[key])}" r="4" fill="${key === 'plannedProgress' ? '#2f7fe0' : '#1e9e6a'}"><title>${shareEscape(item.valuationNumber || item.title)}: ${Number(item[key]).toFixed(2)}%</title></circle>`).join('');
  const labels = valuations.map((item, index) => `<text x="${x(index)}" y="${height - 28}" text-anchor="middle" fill="#667389" font-size="10">${shareEscape(fmt(item.valuationPeriod))}</text>`).join('');
  chart.innerHTML = `<svg role="img" aria-label="Curva S: avance programado y ejecutado" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto"><text x="${left}" y="14" fill="#1b2638" font-size="12" font-weight="600">Avance acumulado (%)</text>${grid}<path d="${makePath('plannedProgress')}" fill="none" stroke="#2f7fe0" stroke-width="3"/>${dots('plannedProgress')}<path d="${makePath('actualProgress')}" fill="none" stroke="#1e9e6a" stroke-width="3"/>${dots('actualProgress')}${labels}<g transform="translate(${left},${height - 7})"><line x1="0" y1="0" x2="20" y2="0" stroke="#2f7fe0" stroke-width="3"/><text x="26" y="4" fill="#1b2638" font-size="11">Programado</text><line x1="126" y1="0" x2="146" y2="0" stroke="#1e9e6a" stroke-width="3"/><text x="152" y="4" fill="#1b2638" font-size="11">Ejecutado</text></g></svg>`;
}

function renderConformitiesReport(items) {
  const conformities = items.filter(item => item.kind === 'conformity').sort((a, b) => String(a.conformityDue).localeCompare(String(b.conformityDue)));
  const root = document.getElementById('outConformities');
  if (!root) return;
  if (!conformities.length) {
    root.innerHTML = '<div class="empty">Todavia no hay conformidades registradas.</div>';
    return;
  }
  const approved = conformities.filter(item => item.status === 'Aprobada').length;
  const observed = conformities.filter(item => item.status === 'Observada').length;
  const pending = conformities.filter(item => item.status === 'Pendiente').length;
  const reviewed = approved + observed;
  const overdue = conformities.filter(item => item.status === 'Pendiente' && item.conformityDue && item.conformityDue < today()).length;
  const progress = Math.round(reviewed / conformities.length * 100);
  const categories = ['Equipos', 'Bienes', 'Servicios'].map(category => category + ': ' + conformities.filter(item => item.conformityCategory === category).length);
  root.innerHTML = '<div class="grid">' +
    [['Conformidades', conformities.length], ['Aprobadas', approved], ['Observadas', observed], ['Pendientes', pending], ['Fuera de plazo', overdue], ['Revisadas', progress + '%']]
      .map(([label, value]) => '<div><div class="label">' + label + '</div><div class="metric">' + value + '</div></div>').join('') +
    '</div><div class="item"><b>Por tipo:</b> ' + categories.join(' · ') +
    '<div class="mini">Avance de revision: ' + reviewed + ' de ' + conformities.length + ' conformidad(es) revisadas (' + progress + '%).</div></div>' +
    conformityCards(conformities);
}

function conformityCards(conformities) {
  return conformities.map(item => {
    const overdue = item.status === 'Pendiente' && item.conformityDue && item.conformityDue < today();
    return '<div class="item"><div class="itemtop"><div><h3>' + shareEscape(item.conformityCategory) + ' · ' + shareEscape(item.title) + '</h3><div class="mini">Fecha: ' + fmt(item.conformityDate) + ' · Plazo: ' + fmt(item.conformityDue) + (overdue ? ' · PLAZO VENCIDO' : '') + '</div><div class="mini">Enviada por: ' + shareEscape(item.submitterName || item.email) + ' · ' + shareEscape(item.email) + ' · Responsable: ' + shareEscape(item.responsibleName || item.responsibleEmail || item.email) + '</div></div><b>' + shareEscape(item.status) + '</b></div>' + (item.note ? '<p>' + shareEscape(item.note) + '</p>' : '') + (item.review ? '<p><b>Observaciones:</b> ' + shareEscape(item.review) + '</p>' : '') + '<div class="actions">' + (item.files || []).map(file => '<button data-action="download" data-id="' + shareEscape(file.id) + '" data-name="' + shareEscape(file.name) + '">Descargar ' + shareEscape(file.name) + '</button>').join('') + '</div></div>';
  }).join('');
}

function renderControlConformities(items = sharedReportItems) {
  const root = document.getElementById('controlConformities');
  if (!root) return;
  const conformities = items.filter(item => item.kind === 'conformity').sort((a, b) => String(b.created).localeCompare(String(a.created)));
  root.innerHTML = '<h3 style="margin:16px 0 6px">Conformidades enviadas (' + conformities.length + ')</h3>' +
    (conformities.length ? conformityCards(conformities) : '<div class="empty">Todavia no se han enviado conformidades.</div>');
}

function renderSharedReportSummary() {
  const items = sharedReportItems.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity');
  const valuations = sharedReportItems.filter(item => item.kind === 'valuation');
  const metrics = [
    ['Entregas recibidas', sharedReportItems.length],
    ['Aprobadas', sharedReportItems.filter(item => item.status === 'Aprobada').length],
    ['Con observaciones', sharedReportItems.filter(item => item.status === 'Observada').length],
    ['Pendientes de revisión', sharedReportItems.filter(item => item.status === 'Pendiente').length]
  ];
  const metricRoot = document.getElementById('reportMetrics');
  if (metricRoot) metricRoot.innerHTML = metrics.map(([label, value]) => `<div class="card"><div class="metric">${value}</div><div class="label">${label}</div></div>`).join('');
  const reportRoot = document.getElementById('outReports');
  if (reportRoot) reportRoot.innerHTML = items.length ? items.map(item => `<div class="item"><div class="itemtop"><div><b>${shareEscape(item.number ? `N.º ${item.number} · ` : '')}${shareEscape(item.title)}</b><div class="mini">Enviado por: ${shareEscape(item.submitterName || item.email)} · ${shareEscape(item.email)}</div><div class="mini">Responsable: ${shareEscape(item.responsibleName || item.responsibleEmail || item.email)}${item.documentDate ? ' · ' + fmt(item.documentDate) : ''}</div>${item.files.map(file => `<div class="mini">Archivo: ${shareEscape(file.name)}</div>`).join('')}</div><b>${shareEscape(item.status)}</b></div>${item.note ? `<p>${shareEscape(item.note)}</p>` : ''}${item.review ? `<p><b>Observaciones:</b> ${shareEscape(item.review)}</p>` : ''}</div>`).join('') : '<div class="empty">No hay informes recibidos para este proyecto.</div>';
  const statusRoot = document.getElementById('outStatus');
  if (statusRoot) statusRoot.innerHTML = `<div class="grid">${metrics.map(([label, value]) => `<div><div class="label">${label}</div><div class="metric">${value}</div></div>`).join('')}</div>`;
  const openActivities = (activities || []).filter(activity => inWeek(activity.due) && !activity.done).length;
  const conclusion = document.getElementById('outConclusion');
  const overdueValuations = valuations.filter(item => item.status === 'Pendiente' && item.valuationDue && item.valuationDue < today()).length;
  const conformities = sharedReportItems.filter(item => item.kind === 'conformity');
  const overdueConformities = conformities.filter(item => item.status === 'Pendiente' && item.conformityDue && item.conformityDue < today()).length;
    const approvedConformities = conformities.filter(item => item.status === 'Aprobada').length;
  const observedConformities = conformities.filter(item => item.status === 'Observada').length;
  const pendingConformities = conformities.filter(item => item.status === 'Pendiente').length;
  const reviewedConformities = approvedConformities + observedConformities;
  const conformityProgress = conformities.length ? Math.round(reviewedConformities / conformities.length * 100) : 0;
  if (conclusion) conclusion.textContent = 'En el periodo hay ' + items.length + ' informe(s), ' + valuations.length + ' valorizacion(es) y ' + conformities.length + ' conformidad(es): ' + approvedConformities + ' aprobada(s), ' + observedConformities + ' observada(s) y ' + pendingConformities + ' pendiente(s), con ' + conformityProgress + '% de avance de revision. Se registran ' + overdueValuations + ' valorizacion(es) y ' + overdueConformities + ' conformidad(es) con plazo vencido, ademas de ' + openActivities + ' actividad(es) sin concluir.';
  renderValuationsReport(sharedReportItems);
  renderConformitiesReport(sharedReportItems);
  renderControlConformities(sharedReportItems);
}

async function refreshSharedReportView() {
  try {
    sharedReportItems = await shareApi('/api/submissions');
  } catch (error) {
    shareMessage(error.message, true);
  }
  renderReportDocument();
  renderSharedReportSummary();
}

async function shareApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = sessionStorage.getItem(SHARE_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = 'No se pudo completar la acción.';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.headers.get('content-type')?.includes('application/json')
    ? response.json()
    : response.blob();
}

function toast(text) {
  let box = document.getElementById('appToast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'appToast';
    box.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:1200;background:#12284b;color:#fff;padding:9px 14px;border-radius:7px;box-shadow:0 3px 14px #0003;max-width:90vw';
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.hidden = false;
  clearTimeout(box.hideTimer);
  box.hideTimer = setTimeout(() => { box.hidden = true; }, 2600);
}

function renderAuditLog(entries) {
  const root = document.getElementById('auditList');
  if (!root) return;
  root.innerHTML = entries?.length ? entries.slice(0, 100).map(entry => '<div class="statline"><span><b>' + shareEscape(entry.action) + '</b><br><span class="mini">' + shareEscape(entry.detail || '') + '</span></span><span style="text-align:right">' + shareEscape(entry.actor) + '<br><span class="mini">' + new Date(entry.at).toLocaleString('es-PE') + '</span></span></div>').join('') : '<div class="empty">Todavia no hay cambios registrados.</div>';
}

function renderLiveSnapshot(snapshot) {
  const saved = snapshot.project || {};
  project = { name: saved.name || '', entity: saved.entity || '', location: saved.location || '', code: saved.code || '', cutoff: saved.cutoff || today(), desc: saved.description || '' };
  const projectFields = { projectName: project.name, entity: project.entity, projectCode: project.code, cutoff: project.cutoff, projectDesc: project.desc };
  Object.entries(projectFields).forEach(([id, value]) => { const input = document.getElementById(id); if (input && document.activeElement !== input) input.value = value; });
  if (ubigeoCatalog && saved.departmentCode) {
    const department = document.getElementById('projectDepartment');
    if (department && document.activeElement !== department) { department.value = saved.departmentCode; populateProjectProvinces(saved.provinceCode); populateProjectDistricts(saved.districtCode); }
  }
  const workspace = snapshot.workspace || {};
  liveWorkspace = workspace;
  workers = Array.isArray(workspace.workers) ? workspace.workers : [];
  activities = Array.isArray(workspace.activities) ? workspace.activities : [];
  comments = Array.isArray(workspace.comments) ? workspace.comments : [];
  const sourceStore = workspace.sources || {};
  sources = sourceStore.byWeek?.[weekKey(currentDate)] || sourceStore || { reports: '', activities: '', comments: '', other: '' };
  const sourceFields = { srcReports: sources.reports, srcActivities: sources.activities, srcComments: sources.comments, srcOther: sources.other };
  Object.entries(sourceFields).forEach(([id, value]) => { const input = document.getElementById(id); if (input && document.activeElement !== input) input.value = value || ''; });
  sharedReportItems = snapshot.submissions || [];
  liveAuditLog = snapshot.auditLog || [];
  reports = sharedReportItems.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity').map(item => ({ id: item.id, title: item.title, number: item.number, date: item.documentDate, responsible: item.responsibleName || item.responsibleEmail, file: (item.files || []).map(file => file.name).join(', '), note: item.note, status: item.status === 'Aprobada' ? 'Aprobado' : item.status === 'Observada' ? 'Con observaciones' : 'Pendiente de revision', reviewNote: item.review, reviewDate: item.reviewed }));
  renderWorkers();
  renderAll();
  renderSharedReportSummary();
  renderControlConformities(sharedReportItems);
  renderAuditLog(liveAuditLog);
  const status = document.getElementById('liveStatus');
  if (status) status.textContent = 'Sincronizado | ' + new Date().toLocaleTimeString('es-PE');
}

async function refreshLiveState(force = false) {
  if (liveSyncBusy || !sessionStorage.getItem(SHARE_TOKEN)) return;
  liveSyncBusy = true;
  try {
    const snapshot = await shareApi('/api/live');
    if (force || Number(snapshot.revision) !== liveRevision) {
      liveRevision = Number(snapshot.revision) || 0;
      renderLiveSnapshot(snapshot);
      const control = document.getElementById('control');
      const focusedInput = control?.contains(document.activeElement) && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
      if (control && !control.classList.contains('hidden') && !focusedInput) await renderControlInbox(currentUser);
    } else {
      const status = document.getElementById('liveStatus');
      if (status) status.textContent = 'Sincronizado | ' + new Date().toLocaleTimeString('es-PE');
    }
  } catch {
    const status = document.getElementById('liveStatus');
    if (status) status.textContent = 'Sin conexion · reintentando';
  } finally { liveSyncBusy = false; }
}

function startLiveSync() {
  if (!document.getElementById('liveStatus')) {
    const status = document.createElement('small');
    status.id = 'liveStatus';
    status.className = 'tagline';
    status.textContent = 'Sincronizando...';
    document.querySelector('header')?.appendChild(status);
  }
  if (!liveSyncTimer) liveSyncTimer = setInterval(() => refreshLiveState(), 2000);
}

async function workspaceMutation(section, action, item = null, id = null, sourceWeek = '') {
  const result = await shareApi('/api/workspace', { method: 'POST', body: JSON.stringify({ section, action, item, id, weekKey: sourceWeek }) });
  liveRevision = Number(result.revision) - 1;
  await refreshLiveState(true);
  return result;
}

function bindAutosave() {
  ['srcReports','srcActivities','srcComments','srcOther'].forEach(id => document.getElementById(id)?.addEventListener('input', () => {
    clearTimeout(sourceSaveTimer);
    const editingWeek = weekKey(currentDate);
    const value = { reports: $('srcReports').value, activities: $('srcActivities').value, comments: $('srcComments').value, other: $('srcOther').value };
    sourceSaveTimer = setTimeout(() => workspaceMutation('sources','set',value,null,editingWeek).catch(error => shareMessage(error.message, true)), 750);
  }));
  ['projectName','entity','projectCode','cutoff','projectDesc','projectDepartment','projectProvince','projectDistrict'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
    clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(() => saveSharedProject(true), 350);
  }));
  ['prevWeek','nextWeek'].forEach(id => document.getElementById(id)?.addEventListener('click', () => { setTimeout(() => refreshLiveState(true), 0); }));
  document.getElementById('jumpDate')?.addEventListener('change', () => { setTimeout(() => refreshLiveState(true), 0); });
  document.getElementById('resetDemo')?.remove();
  bindWorkerDraftAutosave();
}

function collectWorkerDraft() {
  const fields = {
    report: ['reportTitle','reportNumber','reportDate','reportResponsible','reportNote'],
    valuation: ['valuationNumber','valuationPeriod','valuationDue','valuationPlanned','valuationActual','valuationNote','reportResponsible'],
    conformity: ['conformityCategory','conformityTitle','conformityDate','conformityDue','conformityNote','reportResponsible']
  };
  return Object.fromEntries(Object.entries(fields).map(([form, ids]) => [form, Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.value || '']))]));
}

function applyWorkerDraft() {
  if (!currentUser || currentUser.role !== 'staff' || !workerDraft) return;
  workerDraftLoading = true;
  for (const form of ['report','valuation','conformity']) {
    for (const [id, value] of Object.entries(workerDraft[form] || {})) {
      const field = document.getElementById(id);
      if (field && field.type !== 'file') field.value = value ?? '';
    }
  }
  workerDraftLoading = false;
}

function bindWorkerDraftAutosave() {
  const ids = ['reportTitle','reportNumber','reportDate','reportResponsible','reportNote','valuationNumber','valuationPeriod','valuationDue','valuationPlanned','valuationActual','valuationNote','conformityCategory','conformityTitle','conformityDate','conformityDue','conformityNote'];
  for (const id of ids) {
    const field = document.getElementById(id);
    if (!field || field.dataset.draftBound) continue;
    field.dataset.draftBound = 'true';
    for (const eventName of ['input','change']) field.addEventListener(eventName, () => {
      if (workerDraftLoading || currentUser?.role !== 'staff') return;
      clearTimeout(workerDraftTimer);
      workerDraftTimer = setTimeout(saveWorkerDraft, 650);
    });
  }
}

async function saveWorkerDraft() {
  if (currentUser?.role !== 'staff') return;
  workerDraft = collectWorkerDraft();
  try {
    await shareApi('/api/draft', { method: 'POST', body: JSON.stringify({ draft: workerDraft }) });
    const status = document.getElementById('liveStatus');
    if (status) status.textContent = 'Borrador guardado · ' + new Date().toLocaleTimeString('es-PE');
  } catch (error) { shareMessage(error.message, true); }
}

function renderAccess(setup) {
  if (setup) {
    shareRoot.innerHTML = `<div class="card"><h3>Preparar acceso de administración</h3><p class="mu">Crea tu contraseña de administración. Debe tener al menos 10 caracteres.</p><label>Correo administrador</label><input id="adminEmail" type="email" value="brandonlasteros31@gmail.com" readonly><label>Contraseña</label><input id="adminPassword" type="password" autocomplete="new-password"><label>Repite la contraseña</label><input id="adminConfirm" type="password" autocomplete="new-password"><div class="rw"><button class="pr" data-action="setup">Crear acceso de administración</button></div><p id="shareMessage"></p></div>`;
    return;
  }
  shareRoot.innerHTML = `<div class="g2"><div class="card"><h3>Entrar</h3><label>Correo autorizado</label><input id="loginEmail" type="email" autocomplete="username"><label>Contraseña</label><input id="loginPassword" type="password" autocomplete="current-password"><div class="rw"><button class="pr" data-action="login">Entrar</button></div></div><div class="card"><h3>Activar acceso</h3><p class="mu">Pide a la persona administradora tu código de invitación.</p><label>Nombre completo</label><input id="activateName" autocomplete="name"><label>Correo autorizado</label><input id="activateEmail" type="email" autocomplete="email"><label>Código de invitación</label><input id="inviteCode" autocomplete="one-time-code"><label>Crea una contraseña</label><input id="activatePassword" type="password" autocomplete="new-password"><label>Repite la contraseña</label><input id="activateConfirm" type="password" autocomplete="new-password"><div class="rw"><button data-action="activate">Activar acceso</button></div></div></div><div class="card"><p id="shareMessage" class="mu">Solo las personas invitadas pueden crear una cuenta.</p></div>`;
}

async function renderShare() {
  shareRoot.innerHTML = '<div class="card">Cargando entregas...</div>';
  try {
    const status = await shareApi('/api/status');
    let me = null;
    try { me = await shareApi('/api/me'); } catch {}
    if (!me) {
      renderAccess(status.setup);
      await renderControlInbox(null);
      return;
    }
    if (me.role === 'admin') await renderAdmin(me);
    else await renderStaff(me);
    await renderControlInbox(me);
  } catch {
    shareRoot.innerHTML = '<div class="card"><b>No se pudo abrir la sección de entregas.</b><p class="mu">Abre la aplicación con el botón “Iniciar centro de control”.</p></div>';
  }
}

async function renderAdmin(me) {
  const [items, people] = await Promise.all([
    shareApi('/api/submissions'),
    shareApi('/api/people')
  ]);
  shareRoot.innerHTML = `<div class="card"><div class="rw"><div><h3>Administración</h3><div class="mu">Sesión: ${shareEscape(me.email)}</div></div><div class="sp"></div><button data-action="logout">Salir</button></div></div><div class="g2"><div class="card"><h3>Autorizar personal</h3><p class="mu">Escribe el correo y entrega a esa persona el código que aparecerá aquí.</p><label>Correo</label><input id="newPersonEmail" type="email" placeholder="persona@correo.com"><div class="rw"><button class="pr" data-action="invite">Crear invitación</button></div><p id="shareMessage"></p><div id="peopleList"></div></div><div class="card"><h3>Entregas recibidas: ${items.length}</h3><div class="mu">Descarga los archivos y aprueba o devuelve cada entrega.</div></div></div><div id="submissionList"></div>`;
  populateResponsible(people, '');
  document.getElementById('peopleList').innerHTML = people.map(person => `<div class="item"><b>${shareEscape(person.displayName || person.email)}</b><div class="mini">${shareEscape(person.email)}</div><div class="rw"><span class="mu">${roleLabel(person.role)}</span>${!person.active ? `<button data-action="invite-existing" data-email="${shareEscape(person.email)}">Crear código</button>` : ''}</div></div>`).join('');
  document.getElementById('submissionList').innerHTML = adminSubmissionGroups(items);
}

async function renderStaff(me) {
  const [items, people] = await Promise.all([shareApi('/api/submissions'), shareApi('/api/people')]);
    shareRoot.innerHTML = `<div class="card"><div class="rw"><div><h3>Cuenta del personal</h3><div class="mu">Correo: ${shareEscape(me.email)}</div></div><div class="sp"></div><button data-action="logout">Salir</button></div><label>Nombre completo</label><input id="profileName" value="${shareEscape(me.displayName || '')}" autocomplete="name"><div class="rw"><button data-action="save-name">Guardar mi nombre</button></div></div><div class="card"><p class="mu">Tus documentos se cargan desde Control. Si necesitas corregir una entrega, solicita autorización al administrador.</p><h3>Mis entregas</h3>${sharedSubmissionCards(items, false)}</div>`;
  populateResponsible(people, me.email);
  applyWorkerDraft();
}

async function renderControlInbox(me = null) {
  const inbox = document.getElementById('sharedControlList');
  if (!inbox) return;
  const privateCard = document.getElementById('privateReviewCard');
  if (!me) {
    try { me = await shareApi('/api/me'); } catch { me = null; }
  }
  if (privateCard) privateCard.classList.toggle('hidden', !me || me.role !== 'admin');
  if (!me) {
    if (privateCard) privateCard.classList.add('hidden');
    inbox.innerHTML = '<div class="card"><h2>Informes compartidos</h2><p class="mu">Para que el archivo llegue a la otra laptop, inicia sesión en 4 · Entregas antes de registrar el informe.</p></div>';
    populateResponsible([], '');
    return;
  }
  try {
    const items = await shareApi('/api/submissions');
    sharedReportItems = items;
    renderControlConformities(items);
    if (me.role === 'admin') {
      inbox.innerHTML = adminSubmissionGroups(items);
      const privateList = document.getElementById('privateReviewList');
      if (privateList) privateList.innerHTML = adminSubmissionGroups(items);
    } else {
      inbox.innerHTML = `<div class="card"><h2>Mis informes enviados</h2>${sharedSubmissionCards(items, false)}</div>`;
      const people = await shareApi('/api/people');
      populateResponsible(people, me.email);
      applyWorkerDraft();
    }
    if (me.role === 'admin') {
      $('mTotal').textContent = items.length;
      $('mApproved').textContent = items.filter(item => item.status === 'Aprobada').length;
      $('mObserved').textContent = items.filter(item => item.status === 'Observada').length;
      $('mPending').textContent = items.filter(item => item.status === 'Pendiente').length;
    }
  } catch (error) {
    inbox.innerHTML = `<div class="card">${shareEscape(error.message)}</div>`;
  }
}

async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }
  return btoa(binary);
}

async function filesPayload(input) {
  const files = Array.from(input.files || []);
  if (!files.length) throw new Error('Selecciona al menos un archivo para adjuntar.');
  if (files.length > 20) throw new Error('Puedes adjuntar hasta 20 archivos por envío.');
  if (files.some(file => file.size > 15000000)) throw new Error('Cada archivo debe pesar menos de 15 MB.');
  if (files.reduce((sum, file) => sum + file.size, 0) > 100000000) throw new Error('El total de archivos no puede superar 100 MB por envío.');
  const result = [];
  for (const file of files) result.push({ name: file.name, data: await fileBase64(file) });
  return result;
}

async function submitSharedReport(event) {
  event.preventDefault();
  try {
    let me;
    try { me = await shareApi('/api/me'); } catch { me = null; }
    if (!me) {
      toast('Primero inicia sesión en 4 · Entregas.');
      document.querySelector('.tabs button[data-tab="entregas"], .tabs button[data-t="4"]')?.click();
      return;
    }
    const files = await filesPayload(document.getElementById('reportFile'));
    const responsibleEmail = document.getElementById('reportResponsible').value;
    if (!responsibleEmail) throw new Error('Selecciona un responsable registrado.');
    await shareApi('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('reportTitle').value,
        number: document.getElementById('reportNumber').value,
        documentDate: document.getElementById('reportDate').value,
        responsibleEmail,
        note: document.getElementById('reportNote').value,
        files
      })
    });
    document.getElementById('reportFile').value = '';
    const people = await shareApi('/api/people');
    populateResponsible(people, me.email);
    await renderControlInbox(me);
    toast('Informe y archivo enviados al servidor.');
  } catch (error) {
    toast(error.message);
  }
}

async function submitSharedValuation(event) {
  event.preventDefault();
  try {
    const me = await shareApi('/api/me');
    const files = await filesPayload(document.getElementById('valuationFile'));
    const responsibleEmail = document.getElementById('reportResponsible').value || me.email;
    await shareApi('/api/submissions', { method: 'POST', body: JSON.stringify({
      kind: 'valuation',
      title: document.getElementById('valuationNumber').value,
      valuationNumber: document.getElementById('valuationNumber').value,
      valuationPeriod: document.getElementById('valuationPeriod').value,
      valuationDue: document.getElementById('valuationDue').value,
      plannedProgress: document.getElementById('valuationPlanned').value,
      actualProgress: document.getElementById('valuationActual').value,
      documentDate: document.getElementById('valuationPeriod').value,
      responsibleEmail,
      note: document.getElementById('valuationNote').value,
      files
    }) });
    document.getElementById('valuationFile').value = '';
    await renderControlInbox();
    await refreshSharedReportView();
    toast('Valorización enviada para revisión.');
  } catch (error) {
    toast(error.message);
  }
}

async function submitSharedConformity(event) {
  event.preventDefault();
  try {
    const me = await shareApi('/api/me');
    const files = await filesPayload(document.getElementById('conformityFile'));
    const category = document.getElementById('conformityCategory').value;
    const description = document.getElementById('conformityTitle').value.trim();
    await shareApi('/api/submissions', { method: 'POST', body: JSON.stringify({
      kind: 'conformity',
      category,
      title: `${category} · ${description}`,
      conformityDate: document.getElementById('conformityDate').value,
      conformityDue: document.getElementById('conformityDue').value,
      responsibleEmail: document.getElementById('reportResponsible').value || me.email,
      note: document.getElementById('conformityNote').value,
      files
    }) });
    document.getElementById('conformityFile').value = '';
    await renderControlInbox();
    await refreshSharedReportView();
    toast('Conformidad enviada para revisión.');
  } catch (error) {
    toast(error.message);
  }
}

prepareControlInbox();
prepareProjectForm();
const sharedReportForm = document.getElementById('reportForm');
if (sharedReportForm) sharedReportForm.onsubmit = submitSharedReport;
const valuationForm = document.getElementById('valuationForm');
if (valuationForm) valuationForm.onsubmit = submitSharedValuation;
const conformityForm = document.getElementById('conformityForm');
if (conformityForm) conformityForm.onsubmit = submitSharedConformity;
document.getElementById('refreshReport').onclick = refreshSharedReportView;
document.getElementById('printReport').onclick = async () => { await refreshSharedReportView(); window.print(); };
document.getElementById('copyReport').onclick = async () => {
  await refreshSharedReportView();
  const text = $('reportProjectTitle').textContent+'\n'+$('reportMeta').textContent+'\n\n1. INFORMACION GENERAL\n'+$('outProject').innerText+'\n\n2. RESPONSABLES\n'+$('outWorkers').innerText+'\n\n3. INFORMES Y ESTADO\n'+$('outReports').innerText+'\n\n4. VALORIZACIONES\n'+$('outValuations').innerText+'\n\n5. CONFORMIDADES\n'+$('outConformities').innerText+'\n\n6. ACTIVIDADES\n'+$('outActivities').innerText+'\n\n7. FUENTES Y COMENTARIOS\n'+$('outSources').innerText+'\n\n8. CONCLUSION\n'+$('outConclusion').innerText+'\n\n9. HISTORIAL DE CAMBIOS\n'+$('auditList').innerText;
  navigator.clipboard?.writeText(text).then(() => alert('Informe copiado.')).catch(() => alert(text));
};

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'setup') {
      await shareApi('/api/setup', { method: 'POST', body: JSON.stringify({ email: document.getElementById('adminEmail').value, password: document.getElementById('adminPassword').value, confirm: document.getElementById('adminConfirm').value }) });
      await renderEntryGate('Cuenta creada. Entra con la contraseña que acabas de elegir.');
      const emailInput = document.getElementById('loginEmail');
      if (emailInput) emailInput.value = 'brandonlasteros31@gmail.com';
    } else if (action === 'login') {
      const result = await shareApi('/api/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value }) });
      sessionStorage.setItem(SHARE_TOKEN, result.token);
      closeEntryGate();
      await loadSharedProject();
      await renderShare();
      await renderControlInbox();
    } else if (action === 'activate') {
      const email = document.getElementById('activateEmail').value;
      await shareApi('/api/activate', { method: 'POST', body: JSON.stringify({ name: document.getElementById('activateName').value, email: document.getElementById('activateEmail').value, code: document.getElementById('inviteCode').value, password: document.getElementById('activatePassword').value, confirm: document.getElementById('activateConfirm').value }) });
      await renderEntryGate('Cuenta activada. Ahora inicia sesión con tu correo y contraseña.');
      document.getElementById('loginEmail').value = email;
    } else if (action === 'save-name') {
      await shareApi('/api/profile', { method: 'POST', body: JSON.stringify({ name: document.getElementById('profileName').value }) });
      await renderShare();
      shareMessage('Nombre guardado. Ya aparece en el selector de responsables.');
    } else if (action === 'logout') {
      await shareApi('/api/logout', { method: 'POST' });
      sessionStorage.removeItem(SHARE_TOKEN);
      if (liveSyncTimer) clearInterval(liveSyncTimer);
      liveSyncTimer = null;
      currentUser = null;
      workerDraftLoadedFor = '';
      await renderEntryGate();
    } else if (action === 'invite' || action === 'invite-existing') {
      const email = action === 'invite' ? document.getElementById('newPersonEmail').value : button.dataset.email;
      const result = await shareApi('/api/invite', { method: 'POST', body: JSON.stringify({ email }) });
      await renderAdmin({ email: 'brandonlasteros31@gmail.com' });
      shareMessage(`Envía este código a ${result.email}: ${result.code}`);
    } else if (action === 'submit') {
      const files = [...document.getElementById('submissionFiles').files];
      if (!files.length) throw new Error('Selecciona al menos un archivo.');
      if (files.length > 20) throw new Error('Puedes enviar hasta 20 archivos.');
      if (files.reduce((sum, file) => sum + file.size, 0) > 100000000) throw new Error('El total de archivos no puede superar 100 MB por envío.');
      const payload = [];
      for (const file of files) {
        if (file.size > 15000000) throw new Error('Cada archivo debe pesar menos de 15 MB.');
        payload.push({ name: file.name, data: await fileBase64(file) });
      }
      await shareApi('/api/submissions', { method: 'POST', body: JSON.stringify({ title: document.getElementById('submissionTitle').value, note: document.getElementById('submissionNote').value, files: payload }) });
      await renderShare();
      shareMessage('Documentos enviados.');
    } else if (action === 'review') {
      const review = document.getElementById(`review-${button.dataset.id}`).value;
      await shareApi(`/api/submissions/${button.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ status: button.dataset.status, review }) });
      await renderShare();
      await renderControlInbox();
      shareMessage(button.dataset.status === 'Aprobada' ? 'Entrega aprobada.' : 'Entrega devuelta con observaciones.');
    } else if (action === 'request-edit') {
      const reason = prompt('Explica qué necesitas corregir:');
      if (!reason) return;
      await shareApi(`/api/submissions/${button.dataset.id}/edit-request`, { method: 'POST', body: JSON.stringify({ reason }) });
      await renderShare();
      await renderControlInbox();
      toast('Solicitud enviada al administrador.');
    } else if (action === 'edit-decision') {
      await shareApi(`/api/submissions/${button.dataset.id}/edit-decision`, { method: 'POST', body: JSON.stringify({ status: button.dataset.status }) });
      await renderShare();
      await renderControlInbox();
      toast(button.dataset.status === 'authorized' ? 'Corrección autorizada.' : 'Solicitud rechazada.');
    } else if (action === 'save-edit') {
      const input = document.getElementById(`edit-file-${button.dataset.id}`);
      const files = input.files.length ? await filesPayload(input) : [];
      await shareApi(`/api/submissions/${button.dataset.id}/edit`, { method: 'POST', body: JSON.stringify({ title: document.getElementById(`edit-title-${button.dataset.id}`).value, note: document.getElementById(`edit-note-${button.dataset.id}`).value, files }) });
      await renderShare();
      await renderControlInbox();
      toast('Corrección enviada de nuevo para revisión.');
    } else if (action === 'download') {
      const blob = await shareApi(`/api/files/${button.dataset.id}`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = button.dataset.name;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  } catch (error) {
    shareMessage(error.message, true);
  }
});

document.addEventListener('click', event => {
  const tabButton = event.target.closest('.tabs button');
  if (!tabButton) return;
  const isShareTab = tabButton.dataset.t === '4' || tabButton.dataset.tab === 'entregas';
  if (isShareTab) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (tabButton.dataset.t === '4') {
      T = 4;
      document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('on', button === tabButton));
      [1, 2, 3, 4].forEach(index => document.getElementById(`p${index}`).classList.toggle('on', index === 4));
    } else {
      document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('active', button === tabButton));
      document.querySelectorAll('.tabpage').forEach(page => page.classList.toggle('hidden', page.id !== 'entregas'));
    }
    renderShare();
  } else {
    document.getElementById('p4')?.classList.remove('on');
    document.getElementById('entregas')?.classList.add('hidden');
    if (tabButton.dataset.tab === 'fuentes') loadSharedProject();
    if (tabButton.dataset.tab === 'informe') refreshSharedReportView();
    if (tabButton.dataset.tab === 'control' || tabButton.dataset.t === '2') renderControlInbox();
  }
}, true);

renderEntryGate();
