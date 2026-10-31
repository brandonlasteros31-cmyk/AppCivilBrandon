/* Almacenamiento local para abrir el programa directamente en el navegador. */
(function () {
  if (location.protocol !== 'file:') return;

  const DB_NAME = 'CentroControlObra-Local';
  const STORE = 'estado';
  const FILES = 'archivos';
  const SESSION = 'cc_share_token';
  let database;
  let writeQueue = Promise.resolve();

  function openDatabase() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('Este navegador no permite guardar datos locales. Abre el archivo con Chrome o Edge.')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('No se pudo abrir el guardado de este navegador.'));
    });
    return database;
  }

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function requestValue(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }

  async function readState() {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readonly');
    const row = await requestValue(tx.objectStore(STORE).get('main'));
    if (row?.value) return row.value;
    const seed = window.CENTRO_OFFLINE_SEED || {};
    const state = clone(seed.state || {});
    state.project ||= {};
    state.workspace ||= { workers: [], activities: [], comments: [], sources: { byWeek: {} } };
    state.workspace.workers ||= [];
    state.workspace.activities ||= [];
    state.workspace.comments ||= [];
    state.workspace.sources ||= { byWeek: {} };
    if (!state.workspace.sources.byWeek) state.workspace.sources = { byWeek: {} };
    state.users ||= [];
    state.allowedEmails ||= [];
    state.invitations ||= [];
    state.submissions ||= [];
    state.auditLog ||= [];
    state.revision ||= 1;
    const admin = state.users.find(user => user.role === 'admin') || {
      email: 'administrador@local', displayName: 'Administrador local', role: 'admin', created: new Date().toISOString(), draft: {}
    };
    if (!state.users.some(user => user.role === 'admin')) state.users.unshift(admin);
    state.users = state.users.map(user => {
      const { salt, hash, passwordSalt, passwordHash, ...localUser } = user;
      return localUser;
    });
    state.allowedEmails = Array.from(new Set([...(state.allowedEmails || []), admin.email]));
    state.invitations = [];
    const db2 = await openDatabase();
    const tx2 = db2.transaction([STORE, FILES], 'readwrite');
    tx2.objectStore(STORE).put({ key: 'main', value: state });
    const initialFiles = seed.files || {};
    for (const [id, encoded] of Object.entries(initialFiles)) {
      const bytes = base64Bytes(encoded);
      tx2.objectStore(FILES).put({ id, blob: new Blob([bytes]) });
    }
    await new Promise((resolve, reject) => { tx2.oncomplete = resolve; tx2.onerror = () => reject(tx2.error); tx2.onabort = () => reject(tx2.error); });
    sessionStorage.setItem(SESSION, 'offline-local');
    return state;
  }

  async function saveState(state) {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key: 'main', value: state });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }

  function writeState(change) {
    const operation = writeQueue.then(async () => {
      const state = await readState();
      const result = await change(state);
      await saveState(state);
      return result;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function id() { return crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 22)}`.slice(0, 32); }
  function actor(state) { return state.users.find(user => user.role === 'admin') || { email: 'administrador@local', displayName: 'Administrador local', role: 'admin' }; }
  function audit(state, action, detail = '') {
    state.revision = Number(state.revision || 0) + 1;
    state.auditLog ||= [];
    state.auditLog.push({ id: id(), at: new Date().toISOString(), actor: actor(state).email, action, detail: String(detail).slice(0, 2000), revision: state.revision });
    if (state.auditLog.length > 1000) state.auditLog = state.auditLog.slice(-1000);
  }
  function fail(message) { throw new Error(message); }
  function getUser(state) {
    const email = sessionStorage.getItem('cc_offline_user') || actor(state).email;
    return state.users.find(user => user.email === email) || actor(state);
  }
  function isAdmin(state) { return getUser(state).role === 'admin'; }
  function requireAdmin(state) { if (!isAdmin(state)) fail('Esta acción es solo para el administrador local.'); }
  function parseBody(options) { try { return options?.body ? JSON.parse(options.body) : {}; } catch { return {}; } }
  function peopleList(state) {
    return state.allowedEmails.map(email => {
      const user = state.users.find(account => account.email.toLowerCase() === String(email).toLowerCase());
      return { email, displayName: user?.displayName || email, avatar: user?.avatar || '', active: !!user, role: user?.role || 'Invitación pendiente' };
    });
  }
  function sourceWeek(state, weekKey) {
    const byWeek = state.workspace.sources?.byWeek || {};
    return byWeek[weekKey] || { reports: '', activities: '', comments: '', other: '' };
  }
  function submissionDate(item) { return item.kind === 'valuation' ? item.valuationPeriod : item.kind === 'conformity' ? item.conformityDate : item.documentDate; }
  function userSubmissions(state) {
    const user = getUser(state);
    return (state.submissions || []).filter(item => user.role === 'admin' || item.email === user.email).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  }
  function technicalSummary(state) {
    return [...(state.submissions || [])].sort((a, b) => String(a.created).localeCompare(String(b.created))).map(item => ({
      kind: item.kind, title: item.title, number: item.number, documentDate: item.documentDate, valuationNumber: item.valuationNumber,
      valuationPeriod: item.valuationPeriod, plannedProgress: item.plannedProgress, actualProgress: item.actualProgress,
      conformityCategory: item.conformityCategory, responsibleEmail: item.responsibleEmail, responsibleName: item.responsibleName,
      submitterName: item.submitterName, email: item.email, note: item.note, created: item.created, status: item.status,
      files: (item.files || []).map(file => ({ name: file.name })), review: isAdmin(state) ? item.review : ''
    }));
  }

  function base64Bytes(value) {
    const raw = atob(value || '');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function cleanName(value) { return String(value || 'archivo').replace(/[\x00-\x1f\\/:*?"<>|]/g, '_').trim().replace(/[. ]+$/g, '') || 'archivo'; }
  async function getFile(fileId) {
    const db = await openDatabase();
    return requestValue(db.transaction(FILES, 'readonly').objectStore(FILES).get(fileId));
  }
  async function putFile(fileId, data) {
    const bytes = base64Bytes(data);
    const db = await openDatabase();
    const tx = db.transaction(FILES, 'readwrite');
    tx.objectStore(FILES).put({ id: fileId, blob: new Blob([bytes]) });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    return bytes.byteLength;
  }
  async function deleteIfUnused(state, fileId) {
    if ((state.submissions || []).some(item => (item.files || []).some(file => file.id === fileId))) return;
    const db = await openDatabase();
    const tx = db.transaction(FILES, 'readwrite');
    tx.objectStore(FILES).delete(fileId);
    await new Promise(resolve => { tx.oncomplete = resolve; tx.onerror = resolve; });
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; }
    return table;
  })();
  function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
  function zipStore(entries) {
    const encoder = new TextEncoder();
    const localParts = [], centralParts = [];
    let offset = 0;
    const u16 = (view, at, value) => view.setUint16(at, value, true);
    const u32 = (view, at, value) => view.setUint32(at, value, true);
    for (const entry of entries) {
      const name = encoder.encode(entry.name.replace(/\\/g, '/'));
      const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
      const crc = crc32(bytes);
      const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
      u32(lv,0,0x04034b50); u16(lv,4,20); u16(lv,6,0); u16(lv,8,0); u16(lv,10,0); u16(lv,12,0x21); u32(lv,14,crc); u32(lv,18,bytes.length); u32(lv,22,bytes.length); u16(lv,26,name.length); u16(lv,28,0); local.set(name,30);
      localParts.push(local,bytes);
      const central = new Uint8Array(46 + name.length); const cv = new DataView(central.buffer);
      u32(cv,0,0x02014b50); u16(cv,4,20); u16(cv,6,20); u16(cv,8,0); u16(cv,10,0); u16(cv,12,0); u16(cv,14,0x21); u32(cv,16,crc); u32(cv,20,bytes.length); u32(cv,24,bytes.length); u16(cv,28,name.length); u16(cv,30,0); u16(cv,32,0); u16(cv,34,0); u16(cv,36,0); u32(cv,38,0); u32(cv,42,offset); central.set(name,46);
      centralParts.push(central);
      offset += local.length + bytes.length;
    }
    const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    u32(ev,0,0x06054b50); u16(ev,4,0); u16(ev,6,0); u16(ev,8,entries.length); u16(ev,10,entries.length); u32(ev,12,centralSize); u32(ev,16,offset); u16(ev,20,0);
    return new Blob([...localParts,...centralParts,end], { type: 'application/zip' });
  }
  function utf8(value) { return new TextEncoder().encode(value); }
  function projectFolder(state) { return cleanName(state.project?.name || 'Proyecto-sin-nombre'); }
  async function createBackup(state, items = state.submissions || []) {
    const root = projectFolder(state);
    const files = [];
    const manifest = [];
    for (const item of items) for (const file of item.files || []) {
      const saved = await getFile(file.id);
      const date = String(submissionDate(item) || item.created || 'sin-fecha');
      const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0,7) : 'sin-fecha';
      const kind = item.kind === 'valuation' ? 'Valorizaciones' : item.kind === 'conformity' ? 'Conformidades' : 'Informes';
      const path = `${root}/archivos/${month}/${kind}/${cleanName(item.title || 'Entrega')}-${String(item.id).slice(0,8)}/${cleanName(file.name)}`;
      if (saved?.blob) files.push({ name: path, bytes: new Uint8Array(await saved.blob.arrayBuffer()) });
      manifest.push({ submissionId: item.id, document: item.title, originalFileName: file.name, included: !!saved?.blob, archivePath: saved?.blob ? path : '' });
    }
    const users = (state.users || []).map(user => ({ email:user.email, displayName:user.displayName, role:user.role, active:true, avatar:user.avatar || '', draft:user.draft || {} }));
    const backup = { format:'Centro de Control de Obra - Respaldo local completo', exportedAt:new Date().toISOString(), revision:state.revision, project:state.project, workspace:state.workspace, authorizedEmails:state.allowedEmails, users, submissions:items, auditLog:state.auditLog, files:manifest };
    files.push({ name:`${root}/respaldo/datos-proyecto.json`, bytes:utf8(JSON.stringify(backup,null,2)) });
    files.push({ name:`${root}/LEEME.txt`, bytes:utf8(`Copia local completa del proyecto ${root}.\r\n\r\nIncluye respaldo/datos-proyecto.json y los documentos adjuntos ordenados por mes. Extrae el ZIP para ver la carpeta del proyecto.\r\n`) });
    return zipStore(files);
  }

  function summaryItem(item) {
    return { kind:item.kind, title:item.title, number:item.number, documentDate:item.documentDate, valuationNumber:item.valuationNumber, valuationPeriod:item.valuationPeriod, plannedProgress:item.plannedProgress, actualProgress:item.actualProgress, conformityCategory:item.conformityCategory, responsibleEmail:item.responsibleEmail, responsibleName:item.responsibleName, submitterName:item.submitterName, email:item.email, note:item.note, created:item.created, status:item.status, files:(item.files||[]).map(file=>({name:file.name})), review:item.review };
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const data = parseBody(options);
    sessionStorage.setItem(SESSION, 'offline-local');
    const state = await readState();
    const user = getUser(state);
    const projectName = path.match(/^\/api\/submissions\/([0-9a-f]{32})\/(review|edit-request|edit-decision|edit)$/i);
    const fileDelete = path.match(/^\/api\/submissions\/([0-9a-f]{32})\/files\/([0-9a-f]{32})\/delete$/i);
    const fileDownload = path.match(/^\/api\/files\/([0-9a-f]{32})$/i);

    if (path === '/api/status') return { setup:false, adminEmail:actor(state).email };
    if (path === '/api/me') return { email:user.email, displayName:user.displayName || user.email, role:user.role, avatar:user.avatar || '' };
    if (path === '/api/logout') { sessionStorage.setItem(SESSION,'offline-local'); sessionStorage.setItem('cc_offline_user',actor(state).email); return { ok:true }; }
    if (path === '/api/login' && method === 'POST') {
      const account = state.users.find(item => item.email.toLowerCase() === String(data.email).trim().toLowerCase());
      if (!account) fail('No encuentro esa cuenta local.');
      if (account.passwordHash && account.passwordHash !== await passwordHash(data.password, account.passwordSalt)) fail('Contraseña incorrecta.');
      sessionStorage.setItem('cc_offline_user', account.email); return { token:'offline-local', email:account.email, role:account.role };
    }
    if (path === '/api/setup' && method === 'POST') return writeState(async s => {
      const email = String(data.email || '').trim().toLowerCase();
      if (!email || String(data.password || '').length < 10 || data.password !== data.confirm) fail('Escribe un correo y una contraseña de al menos 10 caracteres.');
      const salt = id(); const hash = await passwordHash(data.password,salt);
      s.users = [{ email, displayName:'Administrador local', role:'admin', passwordSalt:salt, passwordHash:hash, created:new Date().toISOString(), draft:{} }];
      s.allowedEmails = [email]; audit(s,'Administrador local creado',email); return {ok:true};
    });
    if (path === '/api/people' && method === 'GET') return peopleList(state);
    if (path === '/api/people/role' && method === 'POST') return writeState(s => {
      requireAdmin(s); const account=s.users.find(item=>item.email.toLowerCase()===String(data.email).toLowerCase());
      if (!account || !['staff','admin'].includes(data.role)) fail('No encuentro esa cuenta.');
      if (account.email===getUser(s).email && data.role==='staff') fail('No puedes quitarte el permiso de administrador.');
      const old=account.role; account.role=data.role; audit(s,'Permiso local actualizado',`${account.email}: ${old} -> ${data.role}`); return {ok:true,email:account.email,role:data.role};
    });
    if (path === '/api/people/remove' && method === 'POST') return writeState(s => {
      requireAdmin(s); const email=String(data.email||'').trim().toLowerCase();
      const account=s.users.find(item=>item.email.toLowerCase()===email);
      if (account?.role==='admin') fail('No se puede retirar una cuenta administradora.');
      const name=account?.displayName||email;
      s.users=s.users.filter(item=>item.email.toLowerCase()!==email); s.allowedEmails=s.allowedEmails.filter(item=>String(item).toLowerCase()!==email); s.invitations=s.invitations.filter(item=>String(item.email).toLowerCase()!==email);
      const before=s.workspace.workers.length; s.workspace.workers=s.workspace.workers.filter(item=>String(item.contact||'').toLowerCase()!==email&&String(item.name||'').toLowerCase()!==String(name).toLowerCase());
      audit(s,'Trabajador retirado del proyecto',`${name} (${email}); se conservaron sus entregas y archivos.`); return {ok:true,email,removedWorkers:before-s.workspace.workers.length};
    });
    if (path === '/api/invite' && method === 'POST') return writeState(s => {
      requireAdmin(s); const email=String(data.email||'').trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) fail('Escribe un correo válido.');
      const code=id().slice(0,12).toUpperCase(); s.allowedEmails=Array.from(new Set([...s.allowedEmails,email])); s.invitations=s.invitations.filter(item=>item.email!==email); s.invitations.push({email,code,used:false,created:new Date().toISOString()}); audit(s,'Invitación local creada',email); return {email,code};
    });
    if (path === '/api/activate' && method === 'POST') return writeState(async s => {
      const email=String(data.email||'').trim().toLowerCase(); const invite=s.invitations.find(item=>item.email===email&&item.code===data.code&&!item.used);
      if (!invite || !s.allowedEmails.includes(email)) fail('Correo o código de invitación incorrecto.');
      if (String(data.name||'').trim().length<2 || String(data.password||'').length<10 || data.password!==data.confirm) fail('Revisa el nombre y la contraseña (mínimo 10 caracteres).');
      const salt=id(); s.users.push({email,displayName:String(data.name).trim(),role:'staff',passwordSalt:salt,passwordHash:await passwordHash(data.password,salt),created:new Date().toISOString(),draft:{}}); invite.used=true; audit(s,'Cuenta local activada',email); return {ok:true};
    });
    if (path === '/api/profile' && method === 'POST') return writeState(s=>{ const account=s.users.find(item=>item.email===getUser(s).email); if(!account) fail('No encuentro la cuenta.'); account.displayName=String(data.name||'').trim(); account.avatar=data.avatar||''; audit(s,'Perfil actualizado',account.displayName); return {ok:true,displayName:account.displayName,avatar:account.avatar}; });

    if (path === '/api/project' && method === 'GET') return clone(state.project);
    if (path === '/api/project' && method === 'POST') return writeState(s=>{ requireAdmin(s); s.project={...s.project,...data}; if(window.CENTRO_OFFLINE_SEED?.ubigeo){ const c=window.CENTRO_OFFLINE_SEED.ubigeo; const d=c.departments.find(x=>String(x.id)===String(data.departmentCode)); const p=c.provinces.find(x=>String(x.id)===String(data.provinceCode)); const t=c.districts.find(x=>String(x.id)===String(data.districtCode)); Object.assign(s.project,{department:d?.name||'',province:p?.name||'',district:t?.name||'',location:t?[t.name,p?.name,d?.name].filter(Boolean).join(', '):''}); } audit(s,'Proyecto actualizado',s.project.name||''); return {ok:true,project:s.project}; });
    if (path === '/api/draft' && method === 'GET') return {draft:user.draft||{}};
    if (path === '/api/draft' && method === 'POST') return writeState(s=>{ const account=s.users.find(item=>item.email===getUser(s).email); account.draft=data.draft||{}; audit(s,'Borrador local actualizado',account.email); return {ok:true,revision:s.revision}; });

    if (path === '/api/workspace' && method === 'POST') return writeState(s=>{
      const {section,action,item, id:recordId, weekKey}=data; const ws=s.workspace;
      if (!['workers','activities','comments','sources'].includes(section)) fail('Sección no válida.');
      if (section==='sources') { if(!ws.sources.byWeek) ws.sources={byWeek:{}}; ws.sources.byWeek[weekKey]={...sourceWeek(s,weekKey),...(data.value||{})}; audit(s,'Fuentes actualizadas',weekKey); }
      else { const collection=ws[section]; const existing=collection.find(value=>value.id===recordId); if(action==='add'){ const record={...item,id:id(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:user.email,updatedBy:user.email}; if(section==='workers') record.deadlines ||= []; collection.push(record); }
        else if(action==='delete'){ if(!existing) fail('Ese registro ya no existe.'); ws[section]=collection.filter(value=>value.id!==recordId); }
        else if(action==='toggle'){ if(!existing) fail('Ese registro ya no existe.'); existing.done=!existing.done; existing.updatedAt=new Date().toISOString(); }
        else if(action==='update'){ if(!existing) fail('Ese registro ya no existe.'); Object.assign(existing,item,{updatedAt:new Date().toISOString(),updatedBy:user.email}); }
        else fail('Acción no válida.'); audit(s,`${section} ${action==='add'?'agregado':action==='delete'?'eliminado':'actualizado'}`,item?.name||item?.title||item?.text||''); }
      return {revision:s.revision,workspace:s.workspace,auditLog:s.auditLog.slice(-100).reverse()};
    });
    if (path === '/api/live' && method === 'GET') return { revision:state.revision, project:state.project, workspace:state.workspace, submissions:userSubmissions(state), auditLog:state.auditLog.slice(-100).reverse() };
    if (path === '/api/technical-summary' && method === 'GET') return technicalSummary(state);

    if (path === '/api/submissions' && method === 'GET') return userSubmissions(state);
    if (path === '/api/submissions' && method === 'POST') return writeState(async s=>{
      const files=Array.isArray(data.files)?data.files:[]; if(!String(data.title||'').trim()||!files.length||files.length>20) fail('Escribe un asunto y adjunta entre 1 y 20 archivos.');
      const saved=[]; let total=0;
      for(const file of files){const name=cleanName(file.name);const bytes=base64Bytes(file.data);if(bytes.length>15000000) fail(`El archivo ${name} supera 15 MB.`);total+=bytes.length;const fileId=id();saved.push({id:fileId,name,size:bytes.length});await putFile(fileId,file.data);}
      if(total>100000000) fail('El total de archivos supera 100 MB.');
      const kind=data.kind==='valuation'?'valuation':data.kind==='conformity'?'conformity':'report';
      const responsibleEmail=String(data.responsibleEmail||user.email).toLowerCase(); const responsible=s.users.find(account=>account.email.toLowerCase()===responsibleEmail);
      if(!responsible) fail('Selecciona un responsable registrado en este equipo local.');
      const item={...data,id:id(),kind,email:user.email,submitterName:user.displayName||user.email,responsibleEmail,responsibleName:responsible.displayName||responsible.email,number:kind==='valuation'?data.valuationNumber||'':String(data.number||'').trim(),documentDate:kind==='valuation'?data.valuationPeriod:kind==='conformity'?data.conformityDate:data.documentDate,valuationPeriod:data.valuationPeriod||'',valuationDue:data.valuationDue||'',plannedProgress:data.plannedProgress??null,actualProgress:data.actualProgress??null,conformityCategory:data.category||'',conformityDate:data.conformityDate||'',conformityDue:data.conformityDue||'',title:String(data.title).trim(),note:data.note||'',historicalRegistration:!!data.allowHistoricalDate,created:new Date().toISOString(),status:'Pendiente',review:'',reviewed:'',editAuthorized:false,editRequestStatus:'none',editRequestNote:'',files:saved};
      s.submissions.push(item); audit(s,kind==='valuation'?'Valorización cargada':kind==='conformity'?'Conformidad cargada':'Informe cargado',item.title); return {ok:true,id:item.id};
    });
    if (path === '/api/reset-section' && method === 'POST') return writeState(async s=>{
      requireAdmin(s); const section=data.section; const clearFiles=async removed=>{for(const sub of removed)for(const file of sub.files||[])await deleteIfUnused(s,file.id);};
      if(section==='project'){s.project={};audit(s,'Datos del proyecto limpiados','');}
      else if(section==='project-general'){for(const key of ['name','entity','executionType','code','cutoff','description','location','departmentCode','department','provinceCode','province','districtCode','district'])s.project[key]='';audit(s,'Datos generales del proyecto limpiados','');}
      else if(section==='project-technical'){for(const key of Object.keys(s.project))if(key.startsWith('tech'))s.project[key]='';audit(s,'Datos técnicos del proyecto limpiados','');}
      else if(section==='project-workers'){s.workspace.workers=[];audit(s,'Equipo del proyecto limpiado','');}
      else if(section==='control'){for(const account of s.users)account.draft={};audit(s,'Borradores de Control limpiados','');}
      else if(section.startsWith('control-')){const key={'control-report':'report','control-valuation':'valuation','control-conformity':'conformity'}[section];for(const account of s.users){account.draft||={};account.draft[key]={};}audit(s,'Borrador limpiado',section);}
      else if(section==='informe'){s.workspace.activities=[];s.workspace.comments=[];s.workspace.sources={byWeek:{}};audit(s,'Datos semanales del informe limpiados','');}
      else if(section==='informe-activities'){s.workspace.activities=[];audit(s,'Actividades del informe limpiadas','');}
      else if(section==='informe-comments'){s.workspace.comments=[];audit(s,'Comentarios del informe limpiados','');}
      else if(section==='informe-sources'){s.workspace.sources={byWeek:{}};audit(s,'Fuentes semanales del informe limpiadas','');}
      else if(section==='informe-history'){s.auditLog=[];audit(s,'Historial de cambios reiniciado','');}
      else if(['entregas-informes','entregas-valorizaciones','entregas-conformidades','entregas'].includes(section)){
        const removed=section==='entregas'?s.submissions: s.submissions.filter(item=>section==='entregas-informes'? !['valuation','conformity'].includes(item.kind):section==='entregas-valorizaciones'?item.kind==='valuation':item.kind==='conformity');
        s.submissions=s.submissions.filter(item=>!removed.some(value=>value.id===item.id));await clearFiles(removed);audit(s,'Entregas eliminadas',section);
      } else if(section==='submission'){const item=s.submissions.find(value=>value.id===data.id);if(!item)fail('Esa entrega ya no existe.');s.submissions=s.submissions.filter(value=>value.id!==data.id);await clearFiles([item]);audit(s,'Entrega eliminada',item.title);}
      else fail('No reconozco ese apartado.'); return {ok:true,section,revision:s.revision};
    });
    if (path === '/api/backup/download' && method === 'POST') { requireAdmin(state); return createBackup(state); }
    if (path === '/api/submissions/month-download' && method === 'POST') {
      const month=data.month; const items=userSubmissions(state).filter(item=>{const date=String(submissionDate(item)||item.created||'');return (date.match(/^\d{4}-\d{2}/)?.[0]||'sin-fecha')===month;});
      if(!items.length)fail('No hay entregas disponibles para ese mes.');return createBackup(state,items);
    }
    if (fileDownload && method==='GET') { const owner=state.submissions.find(item=>(item.files||[]).some(file=>file.id===fileDownload[1])); if(!owner)fail('No se encuentra el archivo.'); if(user.role!=='admin'&&owner.email!==user.email)fail('No tienes permiso para descargar este archivo.'); const saved=await getFile(fileDownload[1]); if(!saved?.blob)fail('El archivo no está disponible.'); return saved.blob; }
    if (fileDelete && method==='POST') return writeState(async s=>{requireAdmin(s);const item=s.submissions.find(value=>value.id===fileDelete[1]);if(!item)fail('No encuentro esa entrega.');item.files=(item.files||[]).filter(file=>file.id!==fileDelete[2]);await deleteIfUnused(s,fileDelete[2]);audit(s,'Archivo adjunto eliminado',item.title);return {ok:true};});
    if (projectName) return writeState(async s=>{
      const item=s.submissions.find(value=>value.id===projectName[1]);if(!item)fail('No encuentro esa entrega.');const action=projectName[2];
      if(action==='review'){requireAdmin(s);if(!['Aprobada','Observada'].includes(data.status))fail('Elige aprobar u observar.');item.status=data.status;item.review=String(data.review||'').trim();item.reviewed=new Date().toISOString();audit(s,'Entrega revisada',item.title);}
      else if(action==='edit-request'){item.editRequestStatus='pending';item.editRequestNote=String(data.reason||'');audit(s,'Corrección solicitada',item.title);}
      else if(action==='edit-decision'){requireAdmin(s);item.editAuthorized=data.status==='authorized';item.editRequestStatus=data.status;audit(s,'Solicitud de corrección resuelta',item.title);}
      else if(action==='edit'){item.title=String(data.title||item.title);item.note=String(data.note||'');item.status='Pendiente';item.review='';item.reviewed='';item.editAuthorized=false;item.editRequestStatus='none';if(Array.isArray(data.files)&&data.files.length){const old=item.files||[];const updated=[];for(const file of data.files){const fileId=id();const size=await putFile(fileId,file.data);updated.push({id:fileId,name:cleanName(file.name),size});}item.files=updated;await clearUnusedFiles(s,old);}audit(s,'Entrega corregida',item.title);}
      return {ok:true};
    });
    if (path === '/api/templates' && method==='GET') return window.CENTRO_OFFLINE_SEED?.templates || {};
    if (path === '/api/templates/download' && method==='POST') { const template=window.CENTRO_OFFLINE_SEED?.templates?.[data.type]; if(!template)fail('No se encuentra esa plantilla en la copia local.');return {template}; }
    fail('Esta función local todavía no está disponible.');
  }

  async function clearUnusedFiles(state, oldFiles) { for(const file of oldFiles||[]) await deleteIfUnused(state,file.id); }
  async function passwordHash(password, salt) {
    if (!crypto.subtle) return `${salt}:${password}`;
    const encoder=new TextEncoder();const key=await crypto.subtle.importKey('raw',encoder.encode(String(password)),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(String(salt)),iterations:120000,hash:'SHA-256'},key,256);
    return Array.from(new Uint8Array(bits),byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  window.CENTRO_OFFLINE_MODE = true;
  window.CentroOfflineApi = api;
})();
