const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const state = { token: localStorage.getItem('pad_access_token'), user: null, offices: [], documents: [], admin: { overview: null, users: [], offices: [], accessList: [] } };
const byId = (id) => document.getElementById(id);
const uploadModal = new bootstrap.Modal(byId('upload-modal'));

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
    if (response.status === 401 && state.token) signOut();
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
  if (user.avatar_url) { image.src = user.avatar_url; image.classList.remove('d-none'); byId('user-initials').classList.add('d-none'); }
}

function renderOfficeOptions() {
  byId('recipient-office').innerHTML = '<option value="">Select an office (optional)</option>' + state.offices.map((office) => `<option value="${office.id}">${escapeHtml(office.name)}</option>`).join('');
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

function adminRoleOptions(selected) {
  return ['staff', 'records', 'pad', 'admin'].map((role) => '<option value="' + role + '"' + (role === selected ? ' selected' : '') + '>' + role.charAt(0).toUpperCase() + role.slice(1) + '</option>').join('');
}

function adminOfficeOptions(selected) {
  const offices = state.admin.offices.filter((office) => Number(office.is_active) === 1);
  return '<option value="">Unassigned</option>' + offices.map((office) => '<option value="' + office.id + '"' + (Number(office.id) === Number(selected) ? ' selected' : '') + '>' + escapeHtml(office.name) + '</option>').join('');
}

function adminAccessBadge(active) {
  return active ? '<span class="badge bg-label-success">Active</span>' : '<span class="badge bg-label-secondary">Disabled</span>';
}

function renderAdmin() {
  if (!isAdministrator() || !state.admin.overview) return;

  byId('admin-users-total').textContent = state.admin.overview.users;
  byId('admin-users-active').textContent = state.admin.overview.active_users;
  byId('admin-offices-total').textContent = state.admin.overview.offices;
  byId('admin-documents-total').textContent = state.admin.overview.documents;

  byId('admin-users-list').innerHTML = state.admin.users.length ? state.admin.users.map((member) => {
    return '<tr>' +
      '<td><div class="d-flex flex-column"><span class="fw-semibold">' + escapeHtml(member.name) + '</span><small class="text-muted">' + escapeHtml(member.email) + '</small></div></td>' +
      '<td><select id="admin-role-' + member.id + '" class="form-select form-select-sm admin-select">' + adminRoleOptions(member.role) + '</select></td>' +
      '<td><select id="admin-office-' + member.id + '" class="form-select form-select-sm admin-select">' + adminOfficeOptions(member.office_id) + '</select></td>' +
      '<td><select id="admin-status-' + member.id + '" class="form-select form-select-sm admin-select"><option value="1"' + (Number(member.is_active) === 1 ? ' selected' : '') + '>Active</option><option value="0"' + (Number(member.is_active) === 0 ? ' selected' : '') + '>Disabled</option></select></td>' +
      '<td><small class="text-muted">' + formatDate(member.last_login_at) + '</small></td>' +
      '<td><button class="btn btn-sm btn-primary" type="button" data-save-user="' + member.id + '">Save</button></td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="6" class="text-center text-muted py-5">No PAD users have signed in yet.</td></tr>';

  byId('admin-offices-list').innerHTML = state.admin.offices.length ? state.admin.offices.map((office) => {
    const systemOffice = office.code === 'RECORDS' || office.code === 'PAD';
    const toggleLabel = Number(office.is_active) === 1 ? 'Deactivate' : 'Activate';
    return '<tr>' +
      '<td><div class="d-flex flex-column"><span class="fw-semibold">' + escapeHtml(office.name) + '</span><small class="reference-number">' + escapeHtml(office.code) + '</small></div></td>' +
      '<td>' + escapeHtml(office.user_count) + '</td>' +
      '<td>' + adminAccessBadge(Number(office.is_active) === 1) + '</td>' +
      '<td><button class="btn btn-sm btn-outline-primary" type="button" data-toggle-office="' + office.id + '" data-office-active="' + (Number(office.is_active) === 1 ? '1' : '0') + '"' + (systemOffice ? ' disabled title="Core routing offices stay active"' : '') + '>' + toggleLabel + '</button></td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="4" class="text-center text-muted py-5">No offices found.</td></tr>';

  byId('admin-access-list').innerHTML = state.admin.accessList.length ? state.admin.accessList.map((account) => {
    const accountEmail = String(account.email || '');
    const profile = state.admin.users.find((member) => String(member.email || '').toLowerCase() === accountEmail.toLowerCase());
    const profileText = profile ? escapeHtml(profile.role) + (profile.office_name ? ' - ' + escapeHtml(profile.office_name) : '') : 'Not signed in yet';
    return '<tr><td class="fw-semibold">' + escapeHtml(accountEmail) + '</td><td><small class="text-muted">' + profileText + '</small></td></tr>';
  }).join('') : '<tr><td colspan="2" class="text-center text-muted py-5">No approved email records found.</td></tr>';
}

async function loadAdmin() {
  if (!isAdministrator()) return;
  try {
    const responses = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/users'),
      api('/api/admin/offices'),
      api('/api/admin/access-list')
    ]);
    state.admin.overview = responses[0].data;
    state.admin.users = responses[1].data;
    state.admin.offices = responses[2].data;
    state.admin.accessList = responses[3].data;
    renderAdmin();
  } catch (error) {
    showNotice(error.message);
  }
}

async function saveAdminUser(userId) {
  const role = byId('admin-role-' + userId).value;
  const officeId = byId('admin-office-' + userId).value;
  const isActive = byId('admin-status-' + userId).value === '1';
  try {
    await api('/api/admin/users/' + userId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: role, office_id: officeId === '' ? null : Number(officeId), is_active: isActive }) });
    await loadAdmin();
    showNotice('User access updated.', 'success');
  } catch (error) {
    showNotice(error.message);
  }
}

async function toggleAdminOffice(officeId, isActive) {
  try {
    await api('/api/admin/offices/' + officeId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !isActive }) });
    await loadAdmin();
    await refreshWorkspace();
    showNotice('Office status updated.', 'success');
  } catch (error) {
    showNotice(error.message);
  }
}

async function createAdminOffice(event) {
  event.preventDefault();
  const button = byId('admin-office-submit');
  button.disabled = true;
  button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Adding...';
  try {
    const form = new FormData(event.currentTarget);
    await api('/api/admin/offices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: form.get('code'), name: form.get('name'), description: form.get('description') }) });
    event.currentTarget.reset();
    await loadAdmin();
    await refreshWorkspace();
    showNotice('Office created.', 'success');
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="bx bx-plus me-1"></i> Add office';
  }
}

function changeSection(section) {
  document.querySelectorAll('.app-section').forEach((element) => element.classList.toggle('d-none', element.id !== `section-${section}`));
  document.querySelectorAll('[data-nav]').forEach((element) => element.classList.toggle('active', element.dataset.nav === section));
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
      ${canRoute ? `<div class="border rounded p-3 mb-4"><h6 class="mb-3">Document action</h6>${data.status === 'in_transit' ? `<button id="receive-document" class="btn btn-primary" type="button" data-reference="${escapeHtml(data.reference_no)}"><i class="bx bx-check-double me-1"></i> Record receipt</button>` : `<div class="row g-2 align-items-end"><div class="col-md-7"><label class="form-label" for="route-office">Route to</label><select id="route-office" class="form-select"><option value="">Choose destination office</option>${routes.map((office) => `<option value="${office.id}">${escapeHtml(office.name)}</option>`).join('')}</select></div><div class="col-md-5"><button id="route-document" class="btn btn-primary w-100" type="button" data-reference="${escapeHtml(data.reference_no)}"><i class="bx bx-transfer me-1"></i> Route document</button></div></div>`}</div>` : ''}
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

function signOut() {
  localStorage.removeItem('pad_access_token');
  state.token = null; state.user = null; state.documents = [];
  byId('app-view').classList.add('d-none');
  byId('auth-view').classList.remove('d-none');
  byId('auth-status').textContent = 'Sign in with your authorized Google account.';
}

window.handleGoogleCredential = async ({ credential }) => {
  byId('auth-status').textContent = 'Verifying your account…';
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Google sign-in could not be completed.');
    state.token = body.access_token;
    localStorage.setItem('pad_access_token', state.token);
    await startApp();
  } catch (error) { byId('auth-status').textContent = error.message; }
};

function showGooglePlaceholder(message) {
  const target = byId('google-signin');
  target.innerHTML = '<button class="google-button-placeholder" type="button" disabled><span class="google-letter" aria-hidden="true">G</span>Continue with Google</button>';
  if (message) byId('auth-status').textContent = message;
}

async function loadGoogleSignIn() {
  if (!API_BASE_URL) {
    showGooglePlaceholder('This deployment is missing its API address. Add VITE_API_BASE_URL in Vercel.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/google/config`);
    const config = await response.json();
    if (!response.ok || !config.enabled) throw new Error('Google sign-in has not been configured yet. Contact the system administrator.');

    const renderButton = () => {
      const target = byId('google-signin');
      target.innerHTML = '';
      google.accounts.id.initialize({ client_id: config.client_id, callback: window.handleGoogleCredential, auto_select: false });
      google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', shape: 'rect', width: 330, text: 'signin_with' });
      byId('auth-status').textContent = 'Choose your authorized Google account to continue.';
    };

    if (window.google && window.google.accounts) {
      renderButton();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = renderButton;
    script.onerror = () => showGooglePlaceholder('Google sign-in could not load. Check your network connection.');
    document.head.appendChild(script);
  } catch (error) {
    showGooglePlaceholder(error.message);
  }
}

async function startApp() {
  try {
    const response = await api('/api/me');
    state.user = response.user;
    setProfile();
    byId('auth-view').classList.add('d-none');
    byId('app-view').classList.remove('d-none');
    await refreshWorkspace();
    await loadAdmin();
  } catch (error) { signOut(); }
}

document.addEventListener('click', (event) => {
  const section = event.target.closest('[data-section]');
  if (section) { event.preventDefault(); changeSection(section.dataset.section); }
  const downloadLink = event.target.closest('a[href*=/download]');
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
  const saveUser = event.target.closest('[data-save-user]'); if (saveUser) saveAdminUser(saveUser.dataset.saveUser);
  const toggleOffice = event.target.closest('[data-toggle-office]'); if (toggleOffice) toggleAdminOffice(toggleOffice.dataset.toggleOffice, toggleOffice.dataset.officeActive === '1');
  if (event.target.closest('#admin-refresh')) loadAdmin();
});
byId('document-search').addEventListener('input', renderDocuments);
byId('status-filter').addEventListener('change', renderDocuments);
byId('origin-type').addEventListener('change', (event) => byId('external-sender-field').classList.toggle('d-none', event.target.value !== 'external'));
byId('upload-form').addEventListener('submit', uploadDocument);
byId('admin-office-form').addEventListener('submit', createAdminOffice);
byId('logout-button').addEventListener('click', signOut);
byId('footer-year').textContent = `© ${new Date().getFullYear()} Sultan Kudarat State University`;

if (state.token) startApp(); else loadGoogleSignIn();
