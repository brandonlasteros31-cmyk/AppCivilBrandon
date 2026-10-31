const SHARE_TOKEN = 'cc_share_token';
const shareRoot = document.getElementById('shareRoot');
let sharedReportItems = [];
let technicalSummaryItems = [];
let liveAuditLog = [];
let liveWorkspace = {};
let liveRevision = -1;
let liveSyncTimer = null;
let liveSyncBusy = false;
let currentUser = null;
let profileAvatarDraft = null;
let sourceSaveTimer = null;
let projectSaveTimer = null;
let workerDraft = { report: {}, valuation: {}, conformity: {} };
let workerDraftTimer = null;
let workerDraftLoading = false;
let workerDraftLoadedFor = '';
const TECHNICAL_PROJECT_FIELDS = ['techReportRole','techExecutiveUnit','techPliego','techWorkStatus','techWorkTermDays','techExecutionSystem','techWorkEnd','techResidentName','techResidentDni','techResidentCip','techResidentDesignation','techResidentAmount','techResidentResolutionDate','techResidentServiceStart','techResidentServiceEnd','techSupervisorName','techSupervisorDni','techSupervisorCip','techSupervisorDesignation','techSupervisorAmount','techSupervisorResolutionDate','techSupervisorServiceStart','techSupervisorServiceEnd','techOffice','techFunctionalSequence','techFiscalYear','techFundingSource','techApprovedBudget','techAnalyticalBudget','techExecutedBudget','techCompletedGoals','techExpedientApproval','techLandDelivery','techWorkStart','techViability','techInfobras','techContractNumber','techContractObject','techContractor','techContractAmount','techDeliverySystem','techContractTerm','techContractStart','techContractEnd','techContractDate','techContractProcedure','techContractExpedient','techContractNotebookLink','techContractGuarantees','techContractPenaltyStatus','techContractDisputes','techContractReception','techContractLiquidation','techContractFinalDocuments','techDirectApprovalReports','techDirectKeyStaff','techDirectExpedientReview','techDirectSupplyPlan','techDirectPeriodProgress','techDirectQualitySafety','techDirectChanges','techDirectCloseout','techContractSupervisor','techContractSchedule','techContractValuations','techContractChanges','techContractCloseout'];
const REPORT_DETAIL_FIELDS = ['reportPeriodStart','reportPeriodEnd','reportPeriodSummary','reportOccurrences','reportNotebookLink','reportQuality','reportQualityLink','reportSafetyEnvironment','reportSafetyLink','reportConclusions','reportRecommendations'];
const VALUATION_DETAIL_FIELDS = ['valuationMonthlyPlanned','valuationMonthlyActual','valuationAmount','valuationCumulativeAmount','valuationFinancialProgress','valuationMeasurements','valuationPaymentStatus'];

function shareEscape(value) {
  return esc(String(value ?? ''));
}

function addAdminFileRemovalButtons() {
  if (currentUser?.role !== 'admin') return;
  document.querySelectorAll('.submission-file-row').forEach(row => {
    if (row.querySelector('[data-action="delete-file"]')) return;
    const download = row.querySelector('button[data-action="download"]');
    const details = row.closest('.submission-details');
    const item = sharedReportItems.find(submission => details?.id.includes(submission.id));
    if (!download || !item) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'warn';
    button.dataset.action = 'delete-file';
    button.dataset.submissionId = item.id;
    button.dataset.id = download.dataset.id;
    button.dataset.name = download.dataset.name;
    button.textContent = 'Eliminar';
    row.appendChild(button);
  });
}

function renderPendingFileList(input) {
  const root = document.getElementById(`selected-files-${input.id}`);
  if (!root) return;
  const files = Array.from(input.files || []);
  root.innerHTML = files.map((file, index) => `<div class="valuation-file-row"><span>${shareEscape(file.name)} · ${(file.size / 1024 / 1024).toFixed(2)} MB</span><button type="button" data-action="remove-pending-file" data-input="${shareEscape(input.id)}" data-index="${index}">Quitar archivo</button></div>`).join('');
}

function bindPendingFileRemoval() {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
    .filter(input => !['valuationFile','profileAvatar'].includes(input.id));
  for (const input of inputs) {
    let root = document.getElementById(`selected-files-${input.id}`);
    if (!root) {
      root = document.createElement('div');
      root.id = `selected-files-${input.id}`;
      root.className = 'mini';
      input.insertAdjacentElement('afterend', root);
    }
    if (!input.dataset.pendingFileRemovalBound) {
      input.addEventListener('change', () => renderPendingFileList(input));
      input.dataset.pendingFileRemovalBound = 'true';
    }
    renderPendingFileList(input);
  }
}

function updateSectionClearButtons() {
  const allowed = currentUser?.role === 'admin';
  document.querySelectorAll('.section-clear-button').forEach(button => button.classList.toggle('hidden', !allowed));
}

function addWorkerRemovalButtons() {
  if (currentUser?.role !== 'admin') return;
  const people = (window.projectTeamAccounts || []).filter(person => person.role !== 'admin' && person.email !== currentUser.email);
  const cards = Array.from(document.querySelectorAll('#workerList .worker-card, #peopleList .item'));
  for (const person of people) {
    for (const card of cards.filter(item => item.textContent.toLowerCase().includes(String(person.email).toLowerCase()))) {
      if (Array.from(card.querySelectorAll('[data-action="remove-person"]')).some(button => button.dataset.email === person.email)) continue;
      let actions = card.querySelector('.itemtop .actions, .rw');
      if (!actions) {
        const top = card.querySelector('.itemtop');
        if (!top) continue;
        actions = document.createElement('div');
        actions.className = 'actions';
        top.appendChild(actions);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'warn';
      button.dataset.action = 'remove-person';
      button.dataset.email = person.email;
      button.dataset.name = person.displayName || person.email;
      button.textContent = 'Retirar del proyecto';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        removeProjectPerson(button.dataset.email, button.dataset.name, button);
      });
      actions.appendChild(button);
    }
  }
}

async function removeProjectPerson(email, name, button) {
  if (currentUser?.role !== 'admin') { toast('Solo el administrador puede retirar trabajadores del proyecto.'); return; }
  if (!confirm(`¿Retirar a ${name || email} del proyecto? Perderá el acceso, pero sus informes y archivos se conservarán.`)) return;
  button.disabled = true;
  try {
    await shareApi('/api/people/remove', { method: 'POST', body: JSON.stringify({ email }) });
    const removedEmail = String(email || '').toLowerCase();
    window.projectTeamAccounts = (window.projectTeamAccounts || []).filter(person => String(person.email || '').toLowerCase() !== removedEmail);
    button.closest('.worker-card, .item')?.remove();
    const [snapshot, people] = await Promise.all([shareApi('/api/live'), shareApi('/api/people')]);
    window.projectTeamAccounts = people;
    renderLiveSnapshot(snapshot);
    await renderShare();
    toast('Trabajador retirado del proyecto. Sus entregas siguen guardadas.');
  } catch (error) {
    button.disabled = false;
    toast(error.message || 'No se pudo retirar al trabajador.');
  }
}

function shareNoteMarkup(value) {
  return shareEscape(value).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\r?\n/g, '<br>');
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

function updateProjectMap() {
  const preview = document.getElementById('projectMapPreview');
  const addressLabel = document.getElementById('projectMapAddress');
  const openLink = document.getElementById('projectMapOpen');
  const locationSummary = document.getElementById('projectLocationSummary');
  if (!preview || !addressLabel || !openLink) return;
  const locationParts = ['projectDistrict', 'projectProvince', 'projectDepartment']
    .map(id => document.getElementById(id))
    .filter(select => select?.value)
    .map(select => select.options[select.selectedIndex]?.textContent.trim())
    .filter(Boolean);
  const address = locationParts.length ? `${locationParts.join(', ')}, Perú` : String(project?.location || '').trim();
  if (!address) {
    if (locationSummary) locationSummary.textContent = 'Ubicación del proyecto: todavía no seleccionada.';
    addressLabel.textContent = 'Selecciona una ubicación para mostrar el mapa.';
    preview.innerHTML = '<div class="project-map-placeholder">El mapa aparecerá cuando elijas el departamento, provincia o distrito.</div>';
    openLink.hidden = true;
    openLink.removeAttribute('href');
    return;
  }
  const encodedAddress = encodeURIComponent(address);
  if (locationSummary) locationSummary.textContent = `Ubicación del proyecto: ${address}`;
  addressLabel.textContent = `Ubicación seleccionada: ${address}`;
  preview.innerHTML = `<iframe title="Mapa referencial: ${shareEscape(address)}" src="https://maps.google.com/maps?q=${encodedAddress}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
  openLink.href = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  openLink.hidden = false;
}

function prepareProjectForm() {
  const direct = document.getElementById('directProjectFields');
  if (direct && !document.getElementById('techReportRole')) direct.insertAdjacentHTML('beforebegin', `<div class="field"><label for="techReportRole">Responsable de obra / cargo</label><select id="techReportRole"><option value="resident">Residente de obra</option><option value="supervisor">Inspector o supervisor de obra</option></select><div class="mini">Esta elección cambia las plantillas de 4 · Entregas. El Anexo 13 corresponde al informe mensual de supervisión.</div></div><details class="field" id="supervisionReportIdentity"><summary><b>Datos del residente y del inspector/supervisor para el Anexo 13</b></summary><p class="mini">Completa los datos personales, designación o contrato y periodo de servicio para que aparezcan en el informe mensual de supervisión.</p><h4>Datos del residente</h4><div class="grid2"><div class="field"><label>Nombre completo</label><input id="techResidentName"></div><div class="field"><label>DNI</label><input id="techResidentDni"></div><div class="field"><label>Registro CIP/CAP</label><input id="techResidentCip"></div><div class="field"><label>Resolución de designación o contrato</label><input id="techResidentDesignation"></div><div class="field"><label>Monto del contrato (S/)</label><input id="techResidentAmount" type="number" min="0" step="0.01"></div><div class="field"><label>Fecha de designación o contrato</label><input id="techResidentResolutionDate" type="date"></div><div class="field"><label>Inicio del servicio</label><input id="techResidentServiceStart" type="date"></div><div class="field"><label>Término del servicio</label><input id="techResidentServiceEnd" type="date"></div></div><h4>Datos del inspector o supervisor</h4><div class="grid2"><div class="field"><label>Nombre completo</label><input id="techSupervisorName"></div><div class="field"><label>DNI</label><input id="techSupervisorDni"></div><div class="field"><label>Registro CIP/CAP</label><input id="techSupervisorCip"></div><div class="field"><label>Resolución de designación o contrato</label><input id="techSupervisorDesignation"></div><div class="field"><label>Monto del servicio (S/)</label><input id="techSupervisorAmount" type="number" min="0" step="0.01"></div><div class="field"><label>Fecha de designación o contrato</label><input id="techSupervisorResolutionDate" type="date"></div><div class="field"><label>Inicio del servicio</label><input id="techSupervisorServiceStart" type="date"></div><div class="field"><label>Término del servicio</label><input id="techSupervisorServiceEnd" type="date"></div></div></details><div class="grid2"><div class="field"><label>Unidad ejecutora</label><input id="techExecutiveUnit"></div><div class="field"><label>Pliego</label><input id="techPliego"></div><div class="field"><label>Estado de la obra</label><input id="techWorkStatus"></div><div class="field"><label>Plazo de ejecución (días calendario)</label><input id="techWorkTermDays" type="number" min="0"></div><div class="field"><label>Sistema de ejecución</label><input id="techExecutionSystem"></div><div class="field"><label>Fecha de término vigente</label><input id="techWorkEnd" type="date"></div></div>`);
  const roleField = document.getElementById('techReportRole')?.closest('.field');
  const modalityField = document.getElementById('projectType')?.closest('.field');
  if (roleField && modalityField) modalityField.insertAdjacentElement('afterend', roleField);
  const projectCard = document.getElementById('projectName')?.closest('.card');
  if (projectCard && !document.getElementById('projectExecutionDates')) {
    const dates = document.createElement('div');
    dates.id = 'projectExecutionDates';
    dates.className = 'grid2';
    [['techWorkStart', 'Fecha de inicio de la obra'], ['techWorkEnd', 'Fecha final vigente de la obra'], ['techWorkTermDays', 'Plazo de ejecución del proyecto (días calendario)']].forEach(([id, label]) => {
      const field = document.getElementById(id)?.closest('.field');
      if (!field) return;
      const fieldLabel = field.querySelector('label');
      if (fieldLabel) fieldLabel.textContent = label;
      if (id === 'techWorkTermDays') {
        const input = field.querySelector('input');
        if (input) { input.type = 'number'; input.min = '1'; input.placeholder = 'Ej. 180'; }
      }
      dates.appendChild(field);
    });
    const note = document.createElement('p');
    note.className = 'mini';
    note.textContent = 'El plazo ayuda a calcular la fecha final si no la registras. Las cargas deben corresponder al periodo de ejecución del proyecto.';
    const anchor = roleField || modalityField;
    if (anchor) {
      anchor.insertAdjacentElement('afterend', dates);
      dates.insertAdjacentElement('afterend', note);
    } else {
      projectCard.append(dates, note);
    }
  }
  if (direct && !document.getElementById('techDirectApprovalReports')) direct.insertAdjacentHTML('beforeend', `<div class="field"><label>Informes tecnico, legal y presupuestal de aprobacion</label><textarea id="techDirectApprovalReports" placeholder="Numero, fecha y conclusion de cada informe"></textarea></div><div class="field"><label>Personal clave designado</label><textarea id="techDirectKeyStaff" placeholder="Residente, inspector/supervisor, administrador, calidad y seguridad: nombre y documento de designacion"></textarea></div><div class="field"><label>Revision del expediente tecnico</label><textarea id="techDirectExpedientReview" placeholder="Informes del residente y del inspector/supervisor; observaciones y acciones"></textarea></div><div class="field"><label>Plan de abastecimiento y calendario de obra</label><textarea id="techDirectSupplyPlan" placeholder="Bienes, servicios, personal y fechas principales"></textarea></div><div class="field"><label>Ejecucion del periodo: avance, gastos y metas</label><textarea id="techDirectPeriodProgress" placeholder="Avance fisico y financiero, metrados, gastos, metas y diferencias"></textarea></div><div class="field"><label>Calidad, seguridad, ambiente y ocurrencias</label><textarea id="techDirectQualitySafety" placeholder="Ensayos, controles, incidentes, riesgos y acciones correctivas"></textarea></div><div class="field"><label>Modificaciones de obra y plazo</label><textarea id="techDirectChanges" placeholder="Sustento, autorizacion, efecto en costo/plazo y registro en cuaderno de obra"></textarea></div><div class="field"><label>Culminacion, liquidacion y transferencia</label><textarea id="techDirectCloseout" placeholder="Recepcion, liquidacion y transferencia: estado y documentos"></textarea></div>`);
  const contract = document.getElementById('contractProjectFields');
  if (contract && !document.getElementById('techContractSupervisor')) contract.insertAdjacentHTML('beforeend', `<div class="field"><label>Fecha de firma del contrato</label><input id="techContractDate" type="date"></div><div class="field"><label>Procedimiento de selección / número en SEACE</label><input id="techContractProcedure" placeholder="Procedimiento y código, si corresponde"></div><div class="field"><label>Expediente técnico y aprobación vigente</label><textarea id="techContractExpedient" placeholder="Resolución, fecha, versión aprobada y documentos entregados"></textarea></div><div class="field"><label>Garantías y seguros vigentes</label><textarea id="techContractGuarantees" placeholder="Tipo, monto, vigencia y documento"></textarea></div><div class="field"><label>Supervisor o inspector y contrato de supervisión</label><textarea id="techContractSupervisor" placeholder="Nombre, registro, contrato y periodo"></textarea></div><div class="field"><label>Calendario aprobado y avance del periodo</label><textarea id="techContractSchedule" placeholder="Calendario vigente, avance programado/ejecutado, ruta crítica y reprogramaciones"></textarea></div><div class="field"><label>Valorizaciones, metrados y pagos</label><textarea id="techContractValuations" placeholder="Periodo, monto, estado, observaciones, reajustes y sustento"></textarea></div><div class="field"><label>Enlace al cuaderno de incidencias</label><input id="techContractNotebookLink" type="url" placeholder="Enlace al registro digital, si corresponde"></div><div class="field"><label>Ampliaciones, suspensiones y cambios aprobados</label><textarea id="techContractChanges" placeholder="Adicionales, mayores metrados, deductivos, ampliaciones, suspensiones y reinicios: documento, monto/días y nueva fecha"></textarea></div><div class="field"><label>Penalidades, incumplimientos y controversias</label><textarea id="techContractPenaltyStatus" placeholder="Hecho, sustento, trámite y situación actual"></textarea><textarea id="techContractDisputes" placeholder="Reclamos, juntas de prevención, arbitrajes u otras controversias pendientes"></textarea></div><div class="field"><label>Recepción de obra</label><textarea id="techContractReception" placeholder="Comunicación de culminación, comité, fecha, observaciones y subsanación"></textarea></div><div class="field"><label>Liquidación contractual</label><textarea id="techContractLiquidation" placeholder="Presentación, revisión, consentimiento, saldo y pago"></textarea></div><div class="field"><label>Documentos finales de obra</label><textarea id="techContractFinalDocuments" placeholder="Planos finales, manuales, pruebas, garantías y archivos entregados"></textarea></div><div class="field"><label>Resumen de recepción, liquidación y cierre</label><textarea id="techContractCloseout" placeholder="Estado final, documentos pendientes y responsables"></textarea></div>`);
  const locationInput = document.getElementById('location');
  if (locationInput) {
    const field = locationInput.closest('.field');
    field.innerHTML = `<label>Ubicación del proyecto</label><div class="grid2"><div class="field"><label>Departamento</label><select id="projectDepartment"><option value="">Selecciona un departamento</option></select></div><div class="field"><label>Provincia</label><select id="projectProvince" disabled><option value="">Primero selecciona un departamento</option></select></div><div class="field"><label>Distrito</label><select id="projectDistrict" disabled><option value="">Primero selecciona una provincia</option></select></div></div><div id="projectLocationSummary" class="project-location-summary">Ubicación del proyecto: todavía no seleccionada.</div><div class="project-map-card"><div class="project-map-head"><div><b>Mapa referencial</b><div id="projectMapAddress" class="mini">Selecciona una ubicación para mostrar el mapa.</div></div><a id="projectMapOpen" class="project-map-link" target="_blank" rel="noopener noreferrer" hidden>Abrir mapa completo</a></div><div id="projectMapPreview" class="project-map-preview"><div class="project-map-placeholder">El mapa aparecerá cuando elijas el departamento, provincia o distrito.</div></div></div>`
  }
  const projectInfoCard = document.getElementById('projectName')?.closest('.card');
  if (projectInfoCard && !document.getElementById('projectAccessMessage')) {
    const message = document.createElement('p');
    message.id = 'projectAccessMessage';
    message.className = 'mini';
    message.textContent = 'Solo el administrador puede editar la información del proyecto.';
    projectInfoCard.insertBefore(message, projectInfoCard.querySelector('#projectName').parentElement);
  }
  document.getElementById('projectDepartment')?.addEventListener('change', () => {
    populateProjectProvinces();
    populateProjectDistricts();
    updateProjectMap();
  });
  document.getElementById('projectProvince')?.addEventListener('change', () => { populateProjectDistricts(); updateProjectMap(); });
  document.getElementById('projectDistrict')?.addEventListener('change', updateProjectMap);
  const saveButton = document.getElementById('saveProject');
  document.getElementById('saveTechnicalProject')?.addEventListener('click', () => saveSharedProject());
  document.getElementById('projectType')?.addEventListener('change', updateTechnicalProjectFields);
  if (saveButton) saveButton.onclick = saveSharedProject;
  ubigeoReady = loadUbigeoCatalog();
  setProjectAccess(null);
  bindAutosave();
}

function updateTechnicalProjectFields() {
  const type = document.getElementById('projectType')?.value;
  if (type) project.executionType = type;
  document.getElementById('directProjectFields')?.classList.toggle('hidden', type !== 'Administración directa');
  document.getElementById('contractProjectFields')?.classList.toggle('hidden', type !== 'Obra por contrata');
  const roleSelect = document.getElementById('techReportRole');
  if (roleSelect) {
    const oldValue = roleSelect.value;
    const contract = type === 'Obra por contrata';
    roleSelect.innerHTML = contract
      ? '<option value="resident">Residente del contratista</option><option value="supervisor">Inspector o supervisor de obra</option>'
      : '<option value="resident">Residente de obra</option><option value="supervisor">Inspector o supervisor de obra</option>';
    roleSelect.value = oldValue || 'resident';
    const roleLabel = roleSelect.closest('.field')?.querySelector('label');
    if (roleLabel) roleLabel.textContent = 'Responsable de obra / cargo';
    const help = roleSelect.closest('.field')?.querySelector('.mini');
    if (help) help.textContent = contract
      ? 'Esta selección elige la plantilla mensual y de cierre para residente del contratista o supervisor.'
      : 'Esta selección cambia las plantillas de administración directa para residente o supervisor.';
    const identityTitle = document.querySelector('#supervisionReportIdentity summary b');
    if (identityTitle) identityTitle.textContent = contract ? 'Datos del residente del contratista y del inspector/supervisor' : 'Datos del residente y del inspector/supervisor';
    const identityHelp = document.querySelector('#supervisionReportIdentity > .mini');
    if (identityHelp) identityHelp.textContent = contract
      ? 'Completa los datos de quienes ejecutan y supervisan el contrato para que aparezcan en las plantillas.'
      : 'Completa los datos personales y la designación para que aparezcan en las plantillas.';
  }
  refreshReportTemplateLibrary();
}

function refreshReportTemplateLibrary() {
  const library = document.getElementById('reportTemplateLibrary');
  if (library) library.outerHTML = reportTemplateLibraryMarkup();
}

async function loadUbigeoCatalog() {
  try {
    ubigeoCatalog = window.CENTRO_OFFLINE_MODE
      ? window.CENTRO_OFFLINE_SEED?.ubigeo
      : await fetch('/centro-control-ubigeo.json', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('No se pudo cargar la lista de ubicaciones.');
      return response.json();
    });
    if (!ubigeoCatalog) throw new Error('No se pudo cargar la lista de ubicaciones.');
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
  const canEdit = role === 'admin';
  const ids = ['projectName', 'entity', 'projectType', 'projectCode', 'cutoff', 'projectDesc', 'projectDepartment', 'projectProvince', 'projectDistrict', ...TECHNICAL_PROJECT_FIELDS];
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
      : 'Inicia sesion con una cuenta de administrador para editar el proyecto.';
}

async function loadSharedProject() {
  try {
    if (ubigeoReady) await ubigeoReady;
    const me = await shareApi('/api/me');
    currentUser = me;
    updateSectionClearButtons();
    if (me.role === 'staff' && workerDraftLoadedFor !== me.email) {
      const savedDraft = await shareApi('/api/draft');
      workerDraft = savedDraft.draft || workerDraft;
      workerDraftLoadedFor = me.email;
    }
    const saved = await shareApi('/api/project');
    setProjectAccess(me);
    ['name', 'entity', 'executionType', 'code', 'cutoff', 'description'].forEach(key => {
      const inputId = { name: 'projectName', entity: 'entity', executionType: 'projectType', code: 'projectCode', cutoff: 'cutoff', description: 'projectDesc' }[key];
      const field = document.getElementById(inputId);
      if (field && saved[key] !== undefined) field.value = saved[key];
    });
    TECHNICAL_PROJECT_FIELDS.forEach(id => { const field = document.getElementById(id); if (field && saved[id] !== undefined) field.value = saved[id]; });
    updateTechnicalProjectFields();
    if (ubigeoCatalog && saved.departmentCode) {
      document.getElementById('projectDepartment').value = saved.departmentCode;
      populateProjectProvinces(saved.provinceCode);
      populateProjectDistricts(saved.districtCode);
      updateProjectMap();
    }
    project = { ...saved, name: saved.name || '', entity: saved.entity || '', executionType: saved.executionType || '', location: saved.location || '', code: saved.code || '', cutoff: saved.cutoff || today(), desc: saved.description || '' };
    refreshReportTemplateLibrary();
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
      executionType: document.getElementById('projectType').value,
      code: document.getElementById('projectCode').value,
      cutoff: document.getElementById('cutoff').value,
      description: document.getElementById('projectDesc').value,
      departmentCode: document.getElementById('projectDepartment').value,
      provinceCode: document.getElementById('projectProvince').value,
      districtCode: document.getElementById('projectDistrict').value,
      ...Object.fromEntries(TECHNICAL_PROJECT_FIELDS.map(id => [id, document.getElementById(id)?.value || '']))
    }) });
    await loadSharedProject();
    if (!silent) toast('Informacion del proyecto guardada para todos.');
  } catch (error) {
    if (silent) shareMessage(error.message, true); else alert(error.message);
  }
}

function setTopLogoutVisible(visible) {
  document.getElementById('topLogout')?.classList.toggle('hidden', !visible);
}

function entryLandingMarkup(accessPanel, message = '') {
  return `<div class="entry-landing">
    <div class="entry-utility-bar"><span>GESTIÓN DE OBRA CIVIL</span><span>CONTROL LOCAL · ${new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
    <header class="entry-brand-bar"><div class="entry-brand"><span class="entry-brand-mark">CC</span><span><b>Centro de Control de Obra</b><small>Seguimiento claro para cada proyecto</small></span></div><span class="entry-brand-note">PROYECTO · AVANCE · ENTREGAS</span></header>
    <main class="entry-main">
      <section class="entry-hero">
        <div class="entry-eyebrow"><i></i> TU ESPACIO DE TRABAJO</div>
        <h1>La obra avanza.<br><span>Tu información, en orden.</span></h1>
        <p>Un solo lugar para organizar el proyecto, revisar entregas y dar seguimiento a cada actividad.</p>
        <div class="entry-illustration-card">
          <div class="entry-illustration-label"><span class="entry-live-dot"></span> CONTROL DE OBRA · LOCAL</div>
          <svg class="entry-civil-art" viewBox="0 0 720 390" role="img" aria-label="Ilustración de una obra civil con edificio, grúa y planos">
            <defs>
              <linearGradient id="entrySky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#102d52"/><stop offset="1" stop-color="#2780F5"/></linearGradient>
              <linearGradient id="entryBuilding" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8f3ff"/><stop offset="1" stop-color="#9fc8fa"/></linearGradient>
              <pattern id="entryGrid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#d9eaff" stroke-opacity=".14" stroke-width="1"/></pattern>
            </defs>
            <rect width="720" height="390" rx="20" fill="url(#entrySky)"/><rect width="720" height="390" rx="20" fill="url(#entryGrid)"/>
            <circle cx="563" cy="89" r="55" fill="#a9ceff" fill-opacity=".12"/><path d="M28 326H692" stroke="#dcecff" stroke-opacity=".55" stroke-width="2"/>
            <g class="entry-blueprint-lines" fill="none" stroke="#e3f0ff" stroke-opacity=".46" stroke-width="2"><path d="M59 284V91H212V284M59 142H212M59 194H212M111 91V284M161 91V284"/><path d="M45 303H226M49 82H222M49 76V88M222 76V88"/><path d="M70 114H95M122 114H147M173 114H199M70 165H95M122 165H147M173 165H199M70 217H95M122 217H147M173 217H199"/></g>
            <g class="entry-building">
              <path d="M268 326V202L357 155L446 202V326Z" fill="url(#entryBuilding)" stroke="#f1f7ff" stroke-width="3"/>
              <path d="M268 202H446M268 244H446M268 285H446M357 155V326" fill="none" stroke="#5489c8" stroke-width="3"/>
              <path d="M286 215H336V235H286ZM378 215H428V235H378ZM286 256H336V276H286ZM378 256H428V276H378ZM286 297H336V317H286ZM378 297H428V317H378Z" fill="#75a9e9" stroke="#eaf4ff" stroke-width="2"/>
              <path d="M250 326H464" stroke="#fff" stroke-opacity=".9" stroke-width="5"/>
            </g>
            <g class="entry-crane" fill="none" stroke="#ffe3a0" stroke-linecap="round" stroke-linejoin="round">
              <path d="M520 326V78M507 326H533M520 78L511 326M520 78L529 326" stroke-width="5"/>
              <path d="M337 91H625M520 91L573 61M355 91L377 61H520" stroke-width="6"/>
              <path d="M363 91V104M408 91V105M463 91V102M576 91V115" stroke-width="2"/>
              <path d="M405 91V137Q405 151 417 151Q429 151 429 137" stroke-width="3"/>
              <path d="M510 78L520 58L530 78M492 326H548" stroke-width="3"/>
            </g>
            <g fill="#fff" fill-opacity=".8"><circle cx="87" cy="54" r="3"/><circle cx="105" cy="54" r="3"/><circle cx="123" cy="54" r="3"/><circle cx="87" cy="72" r="3"/><circle cx="105" cy="72" r="3"/><circle cx="123" cy="72" r="3"/></g>
            <path d="M24 350H696" stroke="#dbeaff" stroke-opacity=".18"/>
          </svg>
          <div class="entry-illustration-caption"><span><b>CONTROL DE PROYECTO</b><small>Información organizada para decidir mejor</small></span><span class="entry-caption-mark">01</span></div>
        </div>
        <div class="entry-benefits"><span>✓ Seguimiento semanal</span><span>✓ Documentos ordenados</span><span>✓ Equipo coordinado</span></div>
      </section>
      <section class="entry-access-panel">${accessPanel}</section>
    </main>
    <footer class="entry-footer"><span>Centro de Control de Obra</span><span>Gestión local · los datos permanecen en este equipo</span></footer>
  </div>`;
}

async function renderEntryGate(message = '') {
  document.body.classList.add('auth-initializing');
  setTopLogoutVisible(false);
  let status;
  try {
    status = await shareApi('/api/status');
    const me = await shareApi('/api/me').catch(() => null);
    if (me) {
      setTopLogoutVisible(true);
      closeEntryGate();
      await loadSharedProject();
      document.body.classList.remove('auth-initializing');
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
  gate.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow:auto;background:var(--bg);display:block;padding:0';
  document.body.style.overflow = 'hidden';
  if (status.setup) {
    gate.innerHTML = entryLandingMarkup(`<div class="entry-auth-card"><div class="entry-auth-icon">✦</div><div class="entry-auth-kicker">CONFIGURACIÓN INICIAL</div><h2>Crear acceso de administrador</h2><p class="entry-auth-copy">Configura la cuenta que administrará los informes.</p><div class="entry-gate-fields"><div class="entry-gate-field"><label for="adminEmail">Correo</label><input id="adminEmail" type="email" value="brandonlasteros31@gmail.com" readonly></div><div class="entry-gate-field"><label for="adminPassword">Contraseña (mínimo 10 caracteres)</label><input id="adminPassword" type="password" autocomplete="new-password"></div><div class="entry-gate-field"><label for="adminConfirm">Repite la contraseña</label><input id="adminConfirm" type="password" autocomplete="new-password"></div></div><div class="entry-gate-actions"><button class="primary" data-action="setup">Crear acceso</button></div><p id="entryMessage" class="entry-gate-message">${shareEscape(message)}</p></div>`, message);
    document.body.classList.remove('auth-initializing');
    return;
  }
  const accessPanel = `<div class="entry-form-heading"><h2>Centro de control</h2><p>Inicia sesión para continuar.</p></div><div class="entry-auth-card"><div class="entry-auth-icon">↗</div><div class="entry-auth-kicker">ACCESO AL PROYECTO</div><h2>Iniciar sesión</h2><p class="entry-auth-copy">Ingresa con el correo autorizado por la administración.</p><div class="entry-gate-fields"><div class="entry-gate-field"><label for="loginEmail">Correo autorizado</label><input id="loginEmail" type="email" autocomplete="username"></div><div class="entry-gate-field"><label for="loginPassword">Contraseña</label><input id="loginPassword" type="password" autocomplete="current-password"></div></div><div class="entry-gate-actions"><button class="primary" data-action="login">Entrar</button></div><p id="entryMessage" class="entry-gate-message">${shareEscape(message)}</p></div><div class="entry-auth-card entry-activation-card"><div class="entry-auth-icon entry-activation-icon">＋</div><div class="entry-auth-kicker">NUEVO INTEGRANTE</div><h2>Activar cuenta</h2><p class="entry-auth-copy">Primero pide una invitación a la persona administradora.</p><div class="entry-gate-fields"><div class="entry-gate-field"><label for="activateName">Nombre completo</label><input id="activateName" autocomplete="name"></div><div class="entry-gate-field"><label for="activateEmail">Correo autorizado</label><input id="activateEmail" type="email" autocomplete="email"></div><div class="entry-gate-field"><label for="inviteCode">Código de invitación</label><input id="inviteCode" autocomplete="one-time-code"></div><div class="entry-gate-field"><label for="activatePassword">Crea una contraseña</label><input id="activatePassword" type="password" autocomplete="new-password"></div><div class="entry-gate-field"><label for="activateConfirm">Repite la contraseña</label><input id="activateConfirm" type="password" autocomplete="new-password"></div></div><div class="entry-gate-actions"><button data-action="activate">Activar cuenta</button></div></div>`;
  gate.innerHTML = entryLandingMarkup(accessPanel, message);
  const loginMessage = document.getElementById('entryMessage');
  if (loginMessage) {
    loginMessage.setAttribute('role', 'status');
    loginMessage.setAttribute('aria-live', 'polite');
  }
  const activateButton = gate.querySelector('[data-action="activate"]');
  if (activateButton) {
    const activationMessage = document.createElement('p');
    activationMessage.id = 'activationMessage';
    activationMessage.className = 'entry-gate-message';
    activationMessage.setAttribute('role', 'status');
    activationMessage.setAttribute('aria-live', 'polite');
    activateButton.insertAdjacentElement('afterend', activationMessage);
  }
  document.body.classList.remove('auth-initializing');
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
  const reportSummary = document.getElementById('reportPeriodSummary');
  if (reportSummary && !document.getElementById('useValuationSummary')) {
    reportSummary.closest('.field')?.insertAdjacentHTML('beforeend', '<button type="button" id="useValuationSummary">Completar con la última valorización</button><div class="mini">Puedes ajustar el texto después de traer los datos.</div>');
    reportSummary.addEventListener('focus', () => { if (!reportSummary.value.trim()) fillReportSummaryFromValuation(false); }, { once: true });
    document.getElementById('reportPeriodEnd')?.addEventListener('change', () => { if (!reportSummary.value.trim()) fillReportSummaryFromValuation(false); });
    document.getElementById('useValuationSummary')?.addEventListener('click', () => fillReportSummaryFromValuation(true));
  }
  const occurrences = document.getElementById('reportOccurrences')?.closest('.field');
  if (occurrences && !document.getElementById('reportNotebookLink')) occurrences.insertAdjacentHTML('beforeend', '<label for="reportNotebookLink">Cuaderno de obra</label><input id="reportNotebookLink" type="url" placeholder="Pega aquí el enlace al cuaderno digital, si corresponde"><div class="mini">El revisor debe tener permiso para abrir el enlace. También puedes adjuntar una copia aquí abajo.</div><input id="reportNotebookFile" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"><div class="mini">Los archivos se adjuntan al informe enviado. Máximo total: 20 archivos, 15 MB por archivo y 100 MB en total.</div>');
  const quality = document.getElementById('reportQuality')?.closest('.field');
  if (quality && !document.getElementById('reportQualityLink')) quality.insertAdjacentHTML('beforeend', '<label for="reportQualityLink">Enlace a la información de calidad (opcional)</label><input id="reportQualityLink" type="url" placeholder="Pega aquí el enlace a ensayos, protocolos o certificados"><div class="mini">El revisor debe tener permiso para abrir el enlace. También puedes adjuntar archivos aquí abajo.</div><input id="reportQualityFile" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"><div class="mini">Los archivos se adjuntan al informe; comparten el límite total de 20 archivos y 100 MB.</div>');
  const safety = document.getElementById('reportSafetyEnvironment')?.closest('.field');
  if (safety && !document.getElementById('reportSafetyLink')) safety.insertAdjacentHTML('beforeend', '<label for="reportSafetyLink">Enlace a seguridad y ambiente (opcional)</label><input id="reportSafetyLink" type="url" placeholder="Pega aquí el enlace al plan de seguridad o ATS"><div class="mini">El revisor debe tener permiso para abrir el enlace. También puedes adjuntar el plan, ATS, IPERC y otros documentos aquí abajo.</div><input id="reportSafetyFile" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"><div class="mini">Los archivos se adjuntan al informe; comparten el límite total de 20 archivos y 100 MB.</div>');
  const conclusions = document.getElementById('reportConclusions');
  if (conclusions && !document.getElementById('generateWeeklyConclusion')) {
    conclusions.closest('.field')?.insertAdjacentHTML('beforeend', '<button type="button" id="generateWeeklyConclusion">Generar conclusión de la semana</button><div class="mini">Usa la información escrita y los datos de valorización del periodo. Los archivos adjuntos quedan como sustento; su contenido no se lee automáticamente.</div>');
    document.getElementById('generateWeeklyConclusion')?.addEventListener('click', () => generateWeeklyConclusion(true));
    conclusions.addEventListener('focus', () => { if (!conclusions.value.trim()) generateWeeklyConclusion(false); }, { once: true });
  }
  const recommendations = document.getElementById('reportRecommendations');
  if (recommendations && !document.getElementById('generateWeeklyRecommendations')) {
    recommendations.closest('.field')?.insertAdjacentHTML('beforeend', '<button type="button" id="generateWeeklyRecommendations">Generar recomendaciones de la semana</button><div class="mini">Propone acciones a partir de lo escrito y los registros semanales. Los archivos quedan como sustento; el sistema no lee su contenido automáticamente. Puedes editar el resultado.</div>');
    document.getElementById('generateWeeklyRecommendations')?.addEventListener('click', () => generateWeeklyRecommendations(true));
    recommendations.addEventListener('focus', () => { if (!recommendations.value.trim()) generateWeeklyRecommendations(false); }, { once: true });
  }
  const legacyReview = document.getElementById('loginPanel')?.closest('.card');
  if (legacyReview) {
    legacyReview.id = 'privateReviewCard';
    legacyReview.innerHTML = '<h2>Revisión privada</h2><p class="muted">Solo el administrador puede aprobar informes o autorizar correcciones.</p><div id="privateReviewList"></div>';
    legacyReview.classList.add('hidden');
  }
  bindPendingFileRemoval();
}

async function generateWeeklyConclusion(force = false) {
  const field = document.getElementById('reportConclusions');
  if (!field || (!force && field.value.trim())) return;
  const read = id => document.getElementById(id)?.value.trim() || '';
  const start = read('reportPeriodStart');
  const end = read('reportPeriodEnd') || read('reportDate') || today();
  const weekAnchor = new Date(`${end}T12:00:00`);
  weekAnchor.setDate(weekAnchor.getDate() - ((weekAnchor.getDay() + 6) % 7));
  const weekStart = start || weekAnchor.toISOString().slice(0, 10);
  const period = `${fmt(weekStart)} al ${fmt(end)}`;
  const allItems = await shareApi('/api/technical-summary').catch(() => sharedReportItems);
  const valuations = allItems.filter(item => item.kind === 'valuation' && item.valuationPeriod && item.valuationPeriod <= end && item.valuationPeriod >= weekStart).sort((a, b) => String(a.valuationPeriod).localeCompare(String(b.valuationPeriod)));
  const valuation = valuations[valuations.length - 1];
  const execution = read('reportPeriodSummary') || (valuation ? `Valorización ${valuation.valuationNumber || valuation.title}: avance acumulado programado ${valuation.plannedProgress ?? 'sin dato'}% y ejecutado ${valuation.actualProgress ?? 'sin dato'}%.` : 'No se registró un resumen de ejecución ni una valorización para el periodo.');
  const occurrences = read('reportOccurrences') || 'No se registraron ocurrencias en el campo de esta semana.';
  const quality = read('reportQuality') || 'No se registró información de calidad en el campo de esta semana.';
  const safety = read('reportSafetyEnvironment') || 'No se registró información de seguridad y ambiente en el campo de esta semana.';
  const actions = read('reportRecommendations') || 'No se registraron recomendaciones en el campo de esta semana.';
  const files = ['reportFile','reportNotebookFile','reportQualityFile','reportSafetyFile'].flatMap(id => Array.from(document.getElementById(id)?.files || []).map(file => file.name));
  const links = ['reportNotebookLink','reportQualityLink','reportSafetyLink'].map(read).filter(Boolean);
  const supporting = [...(files.length ? [`Archivos adjuntos: ${files.join(', ')}.`] : []), ...(links.length ? [`Enlaces de sustento: ${links.join(', ')}.`] : [])];
  const weeklyItems = allItems.filter(item => {
    const date = String(item.valuationPeriod || item.documentDate || item.conformityDate || item.created || '').slice(0, 10);
    return date && date <= end && date >= weekStart;
  });
  const otherDeliveries = weeklyItems.map(item => {
    const kind = item.kind === 'valuation' ? 'Valorización' : item.kind === 'conformity' ? 'Orden/conformidad' : 'Informe';
    const detail = String(item.note || '').replace(/\s+/g, ' ').trim().slice(0, 320);
    const names = (item.files || []).map(file => file.name).join(', ');
    return `${kind}: ${item.title || item.valuationNumber || 'Sin título'} (${item.status || 'sin estado'})${detail ? ` — ${detail}` : ''}${names ? ` · Archivos: ${names}` : ''}`;
  });
  const weeklyActivities = activities.filter(item => item.due && item.due >= weekStart && item.due <= end).map(item => `Actividad: ${item.title} — ${item.done ? 'culminada' : 'pendiente'}${item.owner ? `, responsable: ${item.owner}` : ''}.`);
  const weeklyComments = comments.filter(item => item.date && item.date >= weekStart && item.date <= end).map(item => `Comentario semanal: ${item.text}${item.link ? ` (relacionado con ${item.link})` : ''}`);
  const weeklyContext = [...(otherDeliveries.length ? [`Otras entregas de la semana: ${otherDeliveries.join(' | ')}`] : []), ...weeklyActivities, ...weeklyComments];
  field.value = [`Conclusión semanal · ${period}`, `Ejecución física y financiera: ${execution}`, `Ocurrencias y riesgos: ${occurrences}`, `Calidad: ${quality}`, `Seguridad y ambiente: ${safety}`, `Acciones y recomendaciones: ${actions}`, ...weeklyContext, ...supporting, 'La conclusión se basa en la información registrada para el periodo; verificar los documentos adjuntos y enlaces antes de emitir el informe.'].join('\n\n');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

async function generateWeeklyRecommendations(force = false) {
  const field = document.getElementById('reportRecommendations');
  if (!field || (!force && field.value.trim())) return;
  const read = id => document.getElementById(id)?.value.trim() || '';
  const end = read('reportPeriodEnd') || read('reportDate') || today();
  const start = read('reportPeriodStart');
  const weekAnchor = new Date(`${end}T12:00:00`);
  weekAnchor.setDate(weekAnchor.getDate() - ((weekAnchor.getDay() + 6) % 7));
  const weekStart = start || weekAnchor.toISOString().slice(0, 10);
  const allItems = await shareApi('/api/technical-summary').catch(() => sharedReportItems);
  const weekly = allItems.filter(item => {
    const date = String(item.valuationPeriod || item.documentDate || item.conformityDate || item.created || '').slice(0, 10);
    return date && date >= weekStart && date <= end;
  });
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const notes = [read('reportPeriodSummary'), read('reportOccurrences'), read('reportQuality'), read('reportSafetyEnvironment'), ...weekly.flatMap(item => [item.title, item.note, ...(item.files || []).map(file => file.name)])];
  const evidence = normalize(notes.join(' '));
  const direct = project.executionType === 'Administración directa';
  const recommendations = [];
  if (direct) {
    recommendations.push('Mantener el cuaderno de obra al día y sustentar el informe mensual con avances físicos y financieros, ocurrencias y valorizaciones, conforme a los numerales 7.3.2 y 7.3.4 de la Directiva 017-2023-CG/GMPL.');
    recommendations.push('Conservar los resultados de ensayos y controles de calidad, y registrar las medidas adoptadas, conforme al numeral 7.3.5 de la Directiva 017-2023-CG/GMPL.');
  } else if (project.executionType === 'Obra por contrata') {
    recommendations.push('Relacionar cada valorización con sus metrados y sustento, y verificar su registro y seguimiento según la Directiva 018-2025-OECE-CD y el contrato.');
    recommendations.push('Registrar las comunicaciones, instrucciones y decisiones de la ejecución contractual por los medios y plazos previstos en el contrato y la normativa aplicable.');
  }
  const valuations = weekly.filter(item => item.kind === 'valuation').sort((a, b) => String(a.valuationPeriod).localeCompare(String(b.valuationPeriod)));
  const lastValuation = valuations[valuations.length - 1];
  if (lastValuation && Number.isFinite(Number(lastValuation.plannedProgress)) && Number.isFinite(Number(lastValuation.actualProgress)) && Number(lastValuation.actualProgress) < Number(lastValuation.plannedProgress)) {
    recommendations.push(`El avance ejecutado (${Number(lastValuation.actualProgress).toFixed(2)}%) está por debajo del programado (${Number(lastValuation.plannedProgress).toFixed(2)}%). Revisar las causas y definir medidas de recuperación con responsable y fecha, sin afectar la calidad ni la seguridad.`);
  }
  if (/atraso|retraso|desfase|paralizacion|suspension|plazo vencido/.test(evidence)) {
    recommendations.push(direct
      ? 'Evaluar y sustentar cualquier ajuste de plazo o modificación antes de ejecutarlo, con el registro y aprobación que correspondan, conforme a los numerales 7.3.6 y 7.3.7 de la Directiva 017-2023-CG/GMPL.'
      : 'Revisar las causas del atraso y documentar las medidas, comunicaciones y solicitudes de plazo que correspondan, conforme al contrato y a la Ley 32069 y su Reglamento vigente.');
  }
  if (/accidente|incidente|riesgo|peligro|condicion insegura|ats|iperc/.test(evidence)) {
    recommendations.push('Verificar que las medidas de seguridad indicadas se hayan aplicado en campo; dejar responsable, fecha de seguimiento y evidencia de cierre para cada riesgo u ocurrencia.');
  }
  if (/ensayo|calidad|no conform|observacion de calidad|falla|defecto|rechaz/.test(evidence)) {
    recommendations.push('Dar seguimiento a las observaciones de calidad, completar los ensayos o verificaciones pendientes y registrar su resultado antes de dar por atendida la partida observada.');
  }
  if (!read('reportOccurrences')) recommendations.push('Completar el registro de ocurrencias y riesgos de la semana, o indicar expresamente que no se reportaron eventos.');
  if (!read('reportQuality')) recommendations.push('Completar el resultado de los controles de calidad de la semana y adjuntar los ensayos o protocolos disponibles.');
  if (!read('reportSafetyEnvironment')) recommendations.push('Completar las verificaciones de seguridad y ambiente de la semana; adjuntar el plan, ATS, IPERC u otros documentos que correspondan.');
  if (!recommendations.length) recommendations.push('Mantener el seguimiento semanal del avance, riesgos, calidad y seguridad, y respaldar las decisiones con sus registros y documentos.');
  const refs = direct
    ? 'Referencia: Directiva 017-2023-CG/GMPL, numerales 7.3.2, 7.3.4, 7.3.5, 7.3.6 y 7.3.7, según corresponda. https://www.gob.pe/institucion/contraloria/normas-legales/4984570-017-2023-cg-gmpl'
    : project.executionType === 'Obra por contrata'
      ? 'Referencia: Ley 32069, Reglamento aprobado por D. S. 009-2025-EF y sus modificatorias (incluido D. S. 001-2026-EF); Directiva 018-2025-OECE-CD para valorizaciones, según corresponda al contrato. Normativa: https://www.gob.pe/institucion/oece/colecciones/45029-ley-n-32069-ley-general-de-contrataciones-publicas-y-su-reglamento · Directivas: https://www.gob.pe/institucion/oece/colecciones/66212-directivas-vigentes-ley-n-32069'
      : 'Selecciona la modalidad del proyecto para mostrar referencias normativas específicas.';
  field.value = [...new Set(recommendations), refs, 'Propuestas generadas con la información registrada; verificar el contrato, los documentos y la versión normativa aplicable antes de emitir el informe.'].join('\n\n');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

async function fillReportSummaryFromValuation(force = false) {
  const field = document.getElementById('reportPeriodSummary');
  if (!field || (!force && field.value.trim())) return;
  try {
    const items = await shareApi('/api/technical-summary').catch(() => sharedReportItems);
    const end = document.getElementById('reportPeriodEnd')?.value || today();
    const start = document.getElementById('reportPeriodStart')?.value || '';
    let valuations = items.filter(item => item.kind === 'valuation' && item.valuationPeriod && item.valuationPeriod <= end);
    if (start) {
      const matching = valuations.filter(item => item.valuationPeriod >= start);
      if (matching.length) valuations = matching;
    }
    valuations.sort((a, b) => String(a.valuationPeriod).localeCompare(String(b.valuationPeriod)));
    const item = valuations[valuations.length - 1];
    if (!item) { toast('No hay una valorización registrada hasta la fecha del informe.'); return; }
    const labels = ['Avance mensual programado (%)', 'Avance mensual ejecutado (%)', 'Monto valorizado del periodo (S/)', 'Monto valorizado acumulado (S/)', 'Avance financiero acumulado (%)', 'Metrados / partidas', 'Estado de trámite / pago'];
    const details = String(item.note || '').split(/\r?\n/).filter(line => labels.some(label => line.toLocaleLowerCase('es-PE').startsWith(label.toLocaleLowerCase('es-PE') + ':')));
    const number = item.valuationNumber || item.title || 'Sin número';
    field.value = [`Valorización ${number} · periodo ${fmt(item.valuationPeriod)}`, `Avance físico acumulado: programado ${item.plannedProgress ?? 'Sin dato'}% y ejecutado ${item.actualProgress ?? 'Sin dato'}%.`, ...details].join('\n');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    toast('Resumen completado con la valorización.');
  } catch (error) {
    toast(error.message);
  }
}

function populateResponsible(people, selectedEmail = '') {
  const select = document.getElementById('reportResponsible');
  if (!select) return;
  const active = people.filter(person => person.active && person.role === 'staff');
  select.innerHTML = '<option value="">Selecciona una persona registrada</option>' + active.map(person => `<option value="${shareEscape(person.email)}">${shareEscape(person.displayName)} · ${shareEscape(person.email)}</option>`).join('');
  if (selectedEmail && active.some(person => person.email === selectedEmail)) select.value = selectedEmail;
}

function compactSubmissionCard(id, title, status, body) {
  const detailsId = `submission-details-${id}`;
  const statusClass = status === 'Aprobada' ? 'approved' : status === 'Observada' ? 'observed' : 'pending';
  const displayStatus = currentUser?.role !== 'admin' && status === 'Pendiente' ? 'En revisión' : status;
  return `<div class="item submission-disclosure"><div class="submission-card-header"><b class="submission-card-title">${shareEscape(title)}</b><span class="badge ${statusClass}">${shareEscape(displayStatus)}</span><button type="button" class="submission-toggle" data-action="toggle-submission-details" data-id="${shareEscape(id)}" aria-expanded="false" aria-controls="${shareEscape(detailsId)}">Desplegar</button></div><div id="${shareEscape(detailsId)}" class="submission-details hidden">${body}</div></div>`;
}

function sharedSubmissionCards(items, adminMode) {
  if (!items.length) return '<div class="item">Todavía no hay entregas compartidas.</div>';
  return items.map(item => {
    const files = item.files || [];
    const detailsId = `submission-details-${item.id}`;
    const displayStatus = !adminMode && item.status === 'Pendiente' ? 'En revisión' : item.status;
    return `<div class="item submission-disclosure"><div class="submission-card-header"><b class="submission-card-title">${shareEscape(item.title)}</b><span class="badge ${item.status === 'Aprobada' ? 'approved' : item.status === 'Observada' ? 'observed' : 'pending'}">${shareEscape(displayStatus)}</span><button type="button" class="submission-toggle" data-action="toggle-submission-details" data-id="${shareEscape(item.id)}" aria-expanded="false" aria-controls="${shareEscape(detailsId)}">Desplegar</button></div><div id="${shareEscape(detailsId)}" class="submission-details hidden"><div class="mini">Entregado por: ${shareEscape(item.submitterName || item.email)} · ${shareEscape(item.email)}</div><div class="mini">Responsable: ${shareEscape(item.responsibleName || item.responsibleEmail || item.email)}${item.number ? ' · N.º ' + shareEscape(item.number) : ''}${item.documentDate ? ' · ' + fmt(item.documentDate) : ''} · ${new Date(item.created).toLocaleString('es-PE')}</div>${item.note ? `<p>${shareNoteMarkup(item.note)}</p>` : ''}<div class="submission-files">${files.length ? files.map(file => `<div class="submission-file-row"><span>${shareEscape(file.name)}</span><button type="button" data-action="download" data-id="${shareEscape(file.id)}" data-name="${shareEscape(file.name)}">Descargar</button></div>`).join('') : '<div class="mini">Esta entrega no tiene archivos adjuntos.</div>'}</div>${adminMode && item.status === 'Pendiente' ? `<div class="field"><label>Observaciones (obligatorias si devuelves)</label><textarea id="review-${shareEscape(item.id)}" placeholder="Qué debe corregirse"></textarea></div><div class="actions"><button class="good" data-action="review" data-id="${shareEscape(item.id)}" data-status="Aprobada">Aprobar</button><button class="warn" data-action="review" data-id="${shareEscape(item.id)}" data-status="Observada">Devolver con observaciones</button></div>` : adminMode && item.review ? `<p><b>Observaciones privadas:</b> ${shareEscape(item.review)}</p>` : ''}${adminMode && item.editRequestStatus === 'pending' ? `<div class="notice"><b>Solicita corregir este envío.</b><p>${shareEscape(item.editRequestNote || 'Sin motivo indicado')}</p><div class="actions"><button class="good" data-action="edit-decision" data-id="${shareEscape(item.id)}" data-status="authorized">Autorizar corrección</button><button data-action="edit-decision" data-id="${shareEscape(item.id)}" data-status="denied">Rechazar solicitud</button></div></div>` : ''}${!adminMode ? staffEditControls(item) : `<div class="actions"><button type="button" class="warn" data-action="delete-submission" data-id="${shareEscape(item.id)}">Eliminar esta entrega</button></div>`}</div></div>`;
  }).join('');
}
function staffEditControls(item) {
  if (item.editAuthorized) return `<div class="notice"><b>Corrección autorizada.</b><label>Asunto</label><input id="edit-title-${shareEscape(item.id)}" value="${shareEscape(item.title)}"><label>Comentario</label><textarea id="edit-note-${shareEscape(item.id)}">${shareEscape(item.note || '')}</textarea><label>Nuevo archivo (opcional, reemplaza el anterior)</label><input id="edit-file-${shareEscape(item.id)}" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt,.csv"><div class="mini">Hasta 20 archivos por envío, 15 MB cada uno y 100 MB en total.</div><div class="actions"><button class="primary" data-action="save-edit" data-id="${shareEscape(item.id)}">Guardar corrección y reenviar</button></div></div>`;
  if (item.editRequestStatus === 'pending') return '<p class="muted">Solicitud de corrección pendiente de autorización del administrador.</p>';
  return `${item.editRequestStatus === 'denied' ? '<p class="muted">La solicitud de corrección fue rechazada.</p>' : ''}<button data-action="request-edit" data-id="${shareEscape(item.id)}">Solicitar autorización para corregir</button>`;
}

function submissionMonthKey(item) {
  const dateText = item.kind === 'valuation'
    ? item.valuationPeriod || item.documentDate || item.created
    : item.documentDate || item.conformityDate || item.valuationPeriod || item.created;
  const date = new Date(dateText ? `${String(dateText).slice(0, 10)}T12:00:00` : '');
  return Number.isNaN(date.getTime()) ? 'sin-fecha' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function submissionMonthLabel(key) {
  if (key === 'sin-fecha') return 'Sin fecha';
  const date = new Date(`${key}-01T12:00:00`);
  return date.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
}
function valuationPeriodAmount(item) {
  const match = String(item.note || '').match(/Monto valorizado del periodo \(S\/\):\s*([^\n]+)/i);
  if (!match) return null;
  let amount = match[1].replace(/[^\d,.-]/g, '');
  if (amount.includes(',') && amount.includes('.')) {
    amount = amount.lastIndexOf(',') > amount.lastIndexOf('.') ? amount.replace(/\./g, '').replace(',', '.') : amount.replace(/,/g, '');
  } else if (amount.includes(',')) amount = amount.replace(',', '.');
  const value = Number(amount);
  return Number.isFinite(value) ? value : null;
}
function formatSoles(value) {
  return `S/ ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function monthlySubmissionArchive(items, adminMode) {
  const buckets = new Map();
  items.forEach(item => {
    const key = submissionMonthKey(item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });
  const months = [...buckets.entries()].sort(([a], [b]) => b.localeCompare(a));
  const valuations = items.filter(item => item.kind === 'valuation');
  const knownAmounts = valuations.map(valuationPeriodAmount).filter(value => value !== null);
  const totalAmount = knownAmounts.reduce((sum, value) => sum + value, 0);
  const byMonth = months.map(([key, monthItems]) => {
    const monthValuations = monthItems.filter(item => item.kind === 'valuation');
    const monthAmounts = monthValuations.map(valuationPeriodAmount).filter(value => value !== null);
    const reports = monthItems.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity').length;
    const conformities = monthItems.filter(item => item.kind === 'conformity').length;
    const approved = monthItems.filter(item => item.status === 'Aprobada').length;
    const pending = monthItems.filter(item => item.status === 'Pendiente').length;
    const observed = monthItems.filter(item => item.status === 'Observada').length;
    const amountText = monthAmounts.length ? formatSoles(monthAmounts.reduce((sum, value) => sum + value, 0)) : 'Monto no registrado';
    return `<section class="report-section monthly-delivery-month"><div class="monthly-delivery-heading"><h3>${shareEscape(submissionMonthLabel(key))} (${monthItems.length})</h3><span class="badge">${monthValuations.length} valorización(es)</span></div><div class="monthly-delivery-summary"><span>${reports} informe(s)</span><span>${monthValuations.length} valorización(es)</span><span>${conformities} conformidad(es)</span><span>${approved} aprobada(s) · ${pending} pendiente(s) · ${observed} observada(s)</span><b>${amountText}</b><button type="button" class="month-download" data-action="download-month" data-month="${shareEscape(key)}">Descargar este mes (.zip)</button></div>${sharedSubmissionCards(monthItems, adminMode)}</section>`;
  }).join('');
  return `<div class="monthly-delivery-overview"><h2>Resumen total por meses</h2><div class="grid"><div><div class="label">Entregas registradas</div><div class="metric">${items.length}</div></div><div><div class="label">Valorizaciones</div><div class="metric">${valuations.length}</div></div><div><div class="label">Revisión pendiente</div><div class="metric">${items.filter(item => item.status === 'Pendiente').length}</div></div><div><div class="label">Montos valorizados del periodo</div><div class="metric monthly-delivery-total">${knownAmounts.length ? shareEscape(formatSoles(totalAmount)) : 'Sin datos'}</div><div class="mini">Suma solo los montos mensuales registrados; no suma acumulados.</div></div></div></div>${months.length ? byMonth : '<div class="empty">Todavía no hay entregas cargadas.</div>'}`;
}
function adminSubmissionGroups(items) {
  const valuations = items.filter(item => item.kind === 'valuation');
  const reports = items.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity');
  const conformities = items.filter(item => item.kind === 'conformity');
  return `<div><h2>Entregas realizadas por el personal (${items.length})</h2><p class="muted">La información y los archivos se ordenan por el mes del documento; las valorizaciones usan el periodo valorizado. El estado de revisión se mantiene en cada entrega.</p>${monthlySubmissionArchive(items, true)}<section class="report-section"><h3>Totales por tipo</h3><div class="grid"><div><div class="label">Informes</div><div class="metric">${reports.length}</div></div><div><div class="label">Valorizaciones</div><div class="metric">${valuations.length}</div></div><div><div class="label">Conformidades</div><div class="metric">${conformities.length}</div></div></div></section></div>`;
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
    const files = item.files || [];
    const body = `<div class="mini">Período: ${fmt(item.valuationPeriod)} · Fecha límite: ${fmt(item.valuationDue)}${overdue ? ' · PLAZO VENCIDO' : ''}</div><div class="mini">Enviada por: ${shareEscape(item.submitterName || item.email)} · ${shareEscape(item.email)}</div><div class="statline"><span>Avance programado acumulado</span><b>${Number(item.plannedProgress).toFixed(2)}%</b></div><div class="statline"><span>Avance ejecutado acumulado</span><b>${Number(item.actualProgress).toFixed(2)}%</b></div>${item.note ? `<p><b>Contraste registrado:</b> ${shareNoteMarkup(item.note)}</p>` : ''}${currentUser?.role === 'admin' && item.review ? `<p><b>Observaciones:</b> ${shareEscape(item.review)}</p>` : ''}<div class="submission-files">${files.map(file => `<div class="submission-file-row"><span>${shareEscape(file.name)}</span><button type="button" data-action="download" data-id="${shareEscape(file.id)}" data-name="${shareEscape(file.name)}">Descargar</button></div>`).join('')}</div>`;
    return compactSubmissionCard(`valuation-${item.id}`, item.valuationNumber || item.title, item.status, body);
  }).join('');
  const width = 720, height = 300, left = 54, right = 18, top = 20, bottom = 52;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = index => left + (valuations.length === 1 ? 0.5 : index / (valuations.length - 1)) * plotWidth;
  const y = value => top + (100 - Math.max(0, Math.min(100, Number(value) || 0))) / 100 * plotHeight;
  const makePath = key => valuations.map((item, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(item[key]).toFixed(1)}`).join(' ');
  const grid = [0, 25, 50, 75, 100].map(value => `<g><line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#d8dee7"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end" fill="#667389" font-size="11">${value}%</text></g>`).join('');
  const dots = key => valuations.map((item, index) => `<circle cx="${x(index)}" cy="${y(item[key])}" r="4" fill="${key === 'plannedProgress' ? '#2780F5' : '#1e9e6a'}"><title>${shareEscape(item.valuationNumber || item.title)}: ${Number(item[key]).toFixed(2)}%</title></circle>`).join('');
  const labels = valuations.map((item, index) => `<text x="${x(index)}" y="${height - 28}" text-anchor="middle" fill="#667389" font-size="10">${shareEscape(fmt(item.valuationPeriod))}</text>`).join('');
  chart.innerHTML = `<svg role="img" aria-label="Curva S: avance programado y ejecutado" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto"><text x="${left}" y="14" fill="#1b2638" font-size="12" font-weight="600">Avance acumulado (%)</text>${grid}<path d="${makePath('plannedProgress')}" fill="none" stroke="#2780F5" stroke-width="3"/>${dots('plannedProgress')}<path d="${makePath('actualProgress')}" fill="none" stroke="#1e9e6a" stroke-width="3"/>${dots('actualProgress')}${labels}<g transform="translate(${left},${height - 7})"><line x1="0" y1="0" x2="20" y2="0" stroke="#2780F5" stroke-width="3"/><text x="26" y="4" fill="#1b2638" font-size="11">Programado</text><line x1="126" y1="0" x2="146" y2="0" stroke="#1e9e6a" stroke-width="3"/><text x="152" y="4" fill="#1b2638" font-size="11">Ejecutado</text></g></svg>`;
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
    [['Órdenes y conformidades', conformities.length], ['Aprobadas', approved], ['Observadas', observed], ['Pendientes', pending], ['Fuera de plazo', overdue], ['Revisadas', progress + '%']]
      .map(([label, value]) => '<div><div class="label">' + label + '</div><div class="metric">' + value + '</div></div>').join('') +
    '</div><div class="item"><b>Por tipo:</b> ' + categories.join(' · ') +
    '<div class="mini">Avance de revision: ' + reviewed + ' de ' + conformities.length + ' conformidad(es) revisadas (' + progress + '%).</div></div>' +
    conformityCards(conformities, 'informe-conformidad');
}

function conformityCards(conformities, prefix = 'control-conformidad', includePrivateReview = currentUser?.role === 'admin') {
  return conformities.map(item => {
    const overdue = item.status === 'Pendiente' && item.conformityDue && item.conformityDue < today();
    const files = item.files || [];
    const body = `<div class="mini">Fecha: ${fmt(item.conformityDate)} · Plazo: ${fmt(item.conformityDue)}${overdue ? ' · PLAZO VENCIDO' : ''}</div><div class="mini">Enviada por: ${shareEscape(item.submitterName || item.email)} · ${shareEscape(item.email)} · Responsable: ${shareEscape(item.responsibleName || item.responsibleEmail || item.email)}</div>${item.note ? `<p>${shareNoteMarkup(item.note)}</p>` : ''}${currentUser?.role === 'admin' && item.review ? `<p><b>Observaciones:</b> ${shareEscape(item.review)}</p>` : ''}<div class="submission-files">${files.map(file => `<div class="submission-file-row"><span>${shareEscape(file.name)}</span><button type="button" data-action="download" data-id="${shareEscape(file.id)}" data-name="${shareEscape(file.name)}">Descargar</button></div>`).join('')}</div>`;
    return compactSubmissionCard(`${prefix}-${item.id}`, `${item.conformityCategory} · ${item.title}`, item.status, body);
  }).join('');
}

function renderControlConformities(items = sharedReportItems) {
  const root = document.getElementById('controlConformities');
  if (!root) return;
  const conformities = items.filter(item => item.kind === 'conformity').sort((a, b) => String(b.created).localeCompare(String(a.created)));
  root.innerHTML = '<h3 style="margin:16px 0 6px">Órdenes y conformidades enviadas (' + conformities.length + ')</h3>' +
    (conformities.length ? conformityCards(conformities) : '<div class="empty">Todavia no se han enviado conformidades.</div>');
}

function renderApprovedDashboard() {
  const root = document.getElementById('approvedDashboard');
  if (!root) return;
  const all = Array.isArray(sharedReportItems) ? sharedReportItems : [];
  const approved = all.filter(item => item.status === 'Aprobada');
  const pending = all.filter(item => item.status === 'Pendiente');
  const observed = all.filter(item => item.status === 'Observada');
  const valuations = all.filter(item => item.kind === 'valuation')
    .sort((a, b) => String(a.valuationPeriod || a.documentDate || a.created || '').localeCompare(String(b.valuationPeriod || b.documentDate || b.created || '')));
  const latestValuation = valuations[valuations.length - 1];
  const planned = Number(latestValuation?.plannedProgress);
  const executed = Number(latestValuation?.actualProgress);
  const hasProgress = latestValuation && latestValuation.plannedProgress !== '' && latestValuation.actualProgress !== '' && Number.isFinite(planned) && Number.isFinite(executed);
  const relativeGap = hasProgress && planned > 0 ? ((planned - executed) / planned) * 100 : null;
  const financialMatch = String(latestValuation?.note || '').match(/Avance financiero acumulado \(%\):\s*([^\n]+)/i);
  const financialProgress = financialMatch ? financialMatch[1].trim() : '';
  const overdue = [...pending, ...observed].filter(item => {
    const due = item.valuationDue || item.conformityDue;
    return due && due < today();
  });
  const directExecution = project.executionType === 'Administración directa';
  const reviewedRate = all.length ? Math.round(approved.length / all.length * 100) : 0;
  const dateOf = item => item.reviewedAt || item.updatedAt || item.created || item.documentDate || item.valuationPeriod || item.conformityDate || '';
  const displayDate = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('es-PE');
  };
  const recent = [...all].sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a)))).slice(0, 6);
  const metrics = [
    ['Avance programado', hasProgress ? `${planned.toFixed(2)}%` : 'Sin dato'],
    ['Avance ejecutado', hasProgress ? `${executed.toFixed(2)}%` : 'Sin dato'],
    ['Avance financiero acumulado', financialProgress ? `${financialProgress}%` : 'Sin dato'],
    ['Pendientes u observadas', pending.length + observed.length]
  ];
  const evidenceText = item => [item.title, item.note, ...(item.files || []).map(file => file.name)].join(' ');
  const indicators = [
    ['Informe mensual y valorización', /informe|valorizaci[oó]n|valorizacion/i],
    ['Cuaderno de obra y ocurrencias', /cuaderno de obra|asiento|ocurrencia/i],
    ['Balance financiero', /balance financiero|presupuesto anal[ií]tico|gasto acumulado|avance financiero/i],
    ['Calidad y pruebas', /calidad|ensayo|protocolo|laboratorio/i],
    ['Cumplimiento del expediente y recomendaciones', /expediente tecnico|recomendacion|observacion/i],
    ['Ocurrencias, soluciones y acciones', /ocurrencia|problema|solucion|accion adoptada/i],
    ['Seguridad y ambiente', /seguridad|ambiental|ssoma|incidente/i]
  ].map(([label, pattern]) => {
    const count = all.filter(item => pattern.test(evidenceText(item))).length;
    return `<div class="directive-check-row"><b>${label}</b><span class="${count ? 'directive-found' : 'directive-check'}">${count ? `Referencia en ${count} entrega(s); revisar el sustento` : 'Sin referencia identificada'}</span></div>`;
  }).join('');
  const gapLabel = relativeGap === null ? 'Sin datos para comparar el avance' : relativeGap > 20 ? `Alerta: atraso relativo de ${relativeGap.toFixed(1)}% frente al programa` : relativeGap > 0 ? `Atraso relativo de ${relativeGap.toFixed(1)}% frente al programa` : 'Sin atraso frente al programa';
  const progressMarkup = hasProgress
    ? `<div class="mini">Programado: ${planned.toFixed(2)}% · Ejecutado: ${executed.toFixed(2)}%</div><div class="approved-progress"><span style="width:${Math.max(0, Math.min(100, executed))}%"></span></div><div class="mini">${shareEscape(gapLabel)}</div>`
    : '<div class="empty">Registra una valorización para mostrar el avance programado y ejecutado.</div>';
  const chartPoints = valuations.filter(item => item.plannedProgress !== '' && item.plannedProgress !== null && item.plannedProgress !== undefined && item.actualProgress !== '' && item.actualProgress !== null && item.actualProgress !== undefined && Number.isFinite(Number(item.plannedProgress)) && Number.isFinite(Number(item.actualProgress))).slice(-6).map((item, index, series) => {
    const x = series.length === 1 ? 310 : 48 + index * (520 / (series.length - 1));
    const plannedValue = Math.max(0, Math.min(100, Number(item.plannedProgress)));
    const executedValue = Math.max(0, Math.min(100, Number(item.actualProgress)));
    const dateText = item.valuationPeriod || item.documentDate || item.created || '';
    const date = new Date(`${String(dateText).slice(0, 10)}T12:00:00`);
    const label = Number.isNaN(date.getTime()) ? `N.º ${index + 1}` : date.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' });
    return { x, plannedY: 165 - plannedValue * 1.3, executedY: 165 - executedValue * 1.3, plannedValue, executedValue, label, status: item.status || 'Sin estado' };
  });
  const pointsFor = key => chartPoints.map(point => `${point.x},${point[key]}`).join(' ');
  const trendMarkup = chartPoints.length ? `<div class="directive-trend-wrap"><svg class="directive-trend-chart" viewBox="0 0 600 205" role="img" aria-label="Avance programado y ejecutado en las últimas valorizaciones"><line class="directive-trend-grid" x1="42" y1="35" x2="580" y2="35"/><line class="directive-trend-grid" x1="42" y1="100" x2="580" y2="100"/><line class="directive-trend-grid" x1="42" y1="165" x2="580" y2="165"/><text class="directive-trend-axis" x="4" y="39">100%</text><text class="directive-trend-axis" x="15" y="104">50%</text><text class="directive-trend-axis" x="27" y="169">0%</text><polyline class="directive-trend-line planned" points="${pointsFor('plannedY')}"/><polyline class="directive-trend-line executed" points="${pointsFor('executedY')}"/>${chartPoints.map(point => `<g><circle class="directive-trend-point planned" cx="${point.x}" cy="${point.plannedY}" r="5"><title>${shareEscape(point.label)} · Programado ${point.plannedValue.toFixed(2)}% · ${shareEscape(point.status)}</title></circle><circle class="directive-trend-point executed" cx="${point.x}" cy="${point.executedY}" r="5"><title>${shareEscape(point.label)} · Ejecutado ${point.executedValue.toFixed(2)}% · ${shareEscape(point.status)}</title></circle><text class="directive-trend-date" x="${point.x}" y="192">${shareEscape(point.label)}</text></g>`).join('')}</svg><div class="directive-trend-legend"><span><i class="planned"></i>Programado</span><span><i class="executed"></i>Ejecutado</span></div></div>` : '<div class="empty">La gráfica aparecerá cuando registres valorizaciones con avance.</div>';
  const valuationBarsMarkup = chartPoints.length ? `<div class="directive-bar-chart" role="img" aria-label="Comparación en barras entre avance programado y ejecutado">${chartPoints.map(point => `<div class="directive-bar-column"><div class="directive-bar-pair"><span class="planned" style="height:${point.plannedValue}%" title="${shareEscape(point.label)} · Programado ${point.plannedValue.toFixed(2)}%"></span><span class="executed" style="height:${point.executedValue}%" title="${shareEscape(point.label)} · Ejecutado ${point.executedValue.toFixed(2)}%"></span></div><small>${shareEscape(point.label)}</small></div>`).join('')}</div><div class="directive-trend-legend"><span><i class="planned"></i>Programado</span><span><i class="executed"></i>Ejecutado</span></div>` : '<div class="empty">Las barras aparecerán al registrar valorizaciones.</div>';
  const statusRows = [['Aprobadas', approved.length, 'approved'], ['Pendientes', pending.length, 'pending'], ['Observadas', observed.length, 'observed']];
  const statusBarsMarkup = statusRows.map(([label, count, color]) => `<div class="directive-status-row"><span>${label}</span><div class="directive-status-track"><i class="${color}" style="width:${all.length ? count / all.length * 100 : 0}%"></i></div><b>${count}</b></div>`).join('');
  const alertBadge = overdue.length ? `${overdue.length} entrega(s) vencida(s)` : relativeGap !== null && relativeGap > 20 ? 'Revisar atraso' : `${approved.length} aprobada(s)`;
  const alertClass = overdue.length || (relativeGap !== null && relativeGap > 20) ? 'observed' : 'approved';
  root.innerHTML = `<div class="approved-dashboard-header"><div><div class="approved-dashboard-kicker">${directExecution ? 'Directiva 017-2023 · Administración directa' : 'Centro de control · seguimiento de obra'}</div><h3>Seguimiento de obra</h3><div class="muted">${directExecution ? 'Avance, valorizaciones y controles de administración directa.' : 'Avance y entregas registradas del proyecto.'}</div></div><div class="actions">${currentUser?.role === 'admin' ? '<button type="button" data-action="download-approved-dashboard">Descargar resumen (CSV)</button>' : ''}<span class="badge ${alertClass}">${shareEscape(alertBadge)}</span></div></div><div class="approved-dashboard-grid">${metrics.map(([label, value]) => `<div class="approved-dashboard-metric"><div class="metric">${shareEscape(value)}</div><div class="label">${shareEscape(label)}</div></div>`).join('')}</div><div class="approved-dashboard-columns"><div class="approved-panel"><h4>Avance físico · valorización más reciente</h4>${progressMarkup}${latestValuation ? `<div class="mini">${shareEscape(latestValuation.valuationNumber || latestValuation.title || 'Valorización')} · ${shareEscape(latestValuation.status || 'Sin estado')}</div>` : ''}<h4 class="directive-trend-title">Evolución del avance por valorización</h4>${trendMarkup}<h4 class="directive-trend-title">Comparación por valorización</h4>${valuationBarsMarkup}</div><div class="approved-panel"><h4>Revisión y plazos</h4><div class="approved-rate-wrap"><div class="approved-rate-ring" style="--approved-rate:${reviewedRate}%"><b>${reviewedRate}%</b></div><div class="approved-rate-copy"><b>${approved.length} de ${all.length}</b><br>entregas aprobadas<br>${pending.length} pendientes · ${observed.length} observadas · ${overdue.length} vencidas</div></div><h4 class="directive-trend-title">Estado de las entregas</h4><div class="directive-status-chart">${statusBarsMarkup}</div></div></div><div class="approved-dashboard-lower"><div class="approved-panel"><h4>${directExecution ? 'Puntos de control de la Directiva' : 'Documentos y controles registrados'}</h4><div class="directive-checklist">${indicators}</div><div class="mini">La referencia por nombre o nota orienta la revisión; no confirma cumplimiento.</div></div><div class="approved-panel"><h4>Últimas entregas</h4><div class="approved-recent-list">${recent.length ? recent.map(item => {
    const title = item.title || item.valuationNumber && `Valorización N.º ${item.valuationNumber}` || item.conformityCategory || 'Entrega';
    const date = dateOf(item);
    const statusClass = item.status === 'Aprobada' ? 'approved' : item.status === 'Observada' ? 'observed' : 'pending';
    return `<div class="item"><div class="itemtop"><div><b>${shareEscape(title)}</b><div class="mini">${shareEscape(item.responsibleName || item.submitterName || item.email || 'Sin responsable')}${date ? ` · ${shareEscape(displayDate(date))}` : ''}</div></div><span class="badge ${statusClass}">${shareEscape(item.status || 'Pendiente')}</span></div></div>`;
  }).join('') : '<div class="empty">Todavía no hay entregas registradas en Control.</div>'}</div></div></div>`;
}
function renderSharedReportSummary() {
  renderApprovedDashboard();
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
  if (reportRoot) reportRoot.innerHTML = items.length ? items.map(item => {
    const files = item.files || [];
    const title = `${item.number ? `N.º ${item.number} · ` : ''}${item.title}`;
    const body = `<div class="mini">Enviado por: ${shareEscape(item.submitterName || item.email)} · ${shareEscape(item.email)}</div><div class="mini">Responsable: ${shareEscape(item.responsibleName || item.responsibleEmail || item.email)}${item.documentDate ? ' · ' + fmt(item.documentDate) : ''}</div>${item.note ? `<p>${shareNoteMarkup(item.note)}</p>` : ''}${currentUser?.role === 'admin' && item.review ? `<p><b>Observaciones:</b> ${shareEscape(item.review)}</p>` : ''}<div class="submission-files">${files.map(file => `<div class="submission-file-row"><span>${shareEscape(file.name)}</span><button type="button" data-action="download" data-id="${shareEscape(file.id)}" data-name="${shareEscape(file.name)}">Descargar</button></div>`).join('')}</div>`;
    return compactSubmissionCard(`informe-${item.id}`, title, item.status, body);
  }).join('') : '<div class="empty">No hay informes recibidos para este proyecto.</div>';
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
  addAdminFileRemovalButtons();
}

async function shareApi(path, options = {}) {
  if (window.CENTRO_OFFLINE_MODE) return window.CentroOfflineApi(path, options);
  const headers = { ...(options.headers || {}) };
  const token = sessionStorage.getItem(SHARE_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const isEntryRequest = path === '/api/login' || path === '/api/activate';
  const controller = isEntryRequest && !options.signal ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 30000) : null;
  let response;
  try {
    response = await fetch(path, { ...options, headers, ...(controller ? { signal: controller.signal } : {}) });
  } catch (error) {
    if (controller && error.name === 'AbortError') {
      throw new Error('El servidor no respondió en 30 segundos. Comprueba tu conexión y vuelve a intentarlo.');
    }
    if (isEntryRequest && error instanceof TypeError) {
      throw new Error('No se pudo conectar con el servidor. Comprueba tu internet e inténtalo otra vez.');
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
  project = { ...saved, name: saved.name || '', entity: saved.entity || '', executionType: saved.executionType || '', location: saved.location || '', code: saved.code || '', cutoff: saved.cutoff || today(), desc: saved.description || '' };
  refreshReportTemplateLibrary();
  const projectFields = { projectName: project.name, entity: project.entity, projectType: project.executionType, projectCode: project.code, cutoff: project.cutoff, projectDesc: project.desc };
  Object.entries(projectFields).forEach(([id, value]) => { const input = document.getElementById(id); if (input && document.activeElement !== input) input.value = value; });
  TECHNICAL_PROJECT_FIELDS.forEach(id => { const input = document.getElementById(id); if (input && document.activeElement !== input) input.value = saved[id] || ''; });
  updateTechnicalProjectFields();
  if (ubigeoCatalog && saved.departmentCode) {
    const department = document.getElementById('projectDepartment');
    if (department && document.activeElement !== department) { department.value = saved.departmentCode; populateProjectProvinces(saved.provinceCode); populateProjectDistricts(saved.districtCode); }
    updateProjectMap();
  } else if (ubigeoCatalog) {
    const department = document.getElementById('projectDepartment');
    if (department) { department.value = ''; populateProjectProvinces(); populateProjectDistricts(); }
    updateProjectMap();
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
  const technicalPanel = document.getElementById('technicalReportSummary');
  if (technicalPanel) technicalPanel.outerHTML = technicalSummaryMarkup(technicalSummaryItems, currentUser?.role === 'admin');
  liveAuditLog = snapshot.auditLog || [];
  reports = sharedReportItems.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity').map(item => ({ id: item.id, title: item.title, number: item.number, date: item.documentDate, responsible: item.responsibleName || item.responsibleEmail, file: (item.files || []).map(file => file.name).join(', '), note: item.note, status: item.status === 'Aprobada' ? 'Aprobado' : item.status === 'Observada' ? 'Con observaciones' : 'Pendiente de revision', reviewNote: item.review, reviewDate: item.reviewed }));
  renderWorkers();
  addWorkerRemovalButtons();
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
      const summaryPath = currentUser?.role === 'admin' ? '/api/submissions' : '/api/technical-summary';
      const [people, summaryItems] = await Promise.all([
        shareApi('/api/people').catch(() => window.projectTeamAccounts || []),
        shareApi(summaryPath).catch(() => technicalSummaryItems)
      ]);
      window.projectTeamAccounts = people;
      technicalSummaryItems = summaryItems;
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
  ['projectName','entity','projectType','projectCode','cutoff','projectDesc','projectDepartment','projectProvince','projectDistrict'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
    clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(() => saveSharedProject(true), 350);
  }));
  TECHNICAL_PROJECT_FIELDS.forEach(id => document.getElementById(id)?.addEventListener('change', () => {
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
    report: ['reportTitle','reportNumber','reportDate','reportResponsible','reportNote',...REPORT_DETAIL_FIELDS],
    valuation: ['valuationNumber','valuationPeriod','valuationDue','valuationPlanned','valuationActual','valuationFilePlanned','valuationFileActual','valuationNote','reportResponsible',...VALUATION_DETAIL_FIELDS],
    conformity: ['conformityCategory','conformityTitle','conformityProvider','conformityAmount','conformityDate','conformityDue','conformityNote']
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
  const ids = ['reportTitle','reportNumber','reportDate','reportResponsible','reportNote',...REPORT_DETAIL_FIELDS,'valuationNumber','valuationPeriod','valuationDue','valuationPlanned','valuationActual','valuationFilePlanned','valuationFileActual','valuationNote',...VALUATION_DETAIL_FIELDS,'conformityCategory','conformityTitle','conformityProvider','conformityAmount','conformityDate','conformityDue','conformityNote'];
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
    shareRoot.innerHTML = `<div class="entry-access"><div class="card entry-option"><h3>Preparar acceso de administración</h3><p class="mu entry-help">Crea tu contraseña de administración. Debe tener al menos 10 caracteres.</p><div class="entry-fields"><div class="entry-field"><label for="adminEmail">Correo administrador</label><input id="adminEmail" type="email" value="brandonlasteros31@gmail.com" readonly></div><div class="entry-field"><label for="adminPassword">Contraseña</label><input id="adminPassword" type="password" autocomplete="new-password"></div><div class="entry-field"><label for="adminConfirm">Repite la contraseña</label><input id="adminConfirm" type="password" autocomplete="new-password"></div></div><div class="rw"><button class="pr" data-action="setup">Crear acceso de administración</button></div><p id="shareMessage"></p></div></div>`;
    return;
  }
  shareRoot.innerHTML = `<div class="entry-access"><div class="card entry-option"><h3>Iniciar sesión</h3><p class="mu entry-help">Ingresa con el correo autorizado por la administración.</p><div class="entry-fields"><div class="entry-field"><label for="loginEmail">Correo autorizado</label><input id="loginEmail" type="email" autocomplete="username"></div><div class="entry-field"><label for="loginPassword">Contraseña</label><input id="loginPassword" type="password" autocomplete="current-password"></div></div><div class="rw"><button class="pr" data-action="login">Iniciar sesión</button></div></div><div class="card entry-option"><h3>Activar cuenta</h3><p class="mu entry-help">Primero pide una invitación a la persona administradora.</p><div class="entry-fields"><div class="entry-field"><label for="activateName">Nombre completo</label><input id="activateName" autocomplete="name"></div><div class="entry-field"><label for="activateEmail">Correo autorizado</label><input id="activateEmail" type="email" autocomplete="email"></div><div class="entry-field"><label for="inviteCode">Código de invitación</label><input id="inviteCode" autocomplete="one-time-code"></div><div class="entry-field"><label for="activatePassword">Crea una contraseña</label><input id="activatePassword" type="password" autocomplete="new-password"></div><div class="entry-field"><label for="activateConfirm">Repite la contraseña</label><input id="activateConfirm" type="password" autocomplete="new-password"></div></div><div class="rw"><button class="pr" data-action="activate">Activar cuenta</button></div></div><div class="card entry-access-message"><p id="shareMessage" class="mu">Solo las personas invitadas pueden crear una cuenta.</p></div></div>`;
}

async function renderShare() {
  shareRoot.innerHTML = '<div class="card">Cargando entregas...</div>';
  try {
    const status = await shareApi('/api/status');
    let me = null;
    try { me = await shareApi('/api/me'); } catch {}
    if (!me) {
      setTopLogoutVisible(false);
      renderAccess(status.setup);
      await renderControlInbox(null);
      return;
    }
    setTopLogoutVisible(true);
    if (me.role === 'admin') await renderAdmin(me);
    else await renderStaff(me);
    await renderControlInbox(me);
    bindPendingFileRemoval();
  } catch {
    shareRoot.innerHTML = '<div class="card"><b>No se pudo abrir la sección de entregas.</b><p class="mu">Abre la aplicación con el botón “Iniciar centro de control”.</p></div>';
  }
}

async function refreshAfterSectionClear() {
  const [snapshot, summaryItems] = await Promise.all([shareApi('/api/live'), shareApi('/api/technical-summary')]);
  technicalSummaryItems = summaryItems;
  sharedReportItems = snapshot.submissions || [];
  liveRevision = Number(snapshot.revision) || 0;
  renderLiveSnapshot(snapshot);
  await renderShare();
}

function technicalSubmissionType(item) {
  if (item.kind === 'valuation') return 'Valorización';
  if (item.kind === 'conformity') return `Conformidad${item.conformityCategory ? ` de ${item.conformityCategory.toLowerCase()}` : ''}`;
  return 'Informe';
}

function technicalDate(value, withTime = false) {
  if (!value) return 'Sin fecha';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return shareEscape(value);
  return date.toLocaleDateString('es-PE', withTime
    ? { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'long', year: 'numeric' });
}

function technicalPeriodKey(item, monthly = false) {
  const value = monthly
    ? item.valuationPeriod || item.documentDate || item.conformityDate || item.created
    : item.created || item.documentDate || item.valuationPeriod || item.conformityDate;
  const date = value
    ? (/^\d{4}-\d{2}$/.test(String(value)) ? new Date(`${value}-01T12:00:00`) : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : new Date(value))
    : new Date();
  if (Number.isNaN(date.getTime())) return 'sin-fecha';
  if (monthly) return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function technicalDirectiveOutline(items) {
  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const checks = [
    ['Planilla de metrados por partida', /metrado|planilla.*partida/],
    ['Valorización mensual de obra', /valorizacion|valuation/],
    ['Cronograma programado frente a ejecutado', /cronograma|programado.*ejecutado|ejecutado.*programado/],
    ['Planilla de personal comprometido', /personal|planilla.*trabajador/],
    ['Manifiesto de gastos', /manifiesto.*gasto|gastos/],
    ['Gastos mensualizados por específica', /especifica.*gasto|gasto.*especifica/],
    ['Movimiento diario de almacén', /movimiento diario.*almacen|kardex/],
    ['Resumen de almacén: ingresos, egresos y saldos', /almacen|ingresos.*egresos|egresos.*ingresos/],
    ['Saldo valorizado de materiales', /saldo.*valorizado.*material|material.*saldo/],
    ['Reprogramación física y financiera', /reprogramacion|reprogramado/],
    ['Cronograma de barras Gantt', /gantt|barras/],
    ['Control de equipo mecánico', /equipo mecanico|maquinaria|control de equipo/],
    ['Controles y protocolos de calidad', /calidad|ensayo|protocolo/],
    ['Ocurrencias, seguridad y medidas ambientales', /ocurrencia|incidente|seguridad|ssoma|ambiental|medio ambiente/],
    ['Paralización, atraso y acciones correctivas', /paralizacion|suspension|atraso|desfase|acciones correctivas/],
    ['Panel fotográfico y videos', /fotograf|panel.*foto|video/],
    ['Copias del cuaderno de obra', /cuaderno de obra|asiento de obra/]
  ];
  const rows = checks.map(([label, pattern]) => {
    const matches = items.filter(item => {
      const text = normalize([item.title, item.note, item.conformityCategory, ...(item.files || []).map(file => file.name)].join(' '));
      return (label.startsWith('Valorización') && item.kind === 'valuation') || pattern.test(text);
    });
    const evidence = matches.flatMap(item => (item.files || []).map(file => shareEscape(file.name)));
    return `<div class="directive-check-row"><b>${shareEscape(label)}</b><span class="${matches.length ? 'directive-found' : 'directive-check'}">${matches.length ? `${matches.length} entrega(s) relacionada(s)` : 'Revisar / no identificada por nombre'}</span>${evidence.length ? `<small>${evidence.join(' · ')}</small>` : ''}</div>`;
  }).join('');
  const projectType = shareEscape(project.executionType || 'Administración directa');
  const projectName = shareEscape(project.name || 'No registrado');
  const entity = shareEscape(project.entity || 'No registrada');
  const location = shareEscape(project.location || 'No registrada');
  const code = shareEscape(project.code || 'No registrado');
  const cutoff = shareEscape(project.cutoff || 'No registrada');
  const directProjectData = [['Oficina OAD', project.techOffice], ['Secuencia funcional', project.techFunctionalSequence], ['Ano presupuestal', project.techFiscalYear], ['Fuente de financiamiento', project.techFundingSource], ['Presupuesto aprobado (S/)', project.techApprovedBudget], ['Presupuesto analitico (S/)', project.techAnalyticalBudget], ['Presupuesto ejecutado (S/)', project.techExecutedBudget], ['Metas concluidas', project.techCompletedGoals], ['Aprobacion del expediente tecnico', project.techExpedientApproval], ['Entrega del terreno', project.techLandDelivery], ['Inicio de obra', project.techWorkStart], ['Fin vigente de obra', project.techWorkEnd], ['Viabilidad', project.techViability], ['INFOBRAS', project.techInfobras], ['Informes tecnico, legal y presupuestal de aprobacion', project.techDirectApprovalReports], ['Personal clave designado', project.techDirectKeyStaff], ['Revision del expediente tecnico', project.techDirectExpedientReview], ['Plan de abastecimiento y calendario', project.techDirectSupplyPlan], ['Avance, gastos y metas del periodo', project.techDirectPeriodProgress], ['Calidad, seguridad, ambiente y ocurrencias', project.techDirectQualitySafety], ['Modificaciones de obra y plazo', project.techDirectChanges], ['Culminacion, liquidacion y transferencia', project.techDirectCloseout]];
  const directProjectMarkup = directProjectData.filter(([, value]) => value).map(([label, value]) => `<span>${shareEscape(label)}: ${shareEscape(value)}</span>`).join('');
  return `<details class="directive-outline" open><summary>Informe mensual del residente · Directiva N.° 017-2023-CG/GMPL, Anexo 2</summary><p>El resumen se ordena según el formato normativo del Anexo 2: resumen ejecutivo; A) generalidades; B) sustento documentario; C) ejecución de obra; y D) cuadros. Los datos disponibles se completan desde el proyecto y las entregas; la información no recopilada se señala para completar con el expediente.</p><div class="directive-generalities"><b>A. Generalidades</b><span>Obra: ${projectName}</span><span>Entidad: ${entity}</span><span>Modalidad: ${projectType}</span><span>Ubicación: ${location}</span><span>CUI / referencia: ${code}</span><span>Fecha de corte: ${cutoff}</span><div>${directProjectMarkup || '<small>Completa los datos tecnicos de la obra en Control.</small>'}</div></div><div class="directive-monthly-note"><b>B. Sustento documentario · C. Ejecución de obra</b><p>Adjuntar o registrar aprobación del expediente técnico, actas de entrega e inicio, viabilidad, CUI e INFOBRAS; describir la ejecución del periodo, incluir registro fotográfico/video y conclusiones y recomendaciones, según corresponda.</p><p>Para el numeral 7.3.4, el informe mensual del residente resume avance físico y financiero y ocurrencias; se presenta dentro de los diez días calendario posteriores al cierre del mes. El inspector/supervisor revisa y emite su informe dentro de cinco días calendario de recibido. Los porcentajes programado y ejecutado se muestran si se registró una valorización; metrados, balance financiero, calidad, seguridad, ambiente y atrasos requieren sustento documental.</p></div><h4>D. Cuadros del Anexo 2 y sustento complementario</h4><div class="directive-checklist">${rows}</div><p><a href="https://www.gob.pe/institucion/contraloria/normas-legales/4984570-017-2023-cg-gmpl" target="_blank" rel="noopener noreferrer">Consultar Directiva 017-2023-CG/GMPL y sus anexos en Contraloría</a></p><p class="technical-footnote">La detección se basa en el asunto, nota y nombre de los archivos. “Revisar / no identificada por nombre” no confirma que el documento falte. Esta aplicación organiza información; no reemplaza el informe firmado, los formatos del Anexo 2, el cuaderno de obra, INFOBRAS ni la revisión del residente y del inspector/supervisor.</p></details>`;
}

function technicalContractOutline(items) {
  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const checks = [
    ['Contrato, contratista, monto y plazo contractual', /contrato|contratista|monto contractual|plazo contractual|inicio de obra/],
    ['Valorización de obra y sustento de metrados', /valorizacion|metrado|planilla de metrados/],
    ['Avance físico programado frente a ejecutado', /cronograma|programado.*ejecutado|ejecutado.*programado|avance fisico/],
    ['Calendario, reprogramaciones y plazo', /calendario de avance|reprogramacion|ampliacion de plazo|suspension|reinicio/],
    ['Cuaderno de obra y ocurrencias', /cuaderno de obra|asiento de obra|ocurrencia/],
    ['Adicionales, mayores metrados, deductivos y modificaciones', /adicional|mayor metrado|deductivo|modificacion contractual/],
    ['Supervisión e informes de revisión', /supervisor|inspector|informe de supervision|revision de valorizacion/],
    ['Observaciones y subsanaciones', /observacion|subsanacion|levantamiento/],
    ['Calidad: ensayos, protocolos y pruebas', /calidad|ensayo|protocolo|prueba/],
    ['Seguridad, ambiente e incidencias', /seguridad|ssoma|ambiental|incidente/],
    ['Recepción de obra y observaciones', /recepcion de obra|comite de recepcion|observaciones de recepcion/],
    ['Liquidación y cierre contractual', /liquidacion|cierre contractual|saldo final/]
  ];
  const rows = checks.map(([label, pattern]) => {
    const matches = items.filter(item => {
      const text = normalize([item.title, item.note, item.conformityCategory, ...(item.files || []).map(file => file.name)].join(' '));
      return (label.startsWith('Valorización') && item.kind === 'valuation') || pattern.test(text);
    });
    const evidence = matches.flatMap(item => (item.files || []).map(file => shareEscape(file.name)));
    return `<div class="directive-check-row"><b>${shareEscape(label)}</b><span class="${matches.length ? 'directive-found' : 'directive-check'}">${matches.length ? `${matches.length} entrega(s) relacionada(s)` : 'Revisar / no identificada por nombre'}</span>${evidence.length ? `<small>${evidence.join(' · ')}</small>` : ''}</div>`;
  }).join('');
  const projectName = shareEscape(project.name || 'No registrado');
  const entity = shareEscape(project.entity || 'No registrada');
  const location = shareEscape(project.location || 'No registrada');
  const code = shareEscape(project.code || 'No registrado');
  const cutoff = shareEscape(project.cutoff || 'No registrada');
  const contractProjectData = [['Contrato', project.techContractNumber], ['Procedimiento de selección / SEACE', project.techContractProcedure], ['Fecha de contrato', project.techContractDate], ['Objeto', project.techContractObject], ['Contratista', project.techContractor], ['Monto vigente (S/)', project.techContractAmount], ['Sistema de entrega/contratación', project.techDeliverySystem], ['Plazo (días)', project.techContractTerm], ['Inicio contractual', project.techContractStart], ['Término vigente', project.techContractEnd], ['Expediente técnico', project.techContractExpedient], ['Garantías y seguros', project.techContractGuarantees], ['Supervisor o inspector', project.techContractSupervisor], ['Calendario y avance', project.techContractSchedule], ['Valorizaciones, metrados y pagos', project.techContractValuations], ['Cuaderno de incidencias', project.techContractNotebookLink], ['Ampliaciones, suspensiones y cambios', project.techContractChanges], ['Incumplimientos y penalidades', project.techContractPenaltyStatus], ['Controversias', project.techContractDisputes], ['Recepción', project.techContractReception], ['Liquidación', project.techContractLiquidation], ['Documentos finales', project.techContractFinalDocuments], ['Recepción, liquidación y cierre', project.techContractCloseout]];
  const contractProjectMarkup = contractProjectData.filter(([, value]) => value).map(([label, value]) => `<span>${shareEscape(label)}: ${shareEscape(value)}</span>`).join('');
  return `<details class="directive-outline" open><summary>Informe de seguimiento contractual · Ley N.° 32069 y Reglamento</summary><p>La Ley y el Reglamento aprobado por D. S. N.° 009-2025-EF, con sus modificatorias vigentes, incluida la modificación del D. S. N.° 001-2026-EF, orientan la ejecución del contrato. Esta aplicación presenta un resumen ordenado de seguimiento documental; el contenido exigible debe contrastarse con el contrato, las bases, el sistema de entrega y las directivas aplicables.</p><div class="directive-generalities"><b>1. Identificación y condiciones del contrato</b><span>Obra: ${projectName}</span><span>Entidad: ${entity}</span><span>Ubicación: ${location}</span><span>CUI / referencia: ${code}</span><span>Fecha de corte: ${cutoff}</span><div class="directive-generalities">${contractProjectMarkup}</div></div><div class="directive-monthly-note"><b>2. Ejecución, avance y valorizaciones</b><p>Las entregas se ordenan por periodo valorizado. Incorporar la valorización, metrados y sustento, calendario vigente, avance físico programado y ejecutado, revisión de supervisión y situación de trámite cuando esos datos se hayan registrado.</p><p>El avance porcentual ingresado en la aplicación es reportado por el usuario; por sí solo no acredita metrados, aprobación, pago ni registro en SEACE/Pladicop. La Directiva N.° 018-2025-OECE-CD regula el registro de valorizaciones de obra en SEACE.</p><b>3. Cambios, control y cierre</b><p>Ordenar los documentos relativos a ampliaciones o suspensiones de plazo, reinicios, adicionales, mayores metrados, deductivos, observaciones y subsanaciones, calidad, seguridad, recepción y liquidación, según apliquen al contrato.</p></div><h4>4. Matriz de documentos y verificaciones</h4><div class="directive-checklist">${rows}</div><p>Referencias oficiales: <a href="https://www.gob.pe/institucion/oece/colecciones/45029-ley-n-32069-ley-general-de" target="_blank" rel="noopener noreferrer">Ley 32069 y Reglamento con modificatorias</a> · <a href="https://www.gob.pe/institucion/oece/normas-legales/7472010-083-2025-oece-pre" target="_blank" rel="noopener noreferrer">Directiva N.° 018-2025-OECE-CD sobre valorizaciones</a> · <a href="https://www.gob.pe/institucion/oece/colecciones/66212-directivas-vigentes-ley-n-32069" target="_blank" rel="noopener noreferrer">Directivas vigentes del OECE</a></p><p class="technical-footnote">La detección se basa en asunto, nota y nombre de archivos; “no identificada por nombre” no confirma que el documento falte. Esta aplicación organiza la información aportada, no certifica cumplimiento ni reemplaza formatos, registros oficiales, contrato o revisión profesional.</p></details>`;
}

function technicalSummaryMarkup(items, isAdmin) {
  const directExecution = project.executionType === 'Administración directa';
  const contractExecution = project.executionType === 'Obra por contrata';
  const ordered = [...items].sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));
  const approved = ordered.filter(item => item.status === 'Aprobada').length;
  const pending = ordered.filter(item => item.status === 'Pendiente').length;
  const observed = ordered.filter(item => item.status === 'Observada').length;
  const reportCount = ordered.filter(item => !['valuation', 'conformity'].includes(item.kind)).length;
  const valuationCount = ordered.filter(item => item.kind === 'valuation').length;
  const conformityCount = ordered.filter(item => item.kind === 'conformity').length;
  const valuations = ordered.filter(item => item.kind === 'valuation');
  const latestValuation = valuations[valuations.length - 1];
  const groups = new Map();
  ordered.forEach(item => {
    const key = technicalPeriodKey(item, directExecution || contractExecution);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const weeks = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const firstDate = ordered[0] && (ordered[0].created || ordered[0].documentDate);
  const lastDate = ordered.length && (ordered[ordered.length - 1].created || ordered[ordered.length - 1].documentDate);
  const projectName = document.getElementById('projectName')?.value || project.name || 'Proyecto de obra';
  const projectEntity = document.getElementById('entity')?.value || project.entity || '';
  const projectCode = document.getElementById('projectCode')?.value || project.code || '';
  const periodMarkup = weeks.length ? weeks.map(([week, weekItems]) => {
    if (directExecution || contractExecution) {
      const monthDate = week === 'sin-fecha' ? null : new Date(`${week}-01T12:00:00`);
      const monthLabel = monthDate ? monthDate.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }) : 'Mes sin fecha de documento';
      const periodLabel = contractExecution ? 'Periodo valorizado' : 'Periodo mensual';
      return `<section class="technical-week"><h4>${periodLabel} · ${shareEscape(monthLabel)} <span>${weekItems.length} entrega${weekItems.length === 1 ? '' : 's'}</span></h4>${technicalSubmissionEntries(weekItems, isAdmin)}</section>`;
    }
    const weekEnd = new Date(`${week}T12:00:00`);
    weekEnd.setDate(weekEnd.getDate() + 5);
    const label = week === 'sin-fecha' ? 'Semana sin fecha de carga' : `${technicalDate(week)} al ${technicalDate(weekEnd.toISOString().slice(0, 10))}`;
    return `<section class="technical-week"><h4>Semana del ${label} <span>${weekItems.length} entrega${weekItems.length === 1 ? '' : 's'}</span></h4>${technicalSubmissionEntries(weekItems, isAdmin)}</section>`;
  }).join('') : '<div class="empty">Todavía no hay entregas cargadas. El resumen se irá completando según el periodo de la obra.</div>';
  const directiveOutline = directExecution ? technicalDirectiveOutline(ordered) : contractExecution ? technicalContractOutline(ordered) : '';
  const latestProgress = latestValuation
    ? `Última valorización registrada: ${shareEscape(latestValuation.valuationNumber || latestValuation.title)} · programado ${shareEscape(latestValuation.plannedProgress)}% y ejecutado ${shareEscape(latestValuation.actualProgress)}%.`
    : 'Todavía no se registraron valorizaciones con avance programado y ejecutado.';
  const actions = isAdmin
    ? '<div class="technical-report-actions"><button type="button" data-action="refresh-tech-report">Actualizar</button><button type="button" class="pr" data-action="print-tech-report">Imprimir / Guardar PDF</button></div>'
    : '<div class="technical-report-actions"><span class="badge">Vista de consulta · descarga reservada al administrador</span></div>';
  const periodHeading = directExecution ? 'Registro cronológico por mes de informe' : contractExecution ? 'Registro cronológico por periodo valorizado' : 'Registro cronológico por semana de carga';
  const periodCoverage = directExecution || contractExecution ? 'por periodo mensual o valorizado' : 'semana tras semana';
  const modality = project.executionType ? ` · ${shareEscape(project.executionType)}` : '';
  return `<div class="technical-report" id="technicalReportSummary"><div class="technical-report-heading"><div><div class="label">RESUMEN ACUMULADO · INFORME TÉCNICO</div><h2>${shareEscape(projectName)}</h2><p>${shareEscape(projectEntity)}${projectCode ? ` · Código ${shareEscape(projectCode)}` : ''}${modality}</p><p class="mu">${ordered.length ? `Periodo de cargas: ${technicalDate(firstDate)} – ${technicalDate(lastDate)}` : 'Periodo: se completará conforme se registren entregas.'}</p></div>${actions}</div><div class="technical-metrics"><div><b>${ordered.length}</b><span>Entregas acumuladas</span></div><div><b>${approved}</b><span>Aprobadas</span></div><div><b>${pending}</b><span>En revisión</span></div><div><b>${observed}</b><span>Observadas</span></div></div><div class="technical-overview"><h3>Resumen ejecutivo</h3><p>Se registran ${ordered.length} entregas: ${reportCount} informes, ${valuationCount} valorizaciones y ${conformityCount} conformidades. Del total, ${approved} están aprobadas, ${pending} continúan en revisión y ${observed} tienen observaciones.</p><p>${latestProgress}</p></div>${directiveOutline}<h3 class="technical-timeline-title">${periodHeading}</h3>${periodMarkup}<p class="technical-footnote">${isAdmin ? 'Documento acumulado de todas las entregas recibidas en el proyecto. Las observaciones de revisión son visibles solo para el administrador.' : 'Resumen de todas las entregas del proyecto. La descarga e impresión están reservadas al administrador; las observaciones privadas no se muestran.'} Este resumen se organiza ${periodCoverage}.</p></div>`;
}

function technicalSubmissionEntries(weekItems, isAdmin) {
  return weekItems.map(item => {
      const files = (item.files || []).map(file => shareEscape(file.name)).join(' · ') || 'Sin archivo registrado';
      const progress = item.kind === 'valuation'
        ? `<p><b>Avance programado:</b> ${shareEscape(item.plannedProgress ?? 'Sin dato')}% &nbsp; <b>Ejecutado:</b> ${shareEscape(item.actualProgress ?? 'Sin dato')}%</p>` : '';
      const review = isAdmin && item.review ? `<p class="technical-private"><b>Observación del administrador:</b> ${shareEscape(item.review)}</p>` : '';
      const note = item.note ? `<p><b>Detalle:</b> ${shareNoteMarkup(item.note)}</p>` : '';
      return `<article class="technical-entry"><div class="technical-entry-head"><b>${shareEscape(item.title || technicalSubmissionType(item))}</b><span class="badge ${item.status === 'Aprobada' ? 'approved' : item.status === 'Observada' ? 'observed' : 'pending'}">${shareEscape(item.status === 'Pendiente' ? 'En revisión' : item.status || 'Sin estado')}</span></div><p><b>Tipo:</b> ${shareEscape(technicalSubmissionType(item))} &nbsp; <b>N.º:</b> ${shareEscape(item.number || '—')}</p><p><b>Fecha del documento:</b> ${technicalDate(item.documentDate || item.valuationPeriod || item.conformityDate)} &nbsp; <b>Cargado:</b> ${technicalDate(item.created, true)}</p><p><b>Responsable:</b> ${shareEscape(item.responsibleName || item.submitterName || item.responsibleEmail || item.email || 'Sin responsable')} (${shareEscape(item.responsibleEmail || item.email || 'sin correo')})</p>${progress}<p><b>Archivos:</b> ${files}</p>${note}${review}</article>`;
    }).join('');
}

function printTechnicalReport(items, isAdmin) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { toast('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para guardar el informe.'); return; }
  const content = technicalSummaryMarkup(items, isAdmin);
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe técnico acumulado</title><style>body{font:14px Arial,sans-serif;color:#243945;margin:28px}h2{margin:5px 0}h3{margin-top:24px}.technical-report-heading{display:flex;justify-content:space-between;border-bottom:2px solid #176bd8;padding-bottom:15px}.technical-report-actions{display:none}.label{font-size:11px;letter-spacing:1px;color:#58717b}.technical-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.technical-metrics div{border:1px solid #d6e1e4;border-radius:8px;padding:12px}.technical-metrics b,.technical-metrics span{display:block}.technical-metrics b{font-size:25px}.technical-metrics span,.mu,.technical-footnote{color:#647984;font-size:12px}.technical-overview{background:#f1f6ff;border-radius:8px;padding:12px}.technical-week{margin-top:20px;break-inside:avoid}.technical-week h4{border-bottom:1px solid #cfdde0;padding-bottom:7px}.technical-week h4 span{float:right;color:#627780;font-weight:400}.technical-entry{border:1px solid #dce5e8;border-radius:7px;padding:10px;margin:8px 0;break-inside:avoid}.technical-entry p{margin:6px 0}.technical-entry-head{display:flex;justify-content:space-between;gap:12px}.badge{padding:4px 8px;border-radius:15px;background:#fff2cc}.badge.approved{background:#d8f4e5;color:#116b45}.badge.observed,.technical-private{background:#ffe2e2;color:#9b2525}.technical-report-actions{display:none}.directive-outline{display:block}.directive-outline>summary{font-weight:bold}.directive-generalities,.directive-checklist{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.directive-monthly-note{padding:10px;background:#f1f6ff}.directive-check-row{border:1px solid #ddd;padding:7px;margin:3px}.directive-check-row small{display:block}.technical-footnote{font-size:11px}@media print{body{margin:15mm}}</style></head><body>${content}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 350);
}

function reportMonthKey(item) {
  const periodStart = item?.kind === 'valuation' ? '' : String(item?.note || '').match(/(?:^|\n)Inicio del periodo:\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
  const value = item?.kind === 'valuation' ? item.valuationPeriod || item.documentDate || item.created : periodStart || item?.documentDate || item?.conformityDate || item?.created;
  return String(value || '').slice(0, 7);
}

function reportTemplateMonthOptionsMarkup() {
  const items = technicalSummaryItems?.length ? technicalSummaryItems : sharedReportItems;
  const dataMonths = [...new Set((items || []).map(reportMonthKey).filter(key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key)))];
  const inputStart = document.getElementById('techWorkStart')?.value || project.techWorkStart || project.techContractStart || '';
  const inputEnd = document.getElementById('techWorkEnd')?.value || project.techWorkEnd || project.techContractEnd || '';
  const months = new Set(dataMonths);
  if (inputStart) {
    const start = new Date(`${inputStart.slice(0, 7)}-01T12:00:00`);
    const latestData = dataMonths.slice().sort().slice(-1)[0] || '';
    const currentMonth = new Date().toISOString().slice(0, 7);
    const openEndMonth = latestData > currentMonth ? latestData : currentMonth;
    const endValue = inputEnd || `${openEndMonth < inputStart.slice(0, 7) ? inputStart.slice(0, 7) : openEndMonth}-01`;
    const end = new Date(`${endValue.slice(0, 7)}-01T12:00:00`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
      const cursor = new Date(start);
      for (let count = 0; cursor <= end && count < 240; count++) {
        months.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
  }
  if (!inputEnd) months.add(new Date().toISOString().slice(0, 7));
  if (!months.size) months.add(new Date().toISOString().slice(0, 7));
  const sorted = [...months].filter(key => (!inputStart || key >= inputStart.slice(0, 7)) && (!inputEnd || key <= inputEnd.slice(0, 7))).sort((a, b) => b.localeCompare(a));
  const options = sorted.length ? sorted : [...months].sort((a, b) => b.localeCompare(a));
  const defaultMonth = dataMonths.slice().sort().slice(-1)[0];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const selectedMonth = options.includes(defaultMonth) ? defaultMonth : options.includes(currentMonth) ? currentMonth : options[options.length - 1];
  return options.map(key => `<option value="${key}" ${key === selectedMonth ? 'selected' : ''}>${shareEscape(submissionMonthLabel(key))}</option>`).join('');
}

function refreshReportTemplateMonthSelect() {
  const select = document.getElementById('reportTemplateMonth');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = reportTemplateMonthOptionsMarkup();
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function applySelectedReportMonth() {
  const month = document.getElementById('reportTemplateMonth')?.value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('Selecciona el mes del informe mensual.');
  const [year, monthNumber] = month.split('-').map(Number);
  let start = `${month}-01`;
  const lastDay = new Date(year, monthNumber, 0).getDate();
  let end = `${month}-${String(lastDay).padStart(2, "0")}`;
  const projectStart = document.getElementById('techWorkStart')?.value || project.techWorkStart || project.techContractStart || '';
  const projectEnd = document.getElementById('techWorkEnd')?.value || project.techWorkEnd || project.techContractEnd || '';
  if (projectStart && start < projectStart) start = projectStart;
  if (projectEnd && end > projectEnd) end = projectEnd;
  if (start > end) throw new Error('El mes elegido está fuera de las fechas de la obra.');
  const startInput = document.getElementById('reportPeriodStart');
  const endInput = document.getElementById('reportPeriodEnd');
  if (startInput) startInput.value = start;
  if (endInput) endInput.value = end;
  return { month, start, end };
}

function reportTemplateLibraryMarkup() {
  const contract = project.executionType === 'Obra por contrata';
  const supervision = project.techReportRole === 'supervisor';
  const monthlyType = contract ? (supervision ? 'contractSupervisorMonthly' : 'contractMonthly') : (supervision ? 'supervisorMonthly' : 'monthly');
  const finalType = contract ? (supervision ? 'contractSupervisorFinal' : 'contractFinal') : (supervision ? 'supervisorFinal' : 'final');
  const monthlyLabel = contract ? (supervision ? 'informe mensual de supervisión de obra por contrata' : 'informe mensual del residente del contratista') : (supervision ? 'informe mensual de supervisión (Anexo 13)' : 'informe mensual del residente');
  const finalLabel = contract ? (supervision ? 'informe de cierre y pronunciamiento de supervisión' : 'informe de cierre de obra por contrata') : (supervision ? 'revisión y pronunciamiento sobre el Informe Final de Obra' : 'Informe Final de Obra / preliquidación');
  const downloadOptions = currentUser?.role === 'admin'
    ? `<div class="rw"><button type="button" data-action="download-report-template" data-template="${monthlyType}">Descargar ${monthlyLabel}</button><button type="button" class="pr" data-action="download-report-template" data-template="${finalType}">Descargar ${finalLabel}</button></div>`
    : '<p class="notice">Puedes revisar la plantilla y la información registrada. La descarga está habilitada solo para el administrador.</p>';
  const supervisorNote = contract
    ? '<p class="notice">Modelos de seguimiento adaptados a la Ley 32069 y su Reglamento vigente. Contrasta el contenido y los plazos con el contrato, las bases y el sistema de entrega. El cierre no sustituye la recepción ni la liquidación.</p>'
    : supervision ? '<p class="notice">El informe mensual usa el Anexo 13. Para el cierre, el supervisor emite un pronunciamiento sobre el informe final elaborado por el residente; no es un segundo informe final independiente.</p>' : '';
  const liquidationLink = contract || supervision ? '' : '<p class="mini">La liquidación es un documento distinto y se presenta por separado. <a href="https://www.gob.pe/institucion/contraloria/informes-publicaciones/5623662-anexos-a-la-directriz-de-obras-por-administracion-directa" target="_blank" rel="noopener noreferrer">Ver formato oficial de liquidación</a></p>';
  const roleName = contract ? (supervision ? 'Inspector o supervisor de obra' : 'Residente del contratista') : (supervision ? 'Inspector o supervisor' : 'Residente de obra');
  const title = contract ? 'Plantillas de obra por contrata' : 'Plantillas de informe · Administración directa';
  const templateCard = `<div class="card"><h3>${title}</h3><p class="mu">Seleccionado en Proyecto: ${roleName}. Las plantillas toman los datos del proyecto y las entregas registradas.</p>${supervisorNote}<div class="field"><label for="reportTemplateMonth">Mes para el informe mensual</label><select id="reportTemplateMonth">${reportTemplateMonthOptionsMarkup()}</select><div class="mini">Se incluirán las entregas de este mes y dentro del plazo del proyecto.</div></div><div class="rw"><button type="button" data-action="preview-report-template" data-template="${monthlyType}">Ver ${monthlyLabel}</button><button type="button" data-action="preview-report-template" data-template="${finalType}">Ver ${finalLabel}</button></div>${downloadOptions}${liquidationLink}</div>`;
  return `<div id="reportTemplateLibrary">${templateCard}</div>`;
}

function reportTemplatePreviewHtml(markdown) {
  return markdown.split(/\r?\n/).map(line => {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) return `<h${heading[1].length}>${shareEscape(heading[2])}</h${heading[1].length}>`;
    if (/^\s*---+\s*$/.test(line)) return '<hr>';
    const mapLine = line.match(/Mapa de ubicaci[^:]*:\s*(https?:\/\/\S+)/i);
    if (mapLine) {
      const mapUrl = mapLine[1].replace(/[),.;]+$/, '');
      let destination = '';
      try { destination = new URL(mapUrl).searchParams.get('query') || ''; } catch {}
      const mapEmbed = destination ? `https://maps.google.com/maps?q=${encodeURIComponent(destination)}&output=embed` : '';
      return `<div class="report-map-preview"><b>Mapa de ubicación del proyecto</b>${mapEmbed ? `<iframe title="Mapa de ubicación del proyecto" src="${shareEscape(mapEmbed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>` : ''}<a href="${shareEscape(mapUrl)}" target="_blank" rel="noopener noreferrer">Abrir mapa en Google Maps</a></div>`;
    }
    if (/^\s*- \[ \]/.test(line)) return `<p>☐ ${shareEscape(line.replace(/^\s*- \[ \]\s*/, ''))}</p>`;
    if (/^\s*- /.test(line)) return `<p>• ${shareEscape(line.replace(/^\s*-\s*/, ''))}</p>`;
    const content = shareEscape(line).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/`([^`]*)`/g, '<code>$1</code>');
    return content.trim() ? `<p>${content}</p>` : '';
  }).join('');
}

function fillReportTemplateFromProject(markdown, items, liveState, type) {
  const savedProject = { ...project, ...(liveState?.project || {}) };
  const projectInputIds = { name: 'projectName', entity: 'entity', executionType: 'projectType', code: 'projectCode', cutoff: 'cutoff', description: 'projectDesc' };
  Object.entries(projectInputIds).forEach(([key, id]) => {
    const value = document.getElementById(id)?.value?.trim();
    if (value) savedProject[key] = value;
  });
  const selectedLocation = ['projectDistrict','projectProvince','projectDepartment'].map(id => {
    const field = document.getElementById(id);
    return field?.value ? field.options[field.selectedIndex]?.textContent.trim() : '';
  }).filter(Boolean);
  if (selectedLocation.length) savedProject.location = selectedLocation.join(', ');
  TECHNICAL_PROJECT_FIELDS.forEach(id => {
    const value = document.getElementById(id)?.value?.trim();
    if (value) savedProject[id] = value;
  });
  const workspace = liveState?.workspace || liveWorkspace || {};
  const normalizeLabel = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const details = new Map();
  const history = new Map();
  const detailLabels = [
    'Inicio del periodo', 'Fin del periodo', 'Ejecución física y financiera', 'Ocurrencias, riesgos y acciones',
    'Enlace al cuaderno de obra digital', 'Calidad y ensayos', 'Enlace a información de calidad',
    'Seguridad y ambiente', 'Enlace a seguridad y ambiente', 'Conclusiones', 'Recomendaciones',
    'Avance mensual programado (%)', 'Avance mensual ejecutado (%)', 'Monto valorizado del periodo (S/)',
    'Monto valorizado acumulado (S/)', 'Avance financiero acumulado (%)', 'Metrados / partidas', 'Estado de trámite / pago'
  ];
  const knownLabels = new Map(detailLabels.map(label => [normalizeLabel(label), label]));
  const allOrdered = [...(items || [])].sort((a, b) => String(a.documentDate || a.valuationPeriod || a.created).localeCompare(String(b.documentDate || b.valuationPeriod || b.created)));
  const allValuations = allOrdered.filter(item => item.kind === 'valuation');
  const allReports = allOrdered.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity');
  const latestAllValuation = allValuations[allValuations.length - 1];
  const latestAllReport = allReports[allReports.length - 1];
  const isFinal = ['final','supervisorFinal','contractFinal','contractSupervisorFinal'].includes(type);
  const isMonthly = ['monthly','supervisorMonthly','contractMonthly','contractSupervisorMonthly'].includes(type);
  const projectStart = savedProject.techWorkStart || savedProject.techContractStart || '';
  const projectEnd = savedProject.techWorkEnd || savedProject.techContractEnd || '';
  const dateForItem = item => {
    const reportPeriodStart = item?.kind === 'valuation' ? '' : String(item?.note || '').match(/(?:^|\n)Inicio del periodo:\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
    return String(item.kind === 'valuation'
      ? item.valuationPeriod || item.documentDate || item.created
      : reportPeriodStart || item.documentDate || item.conformityDate || item.valuationPeriod || item.created || '').slice(0, 10);
  };
  const selectedMonth = isMonthly
    ? document.getElementById('reportTemplateMonth')?.value || document.getElementById('reportPeriodStart')?.value?.slice(0, 7) || document.getElementById('reportPeriodEnd')?.value?.slice(0, 7) || latestAllValuation?.valuationPeriod?.slice(0, 7) || reportMonthKey(latestAllReport) || today().slice(0, 7)
    : '';
  let periodStart = '', periodEnd = '';
  if (isMonthly && /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
    const [year, month] = selectedMonth.split('-').map(Number);
    periodStart = `${selectedMonth}-01`;
    periodEnd = `${selectedMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    if (projectStart && periodStart < projectStart) periodStart = projectStart;
    if (projectEnd && periodEnd > projectEnd) periodEnd = projectEnd;
  }
  const ordered = allOrdered.filter(item => {
    const date = dateForItem(item);
    if (projectStart && date && date < projectStart) return false;
    if (projectEnd && date && date > projectEnd) return false;
    if (!isMonthly) return true;
    return !!date && !!periodStart && !!periodEnd && date >= periodStart && date <= periodEnd;
  });
  const reports = ordered.filter(item => item.kind !== 'valuation' && item.kind !== 'conformity');
  const valuations = ordered.filter(item => item.kind === 'valuation');
  const residentIdentity = normalizeLabel(savedProject.techResidentName);
  const residentReports = residentIdentity ? reports.filter(item => normalizeLabel(item.responsibleName || item.submitterName).includes(residentIdentity)) : [];
  const residentReportPool = residentReports.length ? residentReports : reports;
  const latestResidentReport = residentReportPool[residentReportPool.length - 1];
  const designatedName = normalizeLabel(savedProject.techReportRole === 'supervisor' ? savedProject.techSupervisorName : savedProject.techResidentName);
  const matchingReports = designatedName ? reports.filter(item => normalizeLabel(item.responsibleName || item.submitterName).includes(designatedName)) : [];
  const reportPool = matchingReports.length ? matchingReports : reports;
  const latestReport = reportPool[reportPool.length - 1];
  const latestValuation = valuations[valuations.length - 1];
  const valuationCumulativeAmounts = valuations.map(item => {
    const match = String(item.note || '').match(/(?:^|\n)Monto valorizado acumulado \(S\/\):\s*([^\n]*)/i);
    return match?.[1]?.trim() || '';
  }).filter(Boolean);
  const earlierValuations = isMonthly ? allValuations.filter(item => dateForItem(item) < periodStart && (!projectStart || dateForItem(item) >= projectStart)) : [];
  const priorValuation = earlierValuations[earlierValuations.length - 1];
  const priorCumulativeMatch = String(priorValuation?.note || '').match(/(?:^|\n)Monto valorizado acumulado \(S\/\):\s*([^\n]*)/i);
  const previousValuationCumulative = isMonthly ? priorCumulativeMatch?.[1]?.trim() || '' : valuationCumulativeAmounts.length > 1 ? valuationCumulativeAmounts[valuationCumulativeAmounts.length - 2] : '';
  function readKnownNote(note) {
    const lines = String(note || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^([^:]{2,100}):\s*(.*)$/);
      if (!match) continue;
      const label = knownLabels.get(normalizeLabel(match[1]));
      if (!label) continue;
      const valueLines = [match[2]];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].match(/^([^:]{2,100}):\s*/);
        if (next && knownLabels.has(normalizeLabel(next[1]))) break;
        valueLines.push(lines[j]);
      }
      const value = valueLines.join('\n').trim();
      if (value) {
        details.set(label, value);
        if (!history.has(label)) history.set(label, []);
        if (!history.get(label).includes(value)) history.get(label).push(value);
      }
    }
  }
  reports.forEach(item => readKnownNote(item.note));
  valuations.forEach(item => readKnownNote(item.note));
  const activityLines = (workspace.activities || []).filter(item => !isMonthly || (item.due && item.due >= periodStart && item.due <= periodEnd)).map(item => `${item.title || 'Actividad'}${item.done ? ' (cumplida)' : ' (pendiente)'}${item.owner ? ` · responsable: ${item.owner}` : ''}${item.due ? ` · fecha: ${item.due}` : ''}`);
  const commentLines = (workspace.comments || []).filter(item => !isMonthly || (item.date && String(item.date).slice(0, 10) >= periodStart && String(item.date).slice(0, 10) <= periodEnd)).map(item => `${item.date ? item.date + ': ' : ''}${item.text || ''}`).filter(Boolean);
  const sourceEntries = Object.entries(workspace.sources?.byWeek || {});
  const sourceWeeks = isMonthly ? sourceEntries.filter(([key]) => key.slice(0, 7) === selectedMonth).map(([, week]) => week) : sourceEntries.map(([, week]) => week);
  const currentMonth = typeof currentDate !== 'undefined' && currentDate instanceof Date ? currentDate.toISOString().slice(0, 7) : '';
  const currentSources = !isMonthly || currentMonth === selectedMonth ? ['srcReports', 'srcActivities', 'srcComments', 'srcOther'].map(id => document.getElementById(id)?.value?.trim()).filter(Boolean) : [];
  const controlTexts = [...sourceWeeks.flatMap(week => ['reports', 'activities', 'comments', 'other'].map(key => week?.[key]).filter(Boolean)), ...currentSources, ...activityLines, ...commentLines];
  const controlSummary = controlTexts.join('\n');
  const personnel = (workspace.workers || []).map(person => `${person.name || 'Personal'}${person.role ? ` (${person.role})` : ''}${person.area ? ` · ${person.area}` : ''}`).join('\n');
  const reportInputs = {
    'Inicio del periodo': 'reportPeriodStart', 'Fin del periodo': 'reportPeriodEnd',
    'Ejecución física y financiera': 'reportPeriodSummary', 'Ocurrencias, riesgos y acciones': 'reportOccurrences',
    'Enlace al cuaderno de obra digital': 'reportNotebookLink', 'Calidad y ensayos': 'reportQuality',
    'Enlace a información de calidad': 'reportQualityLink', 'Seguridad y ambiente': 'reportSafetyEnvironment',
    'Enlace a seguridad y ambiente': 'reportSafetyLink', 'Conclusiones': 'reportConclusions',
    'Recomendaciones': 'reportRecommendations', 'Avance mensual programado (%)': 'valuationMonthlyPlanned',
    'Avance mensual ejecutado (%)': 'valuationMonthlyActual', 'Monto valorizado del periodo (S/)': 'valuationAmount',
    'Monto valorizado acumulado (S/)': 'valuationCumulativeAmount', 'Avance financiero acumulado (%)': 'valuationFinancialProgress',
    'Metrados / partidas': 'valuationMeasurements', 'Estado de trámite / pago': 'valuationPaymentStatus'
  };
  const reportValue = label => {
    const saved = isFinal ? (history.get(label) || []).join('\n') : details.get(label) || '';
    const draft = document.getElementById(reportInputs[label])?.value?.trim();
    return isFinal ? (saved || draft) : isMonthly ? saved : (draft || saved);
  };
  const reportSummary = reportValue('Ejecución física y financiera') || (latestValuation ? `Valorización ${latestValuation.valuationNumber || latestValuation.title}: avance programado ${latestValuation.plannedProgress ?? 'sin dato'}% y ejecutado ${latestValuation.actualProgress ?? 'sin dato'}%.` : '');
  const workSummary = [reportSummary, controlSummary].filter(Boolean).join('\n');
  const noteValue = label => reportValue(label);
  const finalPeriodStarts = history.get('Inicio del periodo') || [];
  const finalPeriodEnds = history.get('Fin del periodo') || [];
  const reportPeriodStart = isMonthly ? periodStart : isFinal ? (finalPeriodStarts[0] || document.getElementById('reportPeriodStart')?.value) : reportValue('Inicio del periodo');
  const reportPeriodEnd = isMonthly ? periodEnd : isFinal ? (finalPeriodEnds[finalPeriodEnds.length - 1] || document.getElementById('reportPeriodEnd')?.value) : reportValue('Fin del periodo');
  const map = {
    project: savedProject,
    latestReport,
    latestResidentReport,
    latestValuation,
    reports,
    valuations,
    reportSummary,
    workSummary,
    controlSummary,
    personnel,
    noteValue,
    normalizeLabel
  };
  const display = value => value === undefined || value === null || String(value).trim() === '' ? '' : String(value).trim();
  function valueFor(line, hint, offset) {
    const text = normalizeLabel(`${line} ${hint}`);
    const p = map.project;
    if (text.includes('ocurrencia') || text.includes('riesgo') || text.includes('accion adoptada')) return [noteValue('Ocurrencias, riesgos y acciones'), controlSummary].filter(Boolean).join('\n');
    if (text.includes('calidad') && (text.includes('seguridad') || text.includes('ambient'))) return [noteValue('Calidad y ensayos'), noteValue('Seguridad y ambiente'), savedProject.techDirectQualitySafety].filter(Boolean).join('\n');
    if (text.includes('otorga conformidad') || text.includes('conformidad con observaciones')) return '';
    if (text.includes('personal clave registrado')) return p.techDirectKeyStaff || personnel;
    if (text.includes('documentos revisados')) return [latestResidentReport?.title, latestResidentReport?.number, p.techDirectExpedientReview, controlSummary].filter(Boolean).join('\n');
    if (text.includes('valorizacion fisica') || text.includes('valorizacion financiera')) return [noteValue('Monto valorizado del periodo (S/)'), noteValue('Monto valorizado acumulado (S/)'), noteValue('Avance financiero acumulado (%)'), noteValue('Metrados / partidas'), p.techExecutedBudget].filter(Boolean).join('\n');
    if (text.includes('cuaderno de obra')) return noteValue('Enlace al cuaderno de obra digital') || controlSummary;
    if (text.includes('calidad') || text.includes('ensayo') || text.includes('protocolo')) return noteValue('Calidad y ensayos') || p.techDirectQualitySafety;
    if (text.includes('seguridad') || text.includes('ambient')) return noteValue('Seguridad y ambiente') || p.techDirectQualitySafety;
    if (text.includes('ocurrencia') || text.includes('riesgo') || text.includes('accion adoptada')) return noteValue('Ocurrencias, riesgos y acciones') || p.techDirectPeriodProgress || controlSummary;
    if (text.includes('conclusion') && text.includes('recomendacion')) return [noteValue('Conclusiones'), noteValue('Recomendaciones')].filter(Boolean).join('\n');
    if (text.includes('recomendacion')) return noteValue('Recomendaciones') || p.techDirectChanges;
    if (text.includes('conclusion') || text.includes('leccion aprendida')) return noteValue('Conclusiones') || workSummary;
    if (text.includes('dni') && text.includes('residente')) return p.techResidentDni;
    if ((text.includes('cip') || text.includes('cap') || text.includes('registro profesional')) && text.includes('residente')) return p.techResidentCip;
    if (text.includes('fecha') && text.includes('residente') && (text.includes('designacion') || text.includes('suscripcion'))) return p.techResidentResolutionDate;
    if ((text.includes('resolucion') || text.includes('contrato') || text.includes('designacion')) && text.includes('residente')) return p.techResidentDesignation;
    if (text.includes('monto') && text.includes('residente')) return p.techResidentAmount;
    if (text.includes('inicio') && text.includes('servicio') && text.includes('residente')) return p.techResidentServiceStart;
    if ((text.includes('termino') || text.includes('fin')) && text.includes('servicio') && text.includes('residente')) return p.techResidentServiceEnd;
    if (text.includes('dni') && (text.includes('inspector') || text.includes('supervisor'))) return p.techSupervisorDni;
    if ((text.includes('cip') || text.includes('cap') || text.includes('registro profesional')) && (text.includes('inspector') || text.includes('supervisor'))) return p.techSupervisorCip;
    if (text.includes('fecha') && (text.includes('inspector') || text.includes('supervisor')) && (text.includes('designacion') || text.includes('suscripcion'))) return p.techSupervisorResolutionDate;
    if ((text.includes('resolucion') || text.includes('contrato') || text.includes('designacion')) && (text.includes('inspector') || text.includes('supervisor'))) return p.techSupervisorDesignation;
    if (text.includes('monto') && (text.includes('inspector') || text.includes('supervisor'))) return p.techSupervisorAmount;
    if (text.includes('inicio') && text.includes('servicio') && (text.includes('inspector') || text.includes('supervisor'))) return p.techSupervisorServiceStart;
    if ((text.includes('termino') || text.includes('fin')) && text.includes('servicio') && (text.includes('inspector') || text.includes('supervisor'))) return p.techSupervisorServiceEnd;
    if (text.includes('residente')) return p.techResidentName || noteValue('Residente') || p.techDirectKeyStaff || latestReport?.responsibleName;
    if (text.includes('inspector') || text.includes('supervisor')) return p.techSupervisorName || p.techContractSupervisor || p.techDirectKeyStaff;
    if (text.includes('numero de contrato') || text.includes('contrato n')) return p.techContractNumber;
    if (text.includes('procedimiento de seleccion') || text.includes('codigo seace')) return p.techContractProcedure;
    if (text.includes('contratista')) return p.techContractor;
    if (text.includes('objeto del contrato')) return p.techContractObject;
    if (text.includes('fecha de contrato')) return p.techContractDate;
    if (text.includes('sistema de entrega') || text.includes('sistema de contratacion')) return p.techDeliverySystem;
    if (text.includes('garantias') || text.includes('seguros')) return p.techContractGuarantees;
    if (text.includes('expediente tecnico') && text.includes('aprobacion')) return p.techContractExpedient || p.techExpedientApproval;
    if (text.includes('cuaderno') && (text.includes('incidencia') || text.includes('obra'))) return p.techContractNotebookLink || noteValue('Enlace al cuaderno de obra digital') || controlSummary;
    if (text.includes('ruta critica') || text.includes('calendario vigente')) return p.techContractSchedule || noteValue('Ejecución física y financiera');
    if (text.includes('registro de valorizacion') || text.includes('registro seace')) return p.techContractValuations || noteValue('Estado de trámite / pago');
    if (text.includes('pronunciamiento de supervision sobre valorizacion')) return p.techContractValuations || noteValue('Estado de trámite / pago');
    if (text.includes('numero de valorizacion')) return latestValuation?.valuationNumber || latestValuation?.title;
    if (text.includes('periodo de valorizacion')) return latestValuation?.valuationPeriod || latestValuation?.documentDate;
    if (text.includes('metrado') || text.includes('partidas ejecutadas')) return noteValue('Metrados / partidas') || p.techContractValuations;
    if (text.includes('valorizaciones') || text.includes('monto pagado') || text.includes('saldo final')) return [p.techContractValuations, noteValue('Monto valorizado del periodo (S/)'), noteValue('Monto valorizado acumulado (S/)'), noteValue('Estado de trámite / pago')].filter(Boolean).join('\n');
    if (text.includes('articulo 207') || text.includes('umbral del calendario acelerado')) return p.techContractSchedule || noteValue('Retrasos y medidas correctivas') || controlSummary;
    if (text.includes('penalidad') || text.includes('incumplimiento')) return p.techContractPenaltyStatus;
    if (text.includes('controversia') || text.includes('reclamo') || text.includes('arbitraje')) return p.techContractDisputes;
    if (text.includes('recepcion de obra') || text.includes('observaciones de recepcion')) return p.techContractReception || p.techContractCloseout;
    if (text.includes('liquidacion contractual') || text.includes('revision de liquidacion')) return p.techContractLiquidation || p.techContractCloseout;
    if (text.includes('documentos finales') || text.includes('planos finales') || text.includes('documentos entregados')) return p.techContractFinalDocuments;
    if (text.includes('fecha y documento de culminacion')) return p.techContractReception || p.techContractCloseout;
    if (text.includes('anexos y documentos') || text.includes('documentos de sustento')) return controlSummary;
    if (text.includes('periodo informado')) {
      const separator = line.toLowerCase().indexOf(' al ');
      return offset < separator ? (reportPeriodStart || latestReport?.documentDate) : (reportPeriodEnd || latestReport?.documentDate);
    }
    if (text.includes('periodo de')) return [reportPeriodStart, reportPeriodEnd].filter(Boolean).join(' al ') || latestReport?.documentDate;
    if (text.includes('fecha de recepcion')) return latestReport?.created || latestReport?.documentDate;
    if (text.includes('fecha de presentacion') || text.includes('fecha de emision')) return latestReport?.documentDate;
    if (text.includes('informe final de obra revisado') || text.includes('informe mensual del residente revisado')) return [latestResidentReport?.number, latestResidentReport?.title, latestResidentReport?.documentDate].filter(Boolean).join(' · ');
    if (text.includes('documento con el que se presenta')) return [latestReport?.number, latestReport?.title, latestReport?.documentDate].filter(Boolean).join(' · ');
    if (text.includes('fecha de aprobacion')) return p.techExpedientApproval;
    if (text.includes('fecha de inicio fisico')) return p.techWorkStart || p.techContractStart;
    if (text.includes('inicio del plazo de obra')) return p.techWorkStart || p.techContractStart;
    if (text.includes('unidad ejecutora')) return p.techExecutiveUnit || p.entity;
    if (text.includes('pliego')) return p.techPliego;
    if (text.includes('estado de la obra')) return p.techWorkStatus;
    if (text.includes('plazo de ejecucion de obra')) return p.techWorkTermDays;
    if (text.includes('fecha de termino vigente') || text.includes('fin del plazo')) return p.techWorkEnd || p.techContractEnd;
    if (text.includes('sistema de ejecucion')) return p.techExecutionSystem || 'Administración directa';
    if (text.includes('modalidad de ejecucion')) return p.executionType || 'Administración directa';
    if (text.includes('distrito')) return p.district;
    if (text.includes('provincia')) return p.province;
    if (text.includes('departamento')) return p.department;
    if (text.includes('culminacion fisica') || text.includes('culmino')) return p.techDirectCloseout || p.cutoff;
    if (text.includes('cui')) return text.includes('nombre y codigo') ? [p.name, p.code].filter(Boolean).join(' · ') : p.code;
    if (text.includes('infobras')) return p.techInfobras;
    if (text.includes('entidad') && text.includes('oad')) return [p.entity, p.techOffice].filter(Boolean).join(' · ');
    if (text.includes('entidad')) return p.entity;
    if (text.includes('nombre de la inversion') || text.includes('nombre de la obra') || (text.includes('obra') && text.includes('nombre'))) return p.name;
    if (text.includes('enlace al mapa') || text.includes('mapa de ubicacion')) {
      const mapLocation = p.location || [p.district, p.province, p.department].filter(Boolean).join(', ');
      return mapLocation ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapLocation + ', Perú')}` : '';
    }
    if (text.includes('ubicacion')) return p.location || [p.district, p.province, p.department].filter(Boolean).join(', ');
    if (text.includes('oad') || text.includes('oficina')) return p.techOffice;
    if (text.includes('secuencia funcional')) return p.techFunctionalSequence;
    if (text.includes('ano presupuestal')) return p.techFiscalYear;
    if (text.includes('fuente de financiamiento')) return p.techFundingSource;
    if (text.includes('presupuesto aprobado')) return p.techApprovedBudget || p.techContractAmount;
    if (text.includes('presupuesto analitico')) return p.techAnalyticalBudget;
    if (text.includes('ejecutado acumulado') || text.includes('gasto devengado') || text.includes('ejecutado final')) return isMonthly ? noteValue('Monto valorizado acumulado (S/)') : p.techExecutedBudget || noteValue('Monto valorizado acumulado (S/)');
    if (text.includes('monto valorizado del periodo')) return noteValue('Monto valorizado del periodo (S/)');
    if (text.includes('valorizacion actual') || text.includes('monto actual')) return noteValue('Monto valorizado del periodo (S/)');
    if (text.includes('acumulado anterior')) return previousValuationCumulative;
    if (text.includes('acumulado a la fecha')) return noteValue('Monto valorizado acumulado (S/)');
    if (text.includes('monto de obra vigente')) return p.techApprovedBudget || p.techContractAmount;
    if (text.includes('saldo')) return p.techApprovedBudget && noteValue('Monto valorizado acumulado (S/)') ? String(Number(p.techApprovedBudget) - Number(noteValue('Monto valorizado acumulado (S/)'))) : '';
    if (text.includes('avance mensual programado')) return noteValue('Avance mensual programado (%)');
    if (text.includes('avance mensual ejecutado')) return noteValue('Avance mensual ejecutado (%)');
    if (text.includes('avance acumulado programado')) return latestValuation?.plannedProgress;
    if (text.includes('avance acumulado ejecutado')) return latestValuation?.actualProgress;
    if (text.includes('estado de obra del acumulado') || text.includes('adelantada o atrasada')) {
      const planned = Number(latestValuation?.plannedProgress), actual = Number(latestValuation?.actualProgress);
      return Number.isFinite(planned) && Number.isFinite(actual) ? (actual >= planned ? 'Adelantada' : 'Atrasada') : '';
    }
    if (text.includes('avance financiero')) return noteValue('Avance financiero acumulado (%)') || noteValue('Monto valorizado del periodo (S/)');
    if (text.includes('comparar') && text.includes('ejecutado')) return [reportSummary, noteValue('Avance mensual programado (%)'), noteValue('Avance mensual ejecutado (%)'), p.techDirectPeriodProgress, p.techDirectChanges].filter(Boolean).join('\n');
    if (text.includes('avance fisico') && text.includes('acumulado') && text.includes('programado')) return latestValuation?.plannedProgress;
    if (text.includes('avance fisico') && text.includes('acumulado') && text.includes('ejecutado')) return latestValuation?.actualProgress;
    if (text.includes('resultado fisico') && text.includes('financiero')) return [reportSummary, noteValue('Avance mensual programado (%)'), noteValue('Avance mensual ejecutado (%)'), noteValue('Monto valorizado acumulado (S/)'), p.techExecutedBudget].filter(Boolean).join('\n');
    if (text.includes('avance fisico programado') || text.includes('programado')) return noteValue('Avance mensual programado (%)');
    if (text.includes('ejecutado en el mes')) return noteValue('Avance mensual ejecutado (%)');
    if (text.includes('avance fisico ejecutado') || text.includes('avance fisico final')) return noteValue('Avance mensual ejecutado (%)') || latestValuation?.actualProgress;
    if (text.includes('metas concluidas') || text.includes('metas y cantidades')) return p.techCompletedGoals || workSummary;
    if (text.includes('metas') || text.includes('trabajos realizados') || text.includes('actividades y partidas') || text.includes('resultado fisico')) return workSummary || p.description || p.desc;
    if (text.includes('modificacion') || text.includes('diferencia') || text.includes('deductivo') || text.includes('saldo por ejecutar')) return p.techDirectChanges || controlSummary;
    if (text.includes('medidas tomadas') || text.includes('acciones pendientes')) return noteValue('Recomendaciones') || noteValue('Ocurrencias, riesgos y acciones') || controlSummary;
    if (text.includes('personal') || text.includes('bienes') || text.includes('almacen') || text.includes('equipos')) return personnel || p.techDirectKeyStaff || p.techDirectSupplyPlan;
    if (text.includes('aprobacion del expediente') || text.includes('resolucion')) return p.techExpedientApproval || p.techDirectApprovalReports;
    if (text.includes('entrega del terreno')) return p.techLandDelivery;
    if (text.includes('inicio de obra')) return p.techWorkStart;
    if (text.includes('viabilidad')) return p.techViability;
    if (text.includes('descripcion') || text.includes('antecedentes') || text.includes('alcance')) return [p.description || p.desc, workSummary].filter(Boolean).join('\n');
    if (text.includes('plan de abastecimiento') || text.includes('calendario')) return p.techDirectSupplyPlan || p.techDirectPeriodProgress;
    if (text.includes('plazo aprobado')) return p.techContractTerm;
    if (text.includes('costo directo') || text.includes('costo indirecto')) return '';
    if (text.includes('total valorizado fisicamente')) return noteValue('Monto valorizado acumulado (S/)') || noteValue('Monto valorizado del periodo (S/)');
    if (text.includes('fotografia') || text.includes('video') || text.includes('anexo')) return controlSummary;
    return '';
  }
  const lines = String(markdown || '').split(/\r?\n/).map(line => {
    if (/^\s*- \[ \]\s/.test(line)) return line;
    return line.replace(/\[([^\]]*)\]/g, (whole, hint, offset) => {
      const value = display(valueFor(line, hint, offset));
      return value || (String(hint).trim() ? `Pendiente de completar: ${String(hint).trim()}` : 'Pendiente de completar');
    });
  });
  return lines.join('\n');
}

function reportTemplateToRtf(markdown) {
  const escapeRtf = value => [...value].map(char => {
    if (char === '\\' || char === '{' || char === '}') return `\\${char}`;
    const code = char.codePointAt(0);
    return code > 127 ? `\\u${code > 32767 ? code - 65536 : code}?` : char;
  }).join('');
  const lines = markdown.split(/\r?\n/).map(line => {
    const mapLink = line.match(/Mapa de ubicaci[^:]*:\s*(https?:\/\/\S+)/i);
    if (mapLink) return `\\par\\b Mapa de ubicación:\\b0\\par{\\field{\\*\\fldinst HYPERLINK "${escapeRtf(mapLink[1])}"}{\\fldrslt Abrir mapa en Google Maps}}\\par`;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) return `\\par\\b\\fs${heading[1].length === 1 ? 30 : 25} ${escapeRtf(heading[2])}\\b0\\fs22\\par`;
    if (/^\s*---+\s*$/.test(line)) return '';
    if (/^>\s?/.test(line)) line = line.replace(/^>\s?/, '');
    line = line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
    if (/^\s*- \[ \]/.test(line)) return `\\par\\tx360\\tab ${escapeRtf('☐ ' + line.replace(/^\s*- \[ \]\s*/, ''))}`;
    if (/^\s*- /.test(line)) return `\\par\\tx360\\tab ${escapeRtf('• ' + line.replace(/^\s*-\s*/, ''))}`;
    return line.trim() ? `\\par ${escapeRtf(line)}` : '\\par';
  }).join('');
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\viewkind4\\uc1\\f0\\fs22${lines}\\par}`;
}

async function renderAdmin(me) {
  const [items, people] = await Promise.all([
    shareApi('/api/submissions'),
    shareApi('/api/people')
  ]);
  sharedReportItems = items;
  technicalSummaryItems = items;
  window.projectTeamAccounts = people;
  if (typeof renderWorkers === 'function') renderWorkers();
  shareRoot.innerHTML = `<div class="card"><div class="rw"><div><h3>Administración</h3><div class="mu">Sesión: ${shareEscape(me.email)}</div></div><div class="sp"></div></div></div><div class="g2"><div class="card"><h3>Autorizar personal</h3><p class="mu">Escribe el correo y entrega a esa persona el código que aparecerá aquí. También puedes convertir a un trabajador con cuenta activa en administrador.</p><label>Correo</label><input id="newPersonEmail" type="email" placeholder="persona@correo.com"><div class="rw"><button class="pr" data-action="invite">Crear invitación</button></div><p id="shareMessage"></p><div id="peopleList"></div></div><div class="card"><h3>Entregas recibidas: ${items.length}</h3><div class="mu">Revisa los archivos de cada entrega. Todas quedan pendientes hasta que las apruebes o devuelvas con observaciones.</div></div></div><div id="submissionList"></div>`;
  shareRoot.insertAdjacentHTML('afterbegin', reportTemplateLibraryMarkup());
  populateResponsible(people, '');
  document.getElementById('submissionList').insertAdjacentHTML('beforebegin', `<div class="card"><h3>Guardar información antes de iniciar otro proyecto</h3><p class="mu">Descarga en un solo archivo el proyecto, las entregas y los documentos cargados. Esta opción está disponible solo para el administrador.</p><button class="pr" type="button" data-action="download-project-backup">Guardar y descargar copia completa</button></div>`);
  updateSectionClearButtons();
  document.getElementById('peopleList').innerHTML = people.map(person => `<div class="item"><b>${shareEscape(person.displayName || person.email)}</b><div class="mini">${shareEscape(person.email)}</div><div class="rw"><span class="mu">${roleLabel(person.role)}</span>${!person.active ? `<button data-action="invite-existing" data-email="${shareEscape(person.email)}">Crear código</button>` : ''}</div></div>`).join('');
  addWorkerRemovalButtons();
  document.getElementById('submissionList').innerHTML = adminSubmissionGroups(items);
  document.getElementById('submissionList').insertAdjacentHTML('afterend', `<div class="card section-clear-tools"><h3>Limpiar Entregas</h3><p class="mini">Borra todos los informes, valorizaciones, órdenes y sus archivos adjuntos.</p><button class="warn section-clear-button" type="button" data-action="clear-section" data-section="entregas">↻ Borrar todas las entregas</button></div>`);
}

async function renderStaff(me) {
  const [items, people, summaryItems] = await Promise.all([shareApi('/api/submissions'), shareApi('/api/people'), shareApi('/api/technical-summary')]);
  technicalSummaryItems = summaryItems;
  window.projectTeamAccounts = people;
  if (typeof renderWorkers === 'function') renderWorkers();
  profileAvatarDraft = me.avatar || '';
  const avatarPreview = me.avatar ? `<img class="profile-avatar-preview" src="${shareEscape(me.avatar)}" alt="Mi avatar">` : '<div class="profile-avatar-preview profile-avatar-empty">+</div>';
    shareRoot.innerHTML = `<div class="card"><div class="rw"><div><h3>Cuenta del personal</h3><div class="mu">Correo: ${shareEscape(me.email)}</div></div><div class="sp"></div></div>${avatarPreview}<label for="profileAvatar">Mi avatar</label><input id="profileAvatar" type="file" accept="image/png,image/jpeg,image/webp"><div class="mini">La imagen aparecerá junto a tu nombre en Trabajadores y responsables.</div><button type="button" data-action="remove-avatar">Quitar avatar</button><label>Nombre completo</label><input id="profileName" value="${shareEscape(me.displayName || '')}" autocomplete="name"><div class="rw"><button data-action="save-name">Guardar perfil</button></div></div><div class="card"><p class="mu">Tus documentos se cargan desde Control. Cada entrega y sus archivos quedan pendientes hasta la revisión del administrador. Si necesitas corregirla, solicita autorización.</p><h3>Mis entregas</h3>${monthlySubmissionArchive(items, false)}</div>`;
  shareRoot.insertAdjacentHTML('afterbegin', reportTemplateLibraryMarkup());
  document.getElementById('profileAvatar')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { shareMessage('Elige una imagen PNG, JPG o WebP.', true); return; }
    try {
      profileAvatarDraft = await compressProfileAvatar(file);
      const preview = document.querySelector('.profile-avatar-preview');
      if (preview?.tagName === 'IMG') preview.src = profileAvatarDraft;
      else if (preview) preview.outerHTML = `<img class="profile-avatar-preview" src="${shareEscape(profileAvatarDraft)}" alt="Vista previa del avatar">`;
    } catch { shareMessage('No se pudo abrir esa imagen.', true); }
  });
  populateResponsible(people, me.email);
  applyWorkerDraft();
}

function compressProfileAvatar(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => { image.onerror = reject; image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 320;
      const context = canvas.getContext('2d');
      const scale = Math.max(320 / image.width, 320 / image.height);
      const width = image.width * scale, height = image.height * scale;
      context.drawImage(image, (320 - width) / 2, (320 - height) / 2, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    }; image.src = reader.result; };
    reader.readAsDataURL(file);
  });
}
function configureHistoricalUpload(me) {
  const panel = document.getElementById('historicalUploadPanel');
  const toggle = document.getElementById('allowHistoricalDate');
  const status = document.getElementById('historicalUploadStatus');
  const isAdmin = me?.role === 'admin';
  if (panel) panel.classList.toggle('hidden', !isAdmin);
  const dateFields = ['reportDate', 'valuationPeriod', 'conformityDate'];
  const applyMode = () => {
    const enabled = isAdmin && !!toggle?.checked;
    const range = projectUploadDateRange();
    const currentDate = today();
    const maximumDate = range.end && range.end < currentDate ? range.end : currentDate;
    dateFields.forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      input.min = enabled ? range.start || '1900-01-01' : currentDate;
      input.max = maximumDate;
    });
    if (status) status.textContent = enabled
      ? `Carga histórica activada. Periodo de obra: ${range.start || 'sin fecha de inicio'} a ${range.end || 'sin fecha final'}.`
      : isAdmin ? `Las cargas deben estar entre ${range.start || 'configura el inicio'} y ${range.end || 'configura el fin de obra'}. Activa la opción para registrar fechas anteriores.` : '';
  };
  if (toggle && !toggle.dataset.historicalBound) {
    toggle.addEventListener('change', applyMode);
    toggle.dataset.historicalBound = 'true';
  }
  ['techWorkStart', 'techWorkEnd', 'techWorkTermDays', 'techContractStart', 'techContractEnd'].forEach(id => {
    const input = document.getElementById(id);
    if (input && !input.dataset.historicalRangeBound) {
      input.addEventListener('change', applyMode);
      input.dataset.historicalRangeBound = 'true';
    }
  });
  applyMode();
}

function projectUploadDateRange() {
  const read = id => document.getElementById(id)?.value || project?.[id] || '';
  const start = read('techWorkStart') || read('techContractStart');
  let end = read('techWorkEnd') || read('techContractEnd');
  const term = Number(read('techWorkTermDays'));
  if (!end && start && Number.isInteger(term) && term > 0) {
    const lastDay = new Date(`${start}T12:00:00`);
    lastDay.setDate(lastDay.getDate() + term - 1);
    end = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
  }
  return { start, end };
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
  configureHistoricalUpload(me);
  try {
    const items = await shareApi('/api/submissions');
    sharedReportItems = items;
    if (me.role === 'admin') technicalSummaryItems = items;
    else technicalSummaryItems = await shareApi('/api/technical-summary').catch(() => technicalSummaryItems);
    refreshReportTemplateMonthSelect();
    renderControlConformities(items);
    if (me.role === 'admin') {
      inbox.innerHTML = adminSubmissionGroups(items);
      const privateList = document.getElementById('privateReviewList');
      if (privateList) privateList.innerHTML = adminSubmissionGroups(items);
    } else {
      inbox.innerHTML = `<div class="card"><h2>Mis informes enviados</h2>${monthlySubmissionArchive(items, false)}</div>`;
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
    addAdminFileRemovalButtons();
    addWorkerRemovalButtons();
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

function updateValuationComparison() {
  const result = document.getElementById('valuationComparison');
  const plannedInput = document.getElementById('valuationPlanned');
  const actualInput = document.getElementById('valuationActual');
  const filePlannedInput = document.getElementById('valuationFilePlanned');
  const fileActualInput = document.getElementById('valuationFileActual');
  if (!result || !plannedInput || !actualInput || !filePlannedInput || !fileActualInput) return null;
  const values = [plannedInput, actualInput, filePlannedInput, fileActualInput].map(input => input.value.trim());
  if (values.some(value => value === '')) {
    result.className = 'notice';
    result.textContent = 'Ingresa los porcentajes registrados y los que aparecen en el archivo para compararlos.';
    return null;
  }
  const [planned, actual, filePlanned, fileActual] = values.map(Number);
  const plannedDiff = filePlanned - planned;
  const actualDiff = fileActual - actual;
  const matches = Math.abs(plannedDiff) < 0.005 && Math.abs(actualDiff) < 0.005;
  const signed = value => `${value > 0 ? '+' : ''}${value.toFixed(2)} puntos`;
  result.className = matches ? 'approved-comparison' : 'notice';
  result.textContent = matches
    ? `Coincide: programado ${planned.toFixed(2)}% y ejecutado ${actual.toFixed(2)}% en ambos registros.`
    : `Diferencia detectada · Programado: ${planned.toFixed(2)}% en el formulario y ${filePlanned.toFixed(2)}% en el archivo (${signed(plannedDiff)}). Ejecutado: ${actual.toFixed(2)}% en el formulario y ${fileActual.toFixed(2)}% en el archivo (${signed(actualDiff)}).`;
  return { planned, actual, filePlanned, fileActual, plannedDiff, actualDiff, matches };
}

let valuationFileScan = 0;
async function valuationFileFingerprint(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let first = 2166136261;
  let second = 5381;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 16777619) >>> 0;
    second = (Math.imul(second, 33) ^ byte) >>> 0;
  }
  return { key: `${file.size}:${first}:${second}`, bytes };
}

async function renderValuationFileList() {
  const input = document.getElementById('valuationFile');
  const root = document.getElementById('valuationFileList');
  if (!input || !root) return;
  const scan = ++valuationFileScan;
  const files = Array.from(input.files || []);
  if (!files.length) { root.innerHTML = ''; return; }
  root.innerHTML = '<div class="mini">Revisando si hay archivos repetidos…</div>';
  const fingerprints = [];
  const duplicates = new Set();
  for (let index = 0; index < files.length; index++) {
    const current = await valuationFileFingerprint(files[index]);
    for (let previous = 0; previous < index; previous++) {
      if (fingerprints[previous].key !== current.key) continue;
      const other = fingerprints[previous].bytes;
      if (other.length === current.bytes.length && other.every((byte, byteIndex) => byte === current.bytes[byteIndex])) {
        duplicates.add(index);
        break;
      }
    }
    fingerprints.push(current);
    if (scan !== valuationFileScan) return;
  }
  root.innerHTML = files.map((file, index) => `<div class="valuation-file-row"><span>${shareEscape(file.name)} · ${(file.size / 1024 / 1024).toFixed(2)} MB${duplicates.has(index) ? ' · DUPLICADO' : ''}</span><button type="button" data-action="remove-valuation-file" data-index="${index}">${duplicates.has(index) ? 'Quitar duplicado' : 'Quitar archivo'}</button></div>`).join('') + (duplicates.size ? `<div class="notice">Se detectaron ${duplicates.size} archivo(s) idéntico(s). Quita las copias antes de enviar.</div>` : '<div class="mini">No se encontraron archivos idénticos.</div>');
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
    const reportFiles = Array.from(document.getElementById('reportFile').files || []);
    const notebookFiles = Array.from(document.getElementById('reportNotebookFile')?.files || []);
    const qualityFiles = Array.from(document.getElementById('reportQualityFile')?.files || []);
    const safetyFiles = Array.from(document.getElementById('reportSafetyFile')?.files || []);
    const files = await filesPayload({ files: [...reportFiles, ...notebookFiles, ...qualityFiles, ...safetyFiles] });
    const responsibleEmail = document.getElementById('reportResponsible').value;
    if (!responsibleEmail) throw new Error('Selecciona un responsable registrado.');
    const detailLabels = { reportPeriodStart: 'Inicio del periodo', reportPeriodEnd: 'Fin del periodo', reportPeriodSummary: 'Ejecución física y financiera', reportOccurrences: 'Ocurrencias, riesgos y acciones', reportNotebookLink: 'Enlace al cuaderno de obra digital', reportQuality: 'Calidad y ensayos', reportQualityLink: 'Enlace a información de calidad', reportSafetyEnvironment: 'Seguridad y ambiente', reportSafetyLink: 'Enlace a seguridad y ambiente', reportConclusions: 'Conclusiones', reportRecommendations: 'Recomendaciones' };
    const technicalNote = REPORT_DETAIL_FIELDS.map(id => { const value = document.getElementById(id)?.value.trim(); return value ? `${detailLabels[id]}: ${value}` : ''; }).filter(Boolean).join('\n');
    await shareApi('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('reportTitle').value,
        number: document.getElementById('reportNumber').value,
        documentDate: document.getElementById('reportDate').value,
        allowHistoricalDate: me.role === 'admin' && !!document.getElementById('allowHistoricalDate')?.checked,
        responsibleEmail,
        note: [document.getElementById('reportNote').value.trim(), technicalNote].filter(Boolean).join('\n\n'),
        files
      })
    });
    document.getElementById('reportFile').value = '';
    const notebookInput = document.getElementById('reportNotebookFile');
    if (notebookInput) notebookInput.value = '';
    const qualityInput = document.getElementById('reportQualityFile');
    if (qualityInput) qualityInput.value = '';
    const safetyInput = document.getElementById('reportSafetyFile');
    if (safetyInput) safetyInput.value = '';
    bindPendingFileRemoval();
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
    const comparison = updateValuationComparison();
    if (!comparison) throw new Error('Completa los porcentajes del formulario y los transcritos desde el archivo.');
    if (!comparison.matches && !confirm('Hay diferencias entre los porcentajes del formulario y el archivo. ¿Deseas enviar la valorización para revisión con esta observación?')) return;
    const files = await filesPayload(document.getElementById('valuationFile'));
    const responsibleEmail = document.getElementById('reportResponsible').value || me.email;
    const comparisonNote = `Formulario: programado ${comparison.planned.toFixed(2)}%, ejecutado ${comparison.actual.toFixed(2)}%. Archivo: programado ${comparison.filePlanned.toFixed(2)}%, ejecutado ${comparison.fileActual.toFixed(2)}%. Diferencias (archivo menos formulario): programado ${comparison.plannedDiff.toFixed(2)} y ejecutado ${comparison.actualDiff.toFixed(2)} puntos.`;
    const valuationLabels = { valuationMonthlyPlanned: 'Avance mensual programado (%)', valuationMonthlyActual: 'Avance mensual ejecutado (%)', valuationAmount: 'Monto valorizado del periodo (S/)', valuationCumulativeAmount: 'Monto valorizado acumulado (S/)', valuationFinancialProgress: 'Avance financiero acumulado (%)', valuationMeasurements: 'Metrados / partidas', valuationPaymentStatus: 'Estado de trámite / pago' };
    const valuationDetailNote = VALUATION_DETAIL_FIELDS.map(id => { const value = document.getElementById(id)?.value.trim(); return value ? `${valuationLabels[id]}: ${value}` : ''; }).filter(Boolean).join('\n');
    await shareApi('/api/submissions', { method: 'POST', body: JSON.stringify({
      kind: 'valuation',
      title: document.getElementById('valuationNumber').value,
      valuationNumber: document.getElementById('valuationNumber').value,
      valuationPeriod: document.getElementById('valuationPeriod').value,
      valuationDue: document.getElementById('valuationDue').value,
      plannedProgress: document.getElementById('valuationPlanned').value,
      actualProgress: document.getElementById('valuationActual').value,
      documentDate: document.getElementById('valuationPeriod').value,
      allowHistoricalDate: me.role === 'admin' && !!document.getElementById('allowHistoricalDate')?.checked,
      responsibleEmail,
      note: [comparisonNote, valuationDetailNote, document.getElementById('valuationNote').value.trim()].filter(Boolean).join('\n'),
      files
    }) });
    document.getElementById('valuationFile').value = '';
    document.getElementById('valuationForm').reset();
    renderValuationFileList();
    updateValuationComparison();
    if (currentUser?.role === 'staff') await saveWorkerDraft();
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
    const orderNumber = document.getElementById('conformityTitle').value.trim();
    const provider = document.getElementById('conformityProvider').value.trim();
    const amount = document.getElementById('conformityAmount').value;
    const note = document.getElementById('conformityNote').value.trim();
    await shareApi('/api/submissions', { method: 'POST', body: JSON.stringify({
      kind: 'conformity',
      category,
      number: orderNumber,
      title: `Orden N.º ${orderNumber}`,
      conformityDate: document.getElementById('conformityDate').value,
      conformityDue: document.getElementById('conformityDue').value,
      allowHistoricalDate: me.role === 'admin' && !!document.getElementById('allowHistoricalDate')?.checked,
      responsibleEmail: me.email,
      note: [`Proveedor: ${provider}`, amount ? `Monto: S/ ${amount}` : '', note].filter(Boolean).join(' · '),
      files
    }) });
    document.getElementById('conformityFile').value = '';
    event.target.reset();
    bindPendingFileRemoval();
    await renderControlInbox();
    await refreshSharedReportView();
    toast('Orden enviada para revisión.');
  } catch (error) {
    toast(error.message);
  }
}
prepareControlInbox();
prepareProjectForm();
const reportTechnicalContent = document.getElementById('reportTechnicalContent');
if (reportTechnicalContent) {
  reportTechnicalContent.open = true;
  reportTechnicalContent.addEventListener('toggle', () => { if (!reportTechnicalContent.open) reportTechnicalContent.open = true; });
  const reportCard = document.getElementById('reportForm')?.closest('.card');
  const reportRow = reportCard?.parentElement;
  const valuationCard = document.getElementById('valuationForm')?.closest('.card');
  if (reportRow && valuationCard) {
    let row = document.getElementById('reportTechnicalValuationRow');
    if (!row) {
      row = document.createElement('div');
      row.id = 'reportTechnicalValuationRow';
      row.className = 'grid2';
    }
    reportTechnicalContent.classList.remove('field');
    reportTechnicalContent.classList.add('card');
    row.append(valuationCard, reportTechnicalContent);
    row.style.display = 'grid';
    row.style.width = '100%';
    if (row.parentElement !== reportRow.parentElement || row.nextElementSibling !== reportRow) {
      reportRow.insertAdjacentElement('beforebegin', row);
    }
  }
}
const sharedReportForm = document.getElementById('reportForm');
if (sharedReportForm) sharedReportForm.onsubmit = submitSharedReport;
const valuationForm = document.getElementById('valuationForm');
if (valuationForm) valuationForm.onsubmit = submitSharedValuation;
['valuationPlanned','valuationActual','valuationFilePlanned','valuationFileActual'].forEach(id => document.getElementById(id)?.addEventListener('input', updateValuationComparison));
document.getElementById('valuationFile')?.addEventListener('change', renderValuationFileList);
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
  const isEntryAction = action === 'login' || action === 'activate';
  const originalButtonText = button.textContent;
  if (isEntryAction) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = action === 'login' ? 'Ingresando…' : 'Activando cuenta…';
    const status = document.getElementById(action === 'login' ? 'entryMessage' : 'activationMessage');
    if (status) {
      status.classList.remove('is-error');
      status.classList.add('is-pending');
      status.textContent = action === 'login'
        ? 'Conectando con el servidor… espera un momento.'
        : 'Enviando los datos y creando la cuenta… espera un momento.';
    }
  }
  try {
    if (action === 'clear-section') {
      if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede limpiar información.');
      const section = button.dataset.section;
      const clearMessages = {
        project: 'Se borrarán los datos generales y técnicos del proyecto. Se conservarán trabajadores, historial y entregas.',
        'project-general': 'Se borrarán solo nombre, entidad, modalidad, ubicación, código y descripción del proyecto.',
        'project-technical': 'Se borrarán solo los datos técnicos del proyecto. Los datos generales y entregas se conservarán.',
        'project-workers': 'Se borrarán todas las personas registradas en el equipo del proyecto.',
        control: 'Se borrarán los borradores sin enviar de los formularios de Control de todas las cuentas. Las entregas ya enviadas se conservarán.',
        'control-report': 'Se borrarán los borradores de informe de todas las cuentas. Los informes enviados se conservarán.',
        'control-valuation': 'Se borrarán los borradores de valorización de todas las cuentas. Las valorizaciones enviadas se conservarán.',
        'control-conformity': 'Se borrarán los borradores de órdenes de todas las cuentas. Las órdenes enviadas se conservarán.',
        informe: 'Se borrarán las actividades, comentarios y fuentes semanales. El informe seguirá mostrando los datos del proyecto y las entregas que se conserven.',
        'informe-activities': 'Se borrarán las actividades. Los comentarios y entregas se conservarán.',
        'informe-comments': 'Se borrarán los comentarios. Las actividades y entregas se conservarán.',
        'informe-history': 'Se borrará el historial anterior. Quedará un registro que indica que se reinició.',
        'informe-sources': 'Se borrarán las fuentes semanales. Las actividades, comentarios y entregas se conservarán.',
        'entregas-informes': 'Se borrarán todos los informes recibidos y sus archivos. Las valorizaciones y órdenes se conservarán.',
        'entregas-valorizaciones': 'Se borrarán todas las valorizaciones recibidas y sus archivos. Los informes y órdenes se conservarán.',
        'entregas-conformidades': 'Se borrarán todas las órdenes y conformidades recibidas y sus archivos.',
        entregas: 'Se borrarán todos los informes, valorizaciones, órdenes y archivos adjuntos. Esta acción no se puede deshacer. Descarga antes una copia si necesitas conservarlos.'
      };
      if (!clearMessages[section]) throw new Error('No reconozco el apartado que quieres limpiar.');
      if (!window.confirm(clearMessages[section] + '\n\n¿Deseas continuar?')) return;
      await shareApi('/api/reset-section', { method: 'POST', body: JSON.stringify({ section }) });
      if (section === 'control') {
        workerDraft = { report: {}, valuation: {}, conformity: {} };
        ['reportForm','valuationForm','conformityForm'].forEach(id => document.getElementById(id)?.reset());
        if (document.getElementById('reportDate')) document.getElementById('reportDate').value = today();
        if (document.getElementById('valuationPeriod')) document.getElementById('valuationPeriod').value = today();
      } else if (section.startsWith('control-')) {
        const draftSection = { 'control-report': ['report','reportForm','reportDate'], 'control-valuation': ['valuation','valuationForm','valuationPeriod'], 'control-conformity': ['conformity','conformityForm','conformityDate'] }[section];
        if (draftSection) {
          workerDraft[draftSection[0]] = {};
          document.getElementById(draftSection[1])?.reset();
          const dateInput = document.getElementById(draftSection[2]);
          if (dateInput) dateInput.value = today();
        }
      }
      await refreshAfterSectionClear();
      if (section === 'informe-comments') document.getElementById('commentForm')?.reset();
      toast(section.startsWith('entregas') ? 'Entregas seleccionadas y archivos eliminados.' : 'Sección limpiada. El historial de cambios se conservó.');
    } else if (action === 'delete-submission') {
      if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede eliminar entregas.');
      if (!window.confirm('Se eliminará esta entrega y los archivos que ya no se usen. El historial se conservará. ¿Deseas continuar?')) return;
      await shareApi('/api/reset-section', { method: 'POST', body: JSON.stringify({ section: 'submission', id: button.dataset.id }) });
      await refreshAfterSectionClear();
      toast('Entrega eliminada. El historial de cambios se conservó.');
   } else if (action === 'download-project-backup') {
      if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede descargar el respaldo completo.');
      const blob = await shareApi('/api/backup/download', { method: 'POST', body: JSON.stringify({}) });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const projectSlug = String(project?.name || 'proyecto').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'proyecto';
      link.download = `respaldo-${projectSlug}-${today()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 30000);
      toast('Respaldo completo descargado. Puedes guardarlo antes de iniciar otro proyecto.');
    } else if (action === 'preview-report-template') {
      const requestedType = button.dataset.template;
      const selectedPeriod = ['monthly','supervisorMonthly','contractMonthly','contractSupervisorMonthly'].includes(requestedType) ? applySelectedReportMonth() : null;
      const previewWindow = window.open('', '_blank');
      if (!previewWindow) { toast('El navegador bloqueó la ventana. Permite ventanas emergentes para ver el informe.'); return; }
      previewWindow.document.write('<!doctype html><html lang="es"><meta charset="utf-8"><title>Abriendo informe</title><body style="font:16px Arial,sans-serif;padding:28px;color:#243945">Cargando el informe…</body></html>');
      let templates;
      let liveState;
      let registeredItems;
      try {
        [templates, liveState, registeredItems] = await Promise.all([
          shareApi('/api/templates'), shareApi('/api/live'), shareApi('/api/technical-summary')
        ]);
      } catch (error) {
        previewWindow.document.body.innerHTML = `<p>No se pudo cargar el informe: ${shareEscape(error.message)}</p><p>Deja esta ventana abierta y vuelve a intentarlo.</p>`;
        throw error;
      }
      const type = requestedType;
      if (!templates[type]) throw new Error('Selecciona una plantilla válida en Proyecto.');
      const titles = {
        monthly: 'Vista previa · Informe mensual del residente',
        final: 'Vista previa · Informe Final de Obra / preliquidación',
        supervisorMonthly: 'Vista previa · Informe mensual de supervisión (Anexo 13)',
        supervisorFinal: 'Vista previa · Pronunciamiento del supervisor sobre el Informe Final de Obra',
        contractMonthly: 'Vista previa · Informe mensual de obra por contrata (residente)',
        contractFinal: 'Vista previa · Informe de cierre de obra por contrata (residente)',
        contractSupervisorMonthly: 'Vista previa · Informe mensual de supervisión de obra por contrata',
        contractSupervisorFinal: 'Vista previa · Cierre y pronunciamiento de supervisión por contrata'
      };
      const title = titles[type] + (selectedPeriod ? ` · ${submissionMonthLabel(selectedPeriod.month)}` : '');
      const completedTemplate = fillReportTemplateFromProject(templates[type] || '', registeredItems, liveState, type);
      const periodNote = selectedPeriod ? `<p class="mini"><b>Periodo incluido:</b> ${selectedPeriod.start} al ${selectedPeriod.end}. Se usan solo entregas dentro de estas fechas y del proyecto.</p>` : '';
      const content = periodNote + reportTemplatePreviewHtml(completedTemplate);
      previewWindow.document.open();
      previewWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:15px Arial,sans-serif;line-height:1.55;color:#243945;max-width:1000px;margin:28px auto;padding:0 20px}h1,h2,h3,h4{color:#1b416f;line-height:1.25}h1{font-size:25px;margin-top:30px}h2{font-size:21px;margin-top:25px}h3{font-size:18px;margin-top:22px}p{margin:8px 0}hr{border:0;border-top:1px solid #d6e1e4;margin:24px 0}.item{border:1px solid #d6e1e4;border-radius:8px;padding:12px 16px;margin:12px 0;background:#fbfdfd}.mini{color:#627780;font-size:13px}a{color:#176bd8;overflow-wrap:anywhere}.report-map-preview{margin:14px 0;padding:12px;border:1px solid #d7e5e7;border-radius:10px;background:#f6fbfb}.report-map-preview b,.report-map-preview a{display:block;margin-bottom:8px}.report-map-preview iframe{display:block;width:100%;height:320px;border:0;border-radius:7px;background:#edf3f3}.print{position:sticky;top:10px;float:right;padding:10px 14px;border:0;border-radius:8px;background:#176bd8;color:#fff;cursor:pointer}@media print{body{margin:0 auto}.print{display:none}.report-map-preview iframe{height:250px}}</style></head><body><button class="print" onclick="window.print()">Imprimir / Guardar PDF</button><h1>${title}</h1>${content}</body></html>`);
      previewWindow.document.close();
    } else if (action === 'download-report-template') {
      if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede descargar las plantillas.');
      const type = button.dataset.template;
      const selectedPeriod = ['monthly','supervisorMonthly','contractMonthly','contractSupervisorMonthly'].includes(type) ? applySelectedReportMonth() : null;
      if (!['monthly', 'final', 'supervisorMonthly', 'supervisorFinal','contractMonthly','contractFinal','contractSupervisorMonthly','contractSupervisorFinal'].includes(type)) throw new Error('Selecciona una plantilla válida en Proyecto.');
      const result = await shareApi('/api/templates/download', { method: 'POST', body: JSON.stringify({ type }) });
      const [liveState, registeredItems] = await Promise.all([shareApi('/api/live'), shareApi('/api/technical-summary')]);
      const fullDocument = fillReportTemplateFromProject(result.template || '', registeredItems, liveState, type);
      const blob = new Blob([reportTemplateToRtf(fullDocument)], { type: 'application/rtf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filenames = {
        monthly: 'Plantilla-informe-mensual-residente.rtf',
        final: 'Plantilla-informe-final-obra-preliquidacion.rtf',
        supervisorMonthly: 'Plantilla-informe-mensual-supervision-anexo-13.rtf',
        supervisorFinal: 'Plantilla-pronunciamiento-supervision-informe-final-obra.rtf',
        contractMonthly: 'Plantilla-mensual-obra-por-contrata-residente.rtf',
        contractFinal: 'Plantilla-cierre-obra-por-contrata-residente.rtf',
        contractSupervisorMonthly: 'Plantilla-mensual-supervision-obra-por-contrata.rtf',
        contractSupervisorFinal: 'Plantilla-cierre-supervision-obra-por-contrata.rtf'
      };
      link.download = selectedPeriod ? filenames[type].replace('.rtf', `-${selectedPeriod.month}.rtf`) : filenames[type];
      link.click();
      URL.revokeObjectURL(url);
    } else if (action === 'set-person-role') {
      const roleName = button.dataset.role === 'admin' ? 'administrador' : 'trabajador';
      await shareApi('/api/people/role', { method: 'POST', body: JSON.stringify({ email: button.dataset.email, role: button.dataset.role }) });
      await renderShare();
      shareMessage(`Permiso actualizado: ahora esta persona es ${roleName}.`);
    } else if (action === 'remove-person') {
      if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede retirar trabajadores del proyecto.');
      const personName = button.dataset.name || button.dataset.email;
      if (!confirm(`¿Retirar a ${personName} del proyecto? Perderá el acceso, pero sus informes y archivos se conservarán.`)) return;
      await shareApi('/api/people/remove', { method: 'POST', body: JSON.stringify({ email: button.dataset.email }) });
      const removedEmail = String(button.dataset.email || '').toLowerCase();
      window.projectTeamAccounts = (window.projectTeamAccounts || []).filter(person => String(person.email || '').toLowerCase() !== removedEmail);
      button.closest('.worker-card, .item')?.remove();
      const [snapshot, people] = await Promise.all([shareApi('/api/live'), shareApi('/api/people')]);
      window.projectTeamAccounts = people;
      renderLiveSnapshot(snapshot);
      await renderShare();
      toast('Trabajador retirado del proyecto. Sus entregas siguen guardadas.');
    } else if (action === 'refresh-tech-report') {
      const me = await shareApi('/api/me');
      const items = await shareApi(me.role === 'admin' ? '/api/submissions' : '/api/technical-summary');
      technicalSummaryItems = items;
      if (me.role === 'admin') sharedReportItems = items;
      const panel = document.getElementById('technicalReportSummary');
      if (panel) panel.outerHTML = technicalSummaryMarkup(items, me.role === 'admin');
      shareMessage('Resumen técnico actualizado con las entregas disponibles.');
    } else if (action === 'print-tech-report') {
      if (currentUser?.role !== 'admin') throw new Error('La impresión del resumen está reservada al administrador.');
      printTechnicalReport(technicalSummaryItems, true);
    } else if (action === 'setup') {
      await shareApi('/api/setup', { method: 'POST', body: JSON.stringify({ email: document.getElementById('adminEmail').value, password: document.getElementById('adminPassword').value, confirm: document.getElementById('adminConfirm').value }) });
      await renderEntryGate('Cuenta creada. Entra con la contraseña que acabas de elegir.');
      const emailInput = document.getElementById('loginEmail');
      if (emailInput) emailInput.value = 'brandonlasteros31@gmail.com';
    } else if (action === 'login') {
      const result = await shareApi('/api/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value }) });
      sessionStorage.setItem(SHARE_TOKEN, result.token);
      setTopLogoutVisible(true);
      await loadSharedProject();
      await renderShare();
      await renderControlInbox();
      closeEntryGate();
    } else if (action === 'activate') {
      const email = document.getElementById('activateEmail').value;
      await shareApi('/api/activate', { method: 'POST', body: JSON.stringify({ name: document.getElementById('activateName').value, email: document.getElementById('activateEmail').value, code: document.getElementById('inviteCode').value, password: document.getElementById('activatePassword').value, confirm: document.getElementById('activateConfirm').value }) });
      await renderEntryGate('Cuenta activada. Ahora inicia sesión con tu correo y contraseña.');
      document.getElementById('loginEmail').value = email;
    } else if (action === 'save-name') {
      await shareApi('/api/profile', { method: 'POST', body: JSON.stringify({ name: document.getElementById('profileName').value, avatar: profileAvatarDraft || '' }) });
      await renderShare();
      await loadSharedProject();
      shareMessage('Perfil guardado. El avatar ya aparece en Trabajadores y responsables.');
    } else if (action === 'remove-avatar') {
      profileAvatarDraft = '';
      const avatarInput = document.getElementById('profileAvatar');
      if (avatarInput) avatarInput.value = '';
      const preview = document.querySelector('.profile-avatar-preview');
      if (preview) { const empty = document.createElement('div'); empty.className = 'profile-avatar-preview profile-avatar-empty'; empty.textContent = '+'; preview.replaceWith(empty); }
      shareMessage('Avatar quitado. Guarda el perfil para confirmar el cambio.');
    } else if (action === 'logout') {
      await shareApi('/api/logout', { method: 'POST' });
      sessionStorage.removeItem(SHARE_TOKEN);
      setTopLogoutVisible(false);
      if (liveSyncTimer) clearInterval(liveSyncTimer);
      liveSyncTimer = null;
      currentUser = null;
      updateSectionClearButtons();
      workerDraftLoadedFor = '';
      await renderEntryGate();
    } else if (action === 'invite' || action === 'invite-existing') {
      const email = action === 'invite' ? document.getElementById('newPersonEmail').value : button.dataset.email;
      const result = await shareApi('/api/invite', { method: 'POST', body: JSON.stringify({ email }) });
      await renderShare();
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
    } else if (action === 'download-approved-dashboard') {
      if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede descargar este resumen.');
      await refreshSharedReportView();
      if (currentUser?.role !== 'admin') throw new Error('La sesión de administrador ya no está activa.');
      const approved = sharedReportItems.filter(item => item.status === 'Aprobada');
      const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
      const rows = [
        ['Tipo', 'Título', 'Estado', 'Responsable', 'Correo', 'Fecha', 'Avance ejecutado (%)'],
        ...approved.map(item => [
          item.kind === 'valuation' ? 'Valorización' : item.kind === 'conformity' ? 'Conformidad' : 'Informe',
          item.title || item.valuationNumber && `Valorización N.º ${item.valuationNumber}` || item.conformityCategory || 'Entrega aprobada',
          item.status,
          item.responsibleName || item.submitterName || '',
          item.responsibleEmail || item.email || '',
          item.documentDate || item.valuationPeriod || item.conformityDate || item.created || '',
          item.kind === 'valuation' ? item.actualProgress ?? '' : ''
        ])
      ];
      const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.download = `resumen-aprobaciones-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } else if (action === 'toggle-submission-details') {
      const details = document.getElementById(`submission-details-${button.dataset.id}`);
      if (!details) return;
      const expand = details.classList.contains('hidden');
      details.classList.toggle('hidden', !expand);
      button.textContent = expand ? 'Contraer' : 'Desplegar';
      button.setAttribute('aria-expanded', String(expand));
    } else if (action === 'delete-file') {
      if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede eliminar archivos enviados.');
      const fileName = button.dataset.name || 'este archivo';
      if (!confirm(`¿Eliminar "${fileName}"? La entrega y sus otros archivos se conservarán.`)) return;
      await shareApi(`/api/submissions/${button.dataset.submissionId}/files/${button.dataset.id}/delete`, { method: 'POST' });
      await renderShare();
      await refreshSharedReportView();
      toast('Archivo eliminado.');
    } else if (action === 'remove-pending-file') {
      const input = document.getElementById(button.dataset.input);
      const removeIndex = Number(button.dataset.index);
      const files = Array.from(input?.files || []);
      if (!input || !Number.isInteger(removeIndex) || !files[removeIndex]) return;
      const transfer = new DataTransfer();
      files.forEach((file, index) => { if (index !== removeIndex) transfer.items.add(file); });
      input.files = transfer.files;
      renderPendingFileList(input);
    } else if (action === 'remove-valuation-file') {
      const input = document.getElementById('valuationFile');
      const removeIndex = Number(button.dataset.index);
      const files = Array.from(input?.files || []);
      if (!input || !Number.isInteger(removeIndex) || !files[removeIndex]) return;
      const transfer = new DataTransfer();
      files.forEach((file, index) => { if (index !== removeIndex) transfer.items.add(file); });
      input.files = transfer.files;
      await renderValuationFileList();
    } else if (action === 'download-month') {
      const blob = await shareApi('/api/submissions/month-download', { method: 'POST', body: JSON.stringify({ month: button.dataset.month }) });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `entregas-${button.dataset.month}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 30000);
    } else if (action === 'download') {
      const blob = await shareApi(`/api/files/${button.dataset.id}`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = button.dataset.name;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  } catch (error) {
    if (isEntryAction) {
      if (action === 'login') {
        sessionStorage.removeItem(SHARE_TOKEN);
        setTopLogoutVisible(false);
      }
      const status = document.getElementById(action === 'login' ? 'entryMessage' : 'activationMessage');
      if (status) {
        status.classList.remove('is-pending');
        status.classList.add('is-error');
        status.textContent = error.message || 'No se pudo completar la solicitud. Vuelve a intentarlo.';
      } else {
        shareMessage(error.message, true);
      }
    } else {
      shareMessage(error.message, true);
    }
  } finally {
    if (isEntryAction && button.isConnected) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = originalButtonText;
    }
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
