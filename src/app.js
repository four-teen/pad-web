const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const state = { token: localStorage.getItem('pad_access_token'), user: null, offices: [], documents: [], admin: { overview: null, accounts: [], offices: [] } };
const byId = (id) => document.getElementById(id);
const uploadModal = new bootstrap.Modal(byId('upload-modal'));
const accountModal = new bootstrap.Modal(byId('admin-account-modal'));
const officeModal = new bootstrap.Modal(byId('admin-office-modal'));
const adminPages = { account: 1, office: 1 };
let googleSignInPromise = null;
let signingIn = false;

function showNotice(message, type = 'danger') {
  const notice = byId('notice');
  notice.className = `alert alert-${type}`;
  notice.textContent = message;
  notice.classList.remove('d-none');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearNotice() { byId('notice').classList.add('d-none'); }

function apiState(online) {
  const element = byId('api-state');
  element.classList.toggle('offline', !online);
  element.innerHTML = online ? '<i class="bx bx-radio-circle-marked"></i> Connected' : '<i class="bx bx-error-circle"></i> API unavailable';
}

async function api(path, options = {}) {
  if (!API_BASE_URL) throw new Error('VITE_API_BASE_URL is not configured for this deployment.');
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) signOut(body.message);
    throw new Error(body.message || 'The request could not be completed.');
  }
  return body;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')));
}

function statusBadge(status) { return `<span class="badge-status badge-${escapeHtml(status)}">${escapeHtml(status.replace('_', ' '))}</span>`; }

function initials(name) { return (name || 'CT').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }

function setProfile() {
  const { user } = state;
  byId('user-name').textContent = user.name;
  byId('user-office').textContent = user.office_name || 'Office assignment pending';
  byId('greeting-name').textContent = user.name.split(' ')[0];
  byId('admin-nav-item').classList.toggle('d-none', user.role !== 'admin');
  const image = byId('user-avatar');
  byId('user-initials').textContent = initials(user.name);
  image.classList.toggle('d-none', !user.avatar_url);
  byId('user-initials').classList.toggle('d-none', Boolean(user.avatar_url));
  if (user.avatar_url) image.src = user.avatar_url;
}

function renderOfficeOptions() {
  byId('recipient-office').innerHTML = '<option value="">Select an office (optional)</option>' + state.offices.map((office) => `<option value="${office.id}">${escapeHtml(officeLabel(office))}</option>`).join('');
}

function row(document, showSource = true) {
  return `<tr>
    <td><span class="reference-number">${escapeHtml(document.reference_no)}</span></td>
    <td><div class="document-subject fw-semibold" title="${escapeHtml(document.subject)}">${escapeHtml(document.subject)}</div><small class="text-muted">${escapeHtml(document.file_name || 'No file')}</small></td>
    ${showSource ? `<td>${escapeHtml(document.source_office_name || document.external_sender || (document.origin_type === 'external' ? 'External' : '—'))}</td>` : ''}
    <td>${escapeHtml(document.current_office_name || '—')}</td>
    <td>${statusBadge(document.status)}</td>
    <td><button class="btn btn-sm btn-outline-primary" type="button" data-document="${escapeHtml(document.reference_no)}">View trail</button></td>
  </tr>`;
}

function renderDocuments() {
  const query = byId('document-search').value.trim().toLowerCase();
  const status = byId('status-filter').value;
  const filtered = state.documents.filter((document) => {
    const haystack = [document.reference_no, document.subject, document.source_office_name, document.current_office_name].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!status || document.status === status);
  });
  byId('document-list').innerHTML = filtered.length ? filtered.map((document) => row(document)).join('') : '<tr><td colspan="6" class="text-center text-muted py-5">No matching documents found.</td></tr>';
}

function renderDashboard() {
  const count = (status) => state.documents.filter((document) => document.status === status).length;
  byId('metric-total').textContent = state.documents.length;
  byId('metric-transit').textContent = count('in_transit');
  byId('metric-received').textContent = count('received');
  byId('metric-created').textContent = count('created');
  const recent = state.documents.slice(0, 6);
  byId('recent-documents').innerHTML = recent.length ? recent.map((document) => `<tr><td><span class="reference-number">${escapeHtml(document.reference_no)}</span></td><td><div class="document-subject fw-semibold">${escapeHtml(document.subject)}</div></td><td>${escapeHtml(document.current_office_name || '—')}</td><td>${statusBadge(document.status)}</td><td><small class="text-muted">${formatDate(document.updated_at)}</small></td></tr>`).join('') : '<tr><td colspan="5" class="text-center text-muted py-4">No documents are available to your office yet.</td></tr>';
}

async function refreshWorkspace() {
  try {
    const [officeResponse, documentResponse] = await Promise.all([api('/api/offices'), api('/api/documents')]);
    state.offices = officeResponse.data;
    state.documents = documentResponse.data;
    renderOfficeOptions();
    renderDashboard();
    renderDocuments();
    apiState(true);
  } catch (error) {
    apiState(false);
    showNotice(error.message);
  }
}

function isAdministrator() {
  return state.user && state.user.role === 'admin';
}

function officeLabel(office) {
  return office.name + (office.campus ? ' — ' + office.campus : '');
}

function adminOfficeOptions(selected) {
  const offices = state.admin.offices.filter((office) => Number(office.is_active) === 1 || Number(office.id) === Number(selected));
  return '<option value="">Unassigned</option>' + offices.map((office) => '<option value="' + office.id + '"' + (Number(office.id) === Number(selected) ? ' selected' : '') + '>' + escapeHtml(officeLabel(office)) + (Number(office.is_active) === 1 ? '' : ' (inactive)') + '</option>').join('');
}

function adminAccessBadge(active) {
  return active ? '<span class="badge bg-label-success">Active</span>' : '<span class="badge bg-label-secondary">Disabled</span>';
}

function adminPageRows(rows, kind) {
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  adminPages[kind] = Math.min(pages, Math.max(1, adminPages[kind]));
  const start = (adminPages[kind] - 1) * 20;
  byId('admin-' + kind + '-count').textContent = rows.length ? (start + 1) + '–' + Math.min(start + 20, rows.length) + ' of ' + rows.length : 'No matching records';
  byId('admin-' + kind + '-prev').disabled = adminPages[kind] === 1;
  byId('admin-' + kind + '-next').disabled = adminPages[kind] >= pages;
  return rows.slice(start, start + 20);
}

function renderAdminAccounts() {
  if (!isAdministrator()) return;
  const query = byId('admin-account-search').value.trim().toLowerCase();
  const status = byId('admin-account-status').value;
  const rows = state.admin.accounts.filter((account) => {
    const haystack = [account.name, account.email, account.position, account.campus, account.role, account.office_name, account.office_campus].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!status || (status === 'pending' ? !account.last_login_at : status === 'active' ? Number(account.is_active) === 1 : Number(account.is_active) === 0));
  });
  byId('admin-users-list').innerHTML = adminPageRows(rows, 'account').map((account) =>
    '<tr><td><strong>' + escapeHtml(account.name) + '</strong><small class="d-block text-muted">' + escapeHtml(account.email) + '</small>' +
    (account.position ? '<small class="d-block text-muted">' + escapeHtml(account.position) + '</small>' : '') + '</td>' +
    '<td><span class="badge bg-label-primary">' + escapeHtml(account.role === 'admin' ? 'Administrator' : account.role) + '</span></td>' +
    '<td>' + escapeHtml(account.office_name ? officeLabel({ name: account.office_name, campus: account.office_campus }) : 'Unassigned') + '</td>' +
    '<td>' + adminAccessBadge(Number(account.is_active) === 1) + '</td>' +
    '<td><small class="text-muted">' + (account.last_login_at ? formatDate(account.last_login_at) : 'Not signed in yet') + '</small></td>' +
    '<td><button type="button" class="btn btn-sm btn-outline-primary" data-edit-account="' + account.id + '">Manage</button></td></tr>'
  ).join('') || '<tr><td colspan="6" class="text-center text-muted py-5">No matching accounts.</td></tr>';
}

function renderAdminOffices() {
  if (!isAdministrator()) return;
  const query = byId('admin-office-search').value.trim().toLowerCase();
  const campus = byId('admin-office-campus-filter').value;
  const status = byId('admin-office-status').value;
  const rows = state.admin.offices.filter((office) => {
    const haystack = [office.code, office.name, office.domain, office.campus, office.contact_email, ...(office.officials || []).flatMap((official) => [official.name, official.position, official.email, official.alternate_email])].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!campus || (office.campus || '__unspecified') === campus) && (status === '' || Number(office.is_active) === Number(status));
  });
  byId('admin-offices-list').innerHTML = adminPageRows(rows, 'office').map((office) => {
    const active = Number(office.is_active) === 1;
    const core = ['RECORDS', 'PAD', 'OP'].includes(office.code);
    const officials = (office.officials || []).map((official) => '<div class="mb-2"><strong class="small">' + escapeHtml(official.name) + '</strong><small class="d-block text-muted">' + escapeHtml(official.position) + '</small><small class="d-block">' + escapeHtml([official.email, official.alternate_email].filter(Boolean).join(' · ')) + '</small></div>').join('');
    return '<tr><td><strong>' + escapeHtml(office.name) + '</strong><small class="d-block reference-number">' + escapeHtml(office.code) + '</small><small class="d-block text-muted">' + escapeHtml(office.contact_email || '') + '</small>' +
      (office.description ? '<small class="d-block text-muted mt-2">' + escapeHtml(office.description) + '</small>' : '') + '</td>' +
      '<td><span class="badge bg-label-primary mb-1">' + escapeHtml(office.campus || 'Campus not specified') + '</span><small class="d-block text-muted">' + escapeHtml(office.domain || '') + '</small></td>' +
      '<td>' + (officials || '<small class="text-muted">No officials recorded.</small>') + '</td>' +
      '<td>' + (active ? '<span class="badge bg-label-success">Active</span>' : '<span class="badge bg-label-secondary">Inactive</span>') + '<small class="d-block text-muted mt-1">' + Number(office.user_count || 0) + ' assigned accounts</small></td>' +
      '<td><div class="d-flex flex-wrap gap-1"><button type="button" class="btn btn-sm btn-outline-primary" data-edit-office="' + office.id + '">Edit</button><button type="button" class="btn btn-sm btn-outline-secondary" data-toggle-office="' + office.id + '" data-office-active="' + (active ? '1' : '0') + '"' + (core ? ' disabled title="Core routing offices stay active"' : '') + '>' + (active ? 'Deactivate' : 'Activate') + '</button></div></td></tr>';
  }).join('') || '<tr><td colspan="5" class="text-center text-muted py-5">No matching routing offices.</td></tr>';
}

function renderAdmin() {
  if (!isAdministrator() || !state.admin.overview) return;
  byId('admin-users-total').textContent = state.admin.overview.users;
  byId('admin-users-active').textContent = state.admin.overview.active_users;
  byId('admin-offices-total').textContent = state.admin.overview.offices;
  byId('admin-documents-total').textContent = state.admin.overview.documents;
  const campusFilter = byId('admin-office-campus-filter').value;
  const campuses = [...new Set(state.admin.offices.map((office) => office.campus).filter(Boolean))].sort();
  const domains = [...new Set(state.admin.offices.map((office) => office.domain).filter(Boolean))].sort();
  const options = (values) => values.map((value) => '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>').join('');
  byId('admin-campus-options').innerHTML = options(campuses);
  byId('admin-domain-options').innerHTML = options(domains);
  byId('admin-office-campus-filter').innerHTML = '<option value="">All campuses</option><option value="__unspecified">Campus not specified</option>' + options(campuses);
  byId('admin-office-campus-filter').value = campusFilter;
  renderAdminAccounts();
  renderAdminOffices();
}

function showAdminTab(tab) {
  if (!isAdministrator()) return;
  ['accounts', 'offices'].forEach((name) => byId('admin-' + name + '-panel').classList.toggle('d-none', name !== tab));
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.adminTab === tab);
    button.setAttribute('aria-pressed', String(button.dataset.adminTab === tab));
  });
}

async function loadAdmin() {
  if (!isAdministrator()) return;
  try {
    const [overview, accounts, offices] = await Promise.all([api('/api/admin/overview'), api('/api/admin/accounts'), api('/api/admin/offices')]);
    if (!isAdministrator()) return;
    state.admin.overview = overview.data;
    state.admin.accounts = accounts.data;
    state.admin.offices = offices.data;
    renderAdmin();
  } catch (error) { showNotice(error.message); }
}

function openAdminAccount(id = null) {
  if (!isAdministrator()) return;
  const account = id === null ? null : state.admin.accounts.find((item) => Number(item.id) === Number(id));
  if (id !== null && !account) return;
  byId('admin-account-form').reset();
  byId('admin-account-error').classList.add('d-none');
  byId('admin-account-title').textContent = account ? 'Manage account' : 'Add approved account';
  byId('admin-account-id').value = account?.id || '';
  byId('admin-account-name').value = account?.name || '';
  byId('admin-account-email').value = account?.email || '';
  byId('admin-account-email').readOnly = Boolean(account);
  byId('admin-account-position').value = account?.position || '';
  byId('admin-account-campus').value = account?.campus || '';
  byId('admin-account-role').value = account?.role || 'staff';
  byId('admin-account-active').value = String(account?.is_active ?? 1);
  byId('admin-account-office').innerHTML = adminOfficeOptions(account?.office_id);
  const self = account && Number(account.user_id) === Number(state.user.id);
  byId('admin-account-role').disabled = Boolean(self);
  byId('admin-account-active').disabled = Boolean(self);
  accountModal.show();
}

async function saveAdminAccount(event) {
  event.preventDefault();
  const button = byId('admin-account-submit');
  button.disabled = true;
  byId('admin-account-error').classList.add('d-none');
  const id = byId('admin-account-id').value;
  const payload = {
    name: byId('admin-account-name').value, email: byId('admin-account-email').value,
    position: byId('admin-account-position').value, campus: byId('admin-account-campus').value,
    role: byId('admin-account-role').value, is_active: byId('admin-account-active').value === '1',
    office_id: byId('admin-account-office').value || null
  };
  try {
    await api('/api/admin/accounts' + (id ? '/' + id : ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    accountModal.hide();
    if (payload.email.toLowerCase() === state.user?.email.toLowerCase()) { state.user = (await api('/api/me')).user; setProfile(); }
    await loadAdmin();
    showNotice(id ? 'Account access updated.' : 'Google email approved and account created.', 'success');
  } catch (error) {
    byId('admin-account-error').textContent = error.message;
    byId('admin-account-error').classList.remove('d-none');
  } finally { button.disabled = false; }
}

let officialFieldSequence = 0;
function appendOfficialFields(official = {}) {
  const row = document.createElement('div');
  row.className = 'border rounded p-3 mb-3';
  row.dataset.officialRow = '';
  const prefix = 'official-' + (++officialFieldSequence);
  const fields = [['name', 'Full name', 'text', 160], ['position', 'Position', 'text', 255], ['email', 'Published email', 'email', 191], ['alternate_email', 'Alternate email', 'email', 191]];
  row.innerHTML = '<div class="row g-2">' + fields.map(([key, label, type, max]) => '<div class="col-md-6"><label class="form-label" for="' + prefix + '-' + key + '">' + label + '</label><input id="' + prefix + '-' + key + '" data-official-field="' + key + '" class="form-control" type="' + type + '" maxlength="' + max + '" value="' + escapeHtml(official[key] || '') + '"' + (key === 'name' || key === 'position' ? ' required' : '') + ' /></div>').join('') + '</div><button type="button" class="btn btn-sm btn-outline-danger mt-2" data-remove-official>Remove official</button>';
  byId('admin-official-fields').appendChild(row);
}

function openAdminOffice(id = null) {
  if (!isAdministrator()) return;
  const office = id === null ? null : state.admin.offices.find((item) => Number(item.id) === Number(id));
  if (id !== null && !office) return;
  byId('admin-office-form').reset();
  byId('admin-office-error').classList.add('d-none');
  byId('admin-office-title').textContent = office ? 'Edit routing office' : 'Add routing office';
  byId('admin-office-id').value = office?.id || '';
  byId('admin-office-code').value = office?.code || '';
  byId('admin-office-code').readOnly = Boolean(office);
  byId('admin-office-name').value = office?.name || '';
  byId('admin-office-campus').value = office?.campus || '';
  byId('admin-office-domain').value = office?.domain || '';
  byId('admin-office-email').value = office?.contact_email || '';
  byId('admin-office-description').value = office?.description || '';
  byId('admin-office-active').value = String(office?.is_active ?? 1);
  byId('admin-office-active').disabled = ['RECORDS', 'PAD', 'OP'].includes(office?.code);
  byId('admin-office-source').textContent = office?.source_url ? 'Source: ' + office.source_url + ' · retrieved ' + office.source_checked_at : '';
  byId('admin-official-fields').innerHTML = '';
  (office?.officials || []).forEach(appendOfficialFields);
  officeModal.show();
}

async function saveAdminOffice(event) {
  event.preventDefault();
  const button = byId('admin-office-submit');
  button.disabled = true;
  byId('admin-office-error').classList.add('d-none');
  const id = byId('admin-office-id').value;
  const officials = [...byId('admin-official-fields').querySelectorAll('[data-official-row]')].map((row) => Object.fromEntries(['name', 'position', 'email', 'alternate_email'].map((key) => [key, row.querySelector('[data-official-field="' + key + '"]').value])));
  const payload = {
    code: byId('admin-office-code').value, name: byId('admin-office-name').value,
    campus: byId('admin-office-campus').value, domain: byId('admin-office-domain').value,
    contact_email: byId('admin-office-email').value, description: byId('admin-office-description').value,
    is_active: byId('admin-office-active').value === '1', officials
  };
  try {
    await api('/api/admin/offices' + (id ? '/' + id : ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    officeModal.hide();
    await loadAdmin();
    await refreshWorkspace();
    showNotice(id ? 'Office and officials updated.' : 'Routing office created.', 'success');
  } catch (error) {
    byId('admin-office-error').textContent = error.message;
    byId('admin-office-error').classList.remove('d-none');
  } finally { button.disabled = false; }
}

async function toggleAdminOffice(officeId, isActive) {
  try {
    await api('/api/admin/offices/' + officeId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !isActive }) });
    await loadAdmin();
    await refreshWorkspace();
    showNotice('Office routing status updated.', 'success');
  } catch (error) { showNotice(error.message); }
}


function changeSection(section) {
  if (!['dashboard', 'documents', 'track', 'admin'].includes(section) || (section === 'admin' && !isAdministrator())) {
    section = 'dashboard';
  }
  document.querySelectorAll('.app-section').forEach((element) => element.classList.toggle('d-none', element.id !== `section-${section}`));
  document.querySelectorAll('[data-nav]').forEach((element) => element.classList.toggle('active', element.dataset.nav === section));
  if (state.user) window.history.replaceState(null, '', `#${section}`);
  if (window.Helpers && window.Helpers._toggleCollapsed) document.querySelector('.layout-overlay')?.click();
}

async function openDocument(reference) {
  clearNotice();
  changeSection('track');
  byId('document-detail').className = 'card';
  byId('document-detail').innerHTML = '<div class="card-body text-center py-5 text-muted"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Loading document trail…</div>';
  try {
    const { data } = await api(`/api/documents/${encodeURIComponent(reference)}`);
    const canRoute = state.user.role === 'admin' || state.user.role === 'records' || state.user.office_id === data.current_office_id;
    const routes = state.offices.filter((office) => Number(office.id) !== Number(data.current_office_id));
    byId('document-detail').innerHTML = `<div class="card-body p-4 p-md-5">
      <div class="d-flex flex-wrap gap-3 justify-content-between align-items-start mb-4"><div><p class="reference-number mb-2">${escapeHtml(data.reference_no)}</p><h4 class="mb-2">${escapeHtml(data.subject)}</h4><p class="mb-0 text-muted">${escapeHtml(data.description || 'No additional description.')}</p></div><div>${statusBadge(data.status)}</div></div>
      <div class="row g-3 detail-actions p-3 mb-4"><div class="col-sm-4"><small class="text-muted d-block">Current location</small><strong>${escapeHtml(data.current_office_name || '—')}</strong></div><div class="col-sm-4"><small class="text-muted d-block">Origin</small><strong>${escapeHtml(data.source_office_name || data.external_sender || 'External')}</strong></div><div class="col-sm-4"><small class="text-muted d-block">Intended final office</small><strong>${escapeHtml(data.recipient_office_name || 'Not specified')}</strong></div><div class="col-12"><a class="btn btn-outline-primary btn-sm" href="${API_BASE_URL}/api/documents/${encodeURIComponent(data.reference_no)}/download" target="_blank" rel="noopener"><i class="bx bx-download me-1"></i> Download ${escapeHtml(data.file_name)}</a></div></div>
      ${canRoute ? `<div class="border rounded p-3 mb-4"><h6 class="mb-3">Document action</h6>${data.status === 'in_transit' ? `<button id="receive-document" class="btn btn-primary" type="button" data-reference="${escapeHtml(data.reference_no)}"><i class="bx bx-check-double me-1"></i> Record receipt</button>` : `<div class="row g-2 align-items-end"><div class="col-md-7"><label class="form-label" for="route-office">Route to</label><select id="route-office" class="form-select"><option value="">Choose destination office</option>${routes.map((office) => `<option value="${office.id}">${escapeHtml(officeLabel(office))}</option>`).join('')}</select></div><div class="col-md-5"><button id="route-document" class="btn btn-primary w-100" type="button" data-reference="${escapeHtml(data.reference_no)}"><i class="bx bx-transfer me-1"></i> Route document</button></div></div>`}</div>` : ''}
      <h6 class="mb-4">Routing history</h6><div>${data.history.length ? data.history.map((item) => `<div class="trail-item"><span class="trail-dot"><i class="bx ${item.action === 'received' ? 'bx-check' : 'bx-transfer'}"></i></span><div class="d-flex flex-wrap justify-content-between gap-1"><strong>${escapeHtml(item.action.replace('_', ' '))}</strong><small class="text-muted">${formatDate(item.received_at || item.dispatched_at || item.created_at)}</small></div><p class="mb-1">${escapeHtml(item.origin_office_name || 'External / system')} <i class="bx bx-right-arrow-alt align-middle"></i> ${escapeHtml(item.destination_office_name || '—')}</p><small class="text-muted">${escapeHtml(item.notes || `Recorded by ${item.acted_by_name || 'system'}`)}</small></div>`).join('') : '<p class="text-muted">No routing actions have been recorded.</p>'}</div>
    </div>`;
  } catch (error) { byId('document-detail').innerHTML = `<div class="card-body text-center text-danger py-5">${escapeHtml(error.message)}</div>`; }
}

async function routeDocument(reference) {
  const officeId = byId('route-office').value;
  if (!officeId) return showNotice('Choose a destination office before routing.', 'warning');
  try { await api(`/api/documents/${encodeURIComponent(reference)}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_office_id: Number(officeId) }) }); await refreshWorkspace(); await openDocument(reference); showNotice('Document routed and marked in transit.', 'success'); }
  catch (error) { showNotice(error.message); }
}

async function receiveDocument(reference) {
  try { await api(`/api/documents/${encodeURIComponent(reference)}/receive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await refreshWorkspace(); await openDocument(reference); showNotice('Document receipt recorded.', 'success'); }
  catch (error) { showNotice(error.message); }
}

async function downloadDocument(reference, fileName) {
  if (!state.token) { showNotice('Sign in again before downloading this document.', 'warning'); return; }
  try {
    const response = await fetch(`${API_BASE_URL}/api/documents/${encodeURIComponent(reference)}/download`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'The document could not be downloaded.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = fileName || reference; document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  } catch (error) { showNotice(error.message); }
}

function openUpload() { byId('upload-form').reset(); byId('external-sender-field').classList.remove('d-none'); uploadModal.show(); }

async function uploadDocument(event) {
  event.preventDefault();
  const button = byId('upload-submit');
  button.disabled = true; button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving…';
  try {
    const response = await api('/api/documents', { method: 'POST', body: new FormData(event.currentTarget) });
    uploadModal.hide();
    await refreshWorkspace();
    showNotice(`Document ${response.reference_no} was uploaded and logged.`, 'success');
  } catch (error) { showNotice(error.message); }
  finally { button.disabled = false; button.innerHTML = '<i class="bx bx-upload me-1"></i> Save document'; }
}

function signOut(message = 'Sign in with your authorized Google account.') {
  localStorage.removeItem('pad_access_token');
  state.token = null; state.user = null; state.documents = []; state.offices = [];
  state.admin = { overview: null, accounts: [], offices: [] };
  uploadModal.hide();
  accountModal.hide();
  officeModal.hide();
  changeSection('dashboard');
  byId('app-view').classList.add('d-none');
  byId('auth-view').classList.remove('d-none');
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  window.google?.accounts?.id?.disableAutoSelect();
  byId('auth-status').textContent = message;
  // A restored session may never have loaded the Google script or button.
  loadGoogleSignIn().then((ready) => { if (ready && !state.token) byId('auth-status').textContent = message; });
}

window.handleGoogleCredential = async ({ credential } = {}) => {
  if (signingIn) return;
  if (!credential) { byId('auth-status').textContent = 'Choose a Google account to sign in.'; return; }
  signingIn = true;
  byId('auth-status').textContent = 'Verifying your account…';
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Google sign-in could not be completed.');
    if (!body.access_token || !body.user) throw new Error('Google sign-in could not be completed. Please try again.');
    state.token = body.access_token;
    localStorage.setItem('pad_access_token', state.token);
    await startApp();
  } catch (error) { byId('auth-status').textContent = error.message; }
  finally { signingIn = false; }
};

function showGooglePlaceholder(message) {
  const target = byId('google-signin');
  target.innerHTML = '<button class="google-button-placeholder" type="button" disabled><span class="google-letter" aria-hidden="true">G</span>Continue with Google</button>';
  if (message) byId('auth-status').textContent = message;
}

async function loadGoogleSignIn() {
  if (googleSignInPromise) return googleSignInPromise;
  if (!API_BASE_URL) {
    showGooglePlaceholder('Sign-in is unavailable. Contact the system administrator.');
    return false;
  }

  googleSignInPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google/config`);
      const config = await response.json();
      if (!response.ok || !config.enabled) throw new Error('Google sign-in has not been configured yet. Contact the system administrator.');

      if (!window.google?.accounts?.id) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('Google sign-in could not load. Check your network connection.')); };
        document.head.appendChild(script);
      });

      const target = byId('google-signin');
      target.innerHTML = '';
      window.google.accounts.id.initialize({ client_id: config.client_id, callback: window.handleGoogleCredential, auto_select: false });
      window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', shape: 'rect', width: 330, text: 'signin_with' });
      byId('auth-status').textContent = 'Choose your authorized Google account to continue.';
      return true;
    } catch (error) {
      showGooglePlaceholder(error.message);
      googleSignInPromise = null;
      return false;
    }
  })();
  return googleSignInPromise;
}

async function startApp() {
  try {
    const response = await api('/api/me');
    state.user = response.user;
    setProfile();
    // Use the role verified by the API for both fresh logins and restored sessions.
    changeSection(isAdministrator() ? 'admin' : 'dashboard');
    byId('auth-view').classList.add('d-none');
    byId('app-view').classList.remove('d-none');
    await refreshWorkspace();
    await loadAdmin();
  } catch (error) { signOut(error.message); }
}

document.addEventListener('click', (event) => {
  const section = event.target.closest('[data-section]');
  if (section) { event.preventDefault(); changeSection(section.dataset.section); }
  const downloadLink = event.target.closest('a[href*="/download"]');
  if (downloadLink) {
    event.preventDefault();
    const pieces = downloadLink.pathname.split('/');
    downloadDocument(pieces[pieces.length - 2], 'pad-document');
    return;
  }
  const documentButton = event.target.closest('[data-document]');
  if (documentButton) openDocument(documentButton.dataset.document);
  if (event.target.closest('[data-open-upload]') || event.target.closest('#new-document-button')) openUpload();
  const route = event.target.closest('#route-document'); if (route) routeDocument(route.dataset.reference);
  const receive = event.target.closest('#receive-document'); if (receive) receiveDocument(receive.dataset.reference);
  const adminTab = event.target.closest('[data-admin-tab]'); if (adminTab) showAdminTab(adminTab.dataset.adminTab);
  const editAccount = event.target.closest('[data-edit-account]'); if (editAccount) openAdminAccount(editAccount.dataset.editAccount);
  const editOffice = event.target.closest('[data-edit-office]'); if (editOffice) openAdminOffice(editOffice.dataset.editOffice);
  const accountPage = event.target.closest('[data-account-page]'); if (accountPage) { adminPages.account += Number(accountPage.dataset.accountPage); renderAdminAccounts(); }
  const officePage = event.target.closest('[data-office-page]'); if (officePage) { adminPages.office += Number(officePage.dataset.officePage); renderAdminOffices(); }
  const removeOfficial = event.target.closest('[data-remove-official]'); if (removeOfficial) removeOfficial.closest('[data-official-row]').remove();
  const toggleOffice = event.target.closest('[data-toggle-office]'); if (toggleOffice) toggleAdminOffice(toggleOffice.dataset.toggleOffice, toggleOffice.dataset.officeActive === '1');
  if (event.target.closest('#admin-refresh')) loadAdmin();
});
byId('document-search').addEventListener('input', renderDocuments);
byId('status-filter').addEventListener('change', renderDocuments);
byId('origin-type').addEventListener('change', (event) => byId('external-sender-field').classList.toggle('d-none', event.target.value !== 'external'));
byId('upload-form').addEventListener('submit', uploadDocument);
byId('admin-office-form').addEventListener('submit', saveAdminOffice);
byId('admin-account-form').addEventListener('submit', saveAdminAccount);
byId('admin-add-account').addEventListener('click', () => openAdminAccount());
byId('admin-add-office').addEventListener('click', () => openAdminOffice());
byId('admin-add-official').addEventListener('click', () => appendOfficialFields());
byId('admin-account-search').addEventListener('input', () => { adminPages.account = 1; renderAdminAccounts(); });
byId('admin-account-status').addEventListener('change', () => { adminPages.account = 1; renderAdminAccounts(); });
byId('admin-office-search').addEventListener('input', () => { adminPages.office = 1; renderAdminOffices(); });
byId('admin-office-campus-filter').addEventListener('change', () => { adminPages.office = 1; renderAdminOffices(); });
byId('admin-office-status').addEventListener('change', () => { adminPages.office = 1; renderAdminOffices(); });
byId('logout-button').addEventListener('click', () => signOut());
byId('footer-year').textContent = `© ${new Date().getFullYear()} Sultan Kudarat State University`;

if (state.token) startApp(); else loadGoogleSignIn();
