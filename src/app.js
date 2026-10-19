import { createDocRouter } from './doc_router/index.js';
import { createStatistics } from './doc_router/statistics.js';
import { createDatabaseManagement } from './database-management.js';
import { createFileCodeSettings } from './file-code-settings.js';
import { createPresidentView } from './president/index.js';
import { createAttachmentPreview } from './attachment-preview.js';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://padapi.sksu-orms.net').trim().replace(/\/+$/, '');
const state = { token: localStorage.getItem('pad_access_token'), user: null, activeRole: null, offices: [], documents: [], admin: { overview: null, accounts: [], offices: [], officials: [] } };
const byId = (id) => document.getElementById(id);
const uploadModal = new bootstrap.Modal(byId('upload-modal'));
const accountModal = new bootstrap.Modal(byId('admin-account-modal'));
const officeModal = new bootstrap.Modal(byId('admin-office-modal'));
const officialModal = new bootstrap.Modal(byId('admin-official-modal'));
const detailModal = new bootstrap.Modal(byId('admin-detail-modal'));
const deleteModal = new bootstrap.Modal(byId('admin-delete-modal'));
const adminPages = { account: 1, office: 1, official: 1 };
const accountRoleIds = ['admin', 'ovp_pad', 'ovp_central_records', 'sksu_officials'];
const moduleRoleIds = ['ovp_pad', 'ovp_central_records', 'sksu_officials'];
let adminTab = 'accounts';
let pendingDeletion = null;
let googleSignInPromise = null;
let googleButtonResizeObserver = null;
let signingIn = false;
let roleRequest = 0;
const officeStatistics = createStatistics({ state, api, byId, escapeHtml, formatDate });
const presidentView = createPresidentView({ state, api, byId, escapeHtml, formatDate, downloadDocument, signOut,
  switchRole: () => showRolePicker(true).catch((error) => { byId('role-error').textContent = error.message; byId('role-error').classList.remove('d-none'); }) });
const databaseManagement = createDatabaseManagement({ state, api, byId, escapeHtml, formatDate, isAdministrator, refreshAdmin: loadAdmin, downloadBackup: downloadAdministrativeBackup });
const fileCodeSettings = createFileCodeSettings({ api, byId, escapeHtml, isAdministrator });
const attachmentPreview = createAttachmentPreview({ state, byId, loadFile: loadDocumentFile });
const officeRouting = createDocRouter({ state, api, byId, escapeHtml, formatDate, showNotice, apiState, changeSection, uploadModal, refreshAdmin: loadAdmin,
  resetStatistics: officeStatistics.reset });

function showNotice(message, type = 'danger') {
  if (state.activeRole === 'university_president') { presidentView.notice(message, type); return; }
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
  if (state.activeRole) headers.set('X-PAD-Role', state.activeRole);
  const response = await fetch(`${API_BASE_URL}${apiPath(path)}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) signOut(body.message);
    if (response.status === 403 && state.activeRole && body.message?.includes('selected account role is no longer assigned')) {
      await showRolePicker(true);
      byId('role-error').textContent = body.message;
      byId('role-error').classList.remove('d-none');
    }
    throw new Error(body.message || 'The request could not be completed.');
  }
  return body;
}

function apiPath(path) {
  return isRoutingRole(state.activeRole) && (path.startsWith('/api/documents') || path.startsWith('/api/routing/'))
    ? '/api/doc_router/' + path.slice('/api/'.length) : path;
}

function accountRoles(user = state.user) {
  if (Array.isArray(user?.roles)) return [...accountRoleIds, 'university_president'].filter((role) => user.roles.includes(role));
  return user ? [user.role === 'admin' ? 'admin' : 'sksu_officials'] : [];
}

function accountRoleTitle(role) {
  const titles = { admin: 'Administrator', ovp_pad: 'OVP PAD', ovp_central_records: 'OVP Central Records', sksu_officials: 'SKSU Officials', university_president: 'University President' };
  return titles[role] || role;
}

function isRoutingRole(role = state.activeRole) {
  return moduleRoleIds.includes(role) || role === 'router';
}

async function showRolePicker(refresh = false) {
  const current = ++roleRequest;
  state.activeRole = null;
  presidentView.reset();
  localStorage.removeItem('pad_active_role');
  officeRouting.reset();
  attachmentPreview.reset();
  databaseManagement.reset();
  fileCodeSettings.reset();
  [uploadModal, accountModal, officeModal, officialModal, detailModal, deleteModal].forEach((modal) => modal.hide());
  pendingDeletion = null;
  state.documents = []; state.offices = [];
  byId('auth-view').classList.add('d-none');
  byId('app-view').classList.add('d-none');
  byId('role-view').classList.remove('d-none');
  byId('role-error').classList.add('d-none');
  byId('role-count').textContent = '';
  byId('role-options').setAttribute('aria-busy', 'true');
  byId('role-options').innerHTML = '<p class="role-empty" role="status">Loading your account roles…</p>';
  if (refresh) {
    try {
      const response = await api('/api/me');
      if (current !== roleRequest || !state.token) return;
      state.user = response.user;
    } catch (error) {
      if (current === roleRequest) {
        byId('role-options').setAttribute('aria-busy', 'false');
        byId('role-options').innerHTML = '<p class="role-empty" role="status">Your roles could not be loaded. Refresh the page to try again.</p>';
      }
      throw error;
    }
  }
  if (current !== roleRequest || !state.token || !state.user) return;
  const roles = accountRoles();
  byId('role-user-name').textContent = state.user.name;
  byId('role-user-email').textContent = state.user.email.toLowerCase();
  byId('role-user-initials').textContent = initials(state.user.name);
  byId('role-count').textContent = `${roles.length} ${roles.length === 1 ? 'role' : 'roles'} assigned`;
  const presentation = {
    admin: { icon: 'bx-shield-quarter', label: 'System administration', scope: 'University-wide system access' },
    ovp_pad: { icon: 'bx-pen', label: 'Document action' },
    ovp_central_records: { icon: 'bx-archive', label: 'Records & routing' },
    sksu_officials: { icon: 'bx-buildings', label: 'Office workspace' },
    university_president: { icon: 'bxs-institution', label: 'Executive monitoring', scope: 'Read-only presidential view' }
  };
  const descriptions = {
    admin: 'Manage approved accounts, offices, and system administration.',
    university_president: 'Monitor university-wide document flow and office workload. Read-only presidential view.',
    ovp_pad: 'Process documents received from Central Records.',
    ovp_central_records: 'Receive office and outside documents, then route them to PAD or their destination.',
    sksu_officials: 'Send and receive documents for ' + (state.user.office_name || 'your assigned office') + '.'
  };
  byId('role-options').innerHTML = roles.map((role) => {
    const office = state.user.role_offices?.[role];
    const details = presentation[role];
    const assignment = details.scope || (office ? routingOfficeLabel(office) : 'Routing office unassigned');
    return `<button class="role-option role-option--${role}" type="button" data-choose-role="${role}" aria-labelledby="role-name-${role}" aria-describedby="role-description-${role} role-office-${role}">
      <span class="role-option-heading"><span class="role-option-icon" aria-hidden="true"><i class="bx ${details.icon}"></i></span><span><small class="role-option-label">${details.label}</small><strong id="role-name-${role}" class="role-option-name">${escapeHtml(accountRoleTitle(role))}</strong></span></span>
      <span id="role-description-${role}" class="role-option-description">${escapeHtml(descriptions[role] || 'Open your assigned module.')}</span>
      <span id="role-office-${role}" class="role-option-office"><i class="bx ${details.scope ? 'bx-check-shield' : 'bx-map'}" aria-hidden="true"></i><span>${escapeHtml(assignment)}</span></span>
      <span class="role-option-action"><span>Open workspace</span><i class="bx bx-right-arrow-alt" aria-hidden="true"></i></span>
    </button>`;
  }).join('') || '<p class="role-empty" role="status">No account role is assigned. Contact your administrator.</p>';
  byId('role-options').setAttribute('aria-busy', 'false');
  window.history.replaceState(null, '', '#choose-role');
}

async function enterAccountRole(role, requestedHash = '') {
  if (!accountRoles().includes(role)) return;
  attachmentPreview.reset();
  const current = ++roleRequest;
  state.activeRole = role;
  const response = await api('/api/me');
  if (current !== roleRequest || !state.token) return;
  state.user = response.user;
  localStorage.setItem('pad_active_role', role);
  presidentView.reset();
  officeRouting.reset();
  databaseManagement.reset();
  fileCodeSettings.reset();
  setProfile();
  if (role === 'university_president') {
    byId('auth-view').classList.add('d-none');
    byId('role-view').classList.add('d-none');
    byId('app-view').classList.add('d-none');
    await presidentView.enter(requestedHash);
    return;
  }
  const requestedTab = requestedHash.split('/')[1];
  const statisticsRequested = requestedHash === '#statistics' || ['#doc_router/statistics', '#routing/statistics'].includes(requestedHash);
  const routingRequested = isRoutingRole(role)
    ? requestedHash === '#doc_router' || requestedHash.startsWith('#doc_router/')
    : requestedHash.startsWith('#routing/') || requestedHash === '#documents';
  if (role === 'admin' && ['accounts', 'offices', 'officials', 'file-codes', 'database'].includes(requestedTab)) adminTab = requestedTab;
  const isDetail = routingRequested && requestedTab === 'document';
  if (routingRequested && !isDetail && !statisticsRequested) officeRouting.setQueue(requestedTab || 'all');
  const useQueue = routingRequested && requestedTab && !isDetail && !statisticsRequested;
  const landing = statisticsRequested ? 'statistics' : useQueue || isDetail ? 'documents' : isRoutingRole(role) || requestedHash === '#dashboard' ? 'dashboard' : 'admin';
  changeSection(landing);
  if (useQueue) window.history.replaceState(null, '', `#${isRoutingRole(role) ? 'doc_router' : 'routing'}/${officeRouting.currentQueue()}`);
  byId('auth-view').classList.add('d-none');
  byId('role-view').classList.add('d-none');
  byId('app-view').classList.remove('d-none');
  clearNotice();
  if (landing === 'dashboard') await officeRouting.overview();
  else await refreshWorkspace();
  if (current !== roleRequest) return;
  await loadAdmin();
  if (isDetail && requestedHash.split('/')[2]) await openDocument(decodeURIComponent(requestedHash.split('/')[2]));
}

async function chooseAccountRole(role) {
  const buttons = document.querySelectorAll('[data-choose-role]');
  buttons.forEach((button) => { button.disabled = true; });
  try { await enterAccountRole(role); }
  catch (error) { byId('role-error').textContent = error.message; byId('role-error').classList.remove('d-none'); }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function formatDate(value) {
  if (!value) return '—';
  const timestamp = String(value).trim().replace(' ', 'T');
  const date = new Date(timestamp + (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? '' : 'Z'));
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function statusBadge(status) { return `<span class="badge-status badge-${escapeHtml(status)}">${escapeHtml(status.replace('_', ' '))}</span>`; }

function initials(name) { return (name || 'CT').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }

function setProfile() {
  const { user } = state;
  const monitoringOffice = state.activeRole === 'university_president' || String(user.office_code || '').toUpperCase() === 'OP';
  document.querySelectorAll('[data-open-upload], #new-document-button').forEach((button) => {
    button.classList.toggle('d-none', monitoringOffice);
    button.disabled = monitoringOffice;
  });
  byId('register-document-nav-item').classList.toggle('d-none', monitoringOffice);
  byId('user-name').textContent = user.name;
  byId('user-email').textContent = (user.email || '').toLowerCase();
  byId('user-menu-name').textContent = user.name;
  byId('user-menu-email').textContent = (user.email || '').toLowerCase();
  byId('user-office').textContent = user.office_name || 'Office assignment pending';
  byId('greeting-name').textContent = user.name.split(' ')[0];
  byId('user-role').textContent = accountRoleTitle(state.activeRole);
  byId('switch-role-button').classList.toggle('d-none', accountRoles().length < 2);
  byId('admin-nav-item').classList.toggle('d-none', !isAdministrator());
  byId('admin-nav-group').classList.toggle('d-none', !isAdministrator());
  document.querySelectorAll('[data-admin-only]').forEach((item) => item.classList.toggle('d-none', !isAdministrator()));
  document.querySelectorAll('[data-routing-queue] a').forEach((link) => { link.href = `#${isRoutingRole() ? 'doc_router' : 'routing'}/${link.closest('[data-routing-queue]').dataset.routingQueue}`; });
  const image = byId('user-avatar');
  byId('user-initials').textContent = initials(user.name);
  image.classList.toggle('d-none', !user.avatar_url);
  byId('user-initials').classList.toggle('d-none', Boolean(user.avatar_url));
  if (user.avatar_url) image.src = user.avatar_url;
}

function renderDashboard() { officeRouting.render(); }
function renderDocuments() { officeRouting.render(); }
async function refreshWorkspace() { await officeRouting.refresh(); }

function isAdministrator() {
  return state.user && state.activeRole === 'admin' && accountRoles().includes('admin');
}

function officeLabel(office) {
  return office.name + (office.campus ? ' — ' + office.campus : '');
}

function adminOfficeOptions(selected) {
  const offices = state.admin.offices.filter((office) => Number(office.is_active) === 1 || Number(office.id) === Number(selected));
  return '<option value="">Unassigned</option>' + offices.map((office) => '<option value="' + office.id + '"' + (Number(office.id) === Number(selected) ? ' selected' : '') + '>' + escapeHtml(officeLabel(office)) + (Number(office.is_active) === 1 ? '' : ' (inactive)') + '</option>').join('');
}

function accountRoleInput(role) {
  return byId('admin-account-role-' + role.replace(/_/g, '-'));
}

function accountRoleOfficeOptions(selected) {
  const eligible = state.admin.offices.filter((office) => (office.officials || []).length > 0
    && (Number(office.is_active) === 1 || Number(office.id) === Number(selected)));
  return '<option value="">Select an SKSU office</option>' + eligible.map((office) => '<option value="' + office.id + '"' + (Number(office.id) === Number(selected) ? ' selected' : '') + '>' + escapeHtml(officeLabel(office)) + (Number(office.is_active) === 1 ? '' : ' (inactive)') + '</option>').join('');
}

function routingOfficeLabel(office) {
  return officeLabel(office) + (office.code ? ' [' + office.code + ']' : '');
}

function ovpRoleOfficeOptions(selected) {
  return '<option value="">Select a routing office</option>' + state.admin.offices
    .filter((office) => String(office.code || '').toUpperCase() !== 'OP'
      && (Number(office.is_active) === 1 || Number(office.id) === Number(selected)))
    .map((office) => '<option value="' + office.id + '"' + (Number(office.id) === Number(selected) ? ' selected' : '') + '>' + escapeHtml(routingOfficeLabel(office)) + (Number(office.is_active) === 1 ? '' : ' (inactive)') + '</option>').join('');
}

function accountRoleOfficeInput(role) {
  return byId(role === 'sksu_officials' ? 'admin-account-office' : 'admin-account-' + role.replace(/_/g, '-') + '-office');
}

function accountOfficeLabel(account) {
  const roles = accountRoles(account);
  const assignments = [];
  if (roles.includes('sksu_officials') || roles.includes('university_president')) {
    const office = account.office_name ? officeLabel({ name: account.office_name, campus: account.office_campus }) : 'Office unassigned';
    assignments.push((roles.includes('university_president') ? 'University President: ' : 'SKSU Officials: ') + office);
  }
  ['ovp_pad', 'ovp_central_records'].filter((role) => roles.includes(role)).forEach((role) => {
    const name = account[role + '_office_name'];
    const office = name ? routingOfficeLabel({ name, campus: account[role + '_office_campus'], code: account[role + '_office_code'] }) : 'Office unassigned';
    assignments.push(accountRoleTitle(role) + ': ' + office);
  });
  return assignments.join(' · ') || 'No module office';
}

function adminAccessBadge(active) {
  return active ? '<span class="badge bg-label-success">Active</span>' : '<span class="badge bg-label-secondary">Disabled</span>';
}

function identityLabel(name, email, alternateEmail = '') {
  return '<strong class="identity-name">' + escapeHtml((name || '').toUpperCase()) + '</strong>' +
    [email, alternateEmail].filter(Boolean).map((address) => '<small class="identity-email text-muted">' + escapeHtml(address.toLowerCase()) + '</small>').join('');
}

function roleLabel(role) {
  return ({ admin: 'Administrator', ovp_pad: 'OVP PAD', ovp_central_records: 'OVP Central Records', sksu_officials: 'SKSU Officials', university_president: 'University President', router: 'Router' })[role] || role;
}

function adminActions(kind, record, blocked = '', additionalAction = '') {
  const groupLabel = ({ account: 'Account actions', office: 'Routing office actions', official: 'Office official actions' })[kind];
  return '<div class="btn-group btn-group-sm admin-row-actions" role="group" aria-label="' + groupLabel + '">' +
    '<button type="button" class="btn btn-outline-secondary" data-view-admin="' + kind + '" data-record-id="' + record.id + '">View</button>' +
    '<button type="button" class="btn btn-outline-primary" data-edit-' + kind + '="' + record.id + '">Edit</button>' +
    '<button type="button" class="btn btn-outline-danger" data-delete-admin="' + kind + '" data-record-id="' + record.id + '"' + (blocked ? ' disabled title="' + escapeHtml(blocked) + '"' : '') + '>Delete</button>' +
    additionalAction + '</div>';
}

function deletionBlock(kind, record) {
  if (kind === 'account') {
    if (Number(record.user_id) === Number(state.user.id)) return 'You cannot delete your signed-in account.';
    if (Number(record.document_count) || Number(record.route_count)) return 'This account has document history. Disable its access instead.';
  }
  if (kind === 'office') {
    if (['RECORDS', 'PAD', 'OP'].includes(record.code)) return 'Core routing offices must remain available.';
    if (Number(record.user_count) || Number(record.document_count) || Number(record.route_count)) return 'This office is in use. Reassign accounts or deactivate the office to preserve document history.';
  }
  return '';
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
    const haystack = [account.name, account.email, account.position, account.campus, accountRoles(account).map(roleLabel).join(' '), accountOfficeLabel(account), account.office_name, account.office_campus].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!status || (status === 'pending' ? !account.last_login_at : status === 'active' ? Number(account.is_active) === 1 : Number(account.is_active) === 0));
  });
  byId('admin-users-list').innerHTML = adminPageRows(rows, 'account').map((account) =>
    '<tr><td>' + identityLabel(account.name, account.email) +
    (account.position ? '<small class="d-block text-muted">' + escapeHtml(account.position) + '</small>' : '') + '</td>' +
    '<td><div class="d-flex flex-wrap gap-1">' + accountRoles(account).map((role) => '<span class="badge bg-label-' + (role === 'admin' ? 'primary' : 'success') + '">' + roleLabel(role) + '</span>').join('') + '</div></td>' +
    '<td>' + escapeHtml(accountOfficeLabel(account)) + '</td>' +
    '<td>' + adminAccessBadge(Number(account.is_active) === 1) + '</td>' +
    '<td><small class="text-muted">' + (account.last_login_at ? formatDate(account.last_login_at) : 'Not signed in yet') + '</small></td>' +
    '<td class="admin-actions-column">' + adminActions('account', account, deletionBlock('account', account)) + '</td></tr>'
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
    const core = ['RECORDS', 'PAD', 'OP'].includes(office.code) || Number(office.module_role_count) > 0;
    const campusAssigned = Boolean((office.campus || '').trim());
    const officials = (office.officials || []).map((official) => '<div class="mb-2">' + identityLabel(official.name, official.email, official.alternate_email) + '<small class="d-block text-muted">' + escapeHtml(official.position) + '</small></div>').join('');
    const toggleAction = '<button type="button" class="btn btn-outline-secondary" data-toggle-office="' + office.id + '" data-office-active="' + (active ? '1' : '0') + '"' + (core ? ' disabled title="Core offices and offices assigned to OVP roles stay active"' : '') + '>' + (active ? 'Deactivate' : 'Activate') + '</button>';
    return '<tr><td>' + identityLabel(office.name, office.contact_email) + '<small class="d-block reference-number">' + escapeHtml(office.code) + '</small>' +
      (office.description ? '<small class="d-block text-muted mt-2">' + escapeHtml(office.description) + '</small>' : '') + '</td>' +
      '<td><span class="badge ' + (campusAssigned ? 'bg-label-success' : 'bg-label-secondary') + ' mb-1">' + escapeHtml(campusAssigned ? office.campus : 'Campus not specified') + '</span><small class="d-block text-muted">' + escapeHtml(office.domain || '') + '</small></td>' +
      '<td>' + (officials || '<small class="text-muted">No officials recorded.</small>') + '</td>' +
      '<td>' + (active ? '<span class="badge bg-label-success">Active</span>' : '<span class="badge bg-label-secondary">Inactive</span>') + '<small class="d-block text-muted mt-1">' + Number(office.user_count || 0) + ' assigned accounts</small></td>' +
      '<td class="admin-actions-column">' + adminActions('office', office, deletionBlock('office', office), toggleAction) + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="text-center text-muted py-5">No matching routing offices.</td></tr>';
}

function renderAdminOfficials() {
  if (!isAdministrator()) return;
  const query = byId('admin-official-search').value.trim().toLowerCase();
  const officeId = byId('admin-official-office-filter').value;
  const rows = state.admin.officials.filter((official) => {
    const haystack = [official.name, official.position, official.email, official.alternate_email, official.office_name, official.office_campus].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!officeId || Number(official.office_id) === Number(officeId));
  });
  byId('admin-officials-list').innerHTML = adminPageRows(rows, 'official').map((official) => '<tr><td>' + identityLabel(official.name, official.email, official.alternate_email) + '</td><td>' + escapeHtml(official.position) + '</td><td><strong>' + escapeHtml(official.office_name) + '</strong><small class="d-block text-muted">' + escapeHtml(official.office_campus || 'Campus not specified') + '</small></td><td>' + (Number(official.office_active) === 1 ? '<span class="badge bg-label-success">Active office</span>' : '<span class="badge bg-label-secondary">Inactive office</span>') + '</td><td class="admin-actions-column">' + adminActions('official', official) + '</td></tr>').join('') || '<tr><td colspan="5" class="text-center text-muted py-5">No matching office officials.</td></tr>';
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
  const officialOffice = byId('admin-official-office-filter').value;
  byId('admin-official-office-filter').innerHTML = '<option value="">All routing offices</option>' + state.admin.offices.map((office) => '<option value="' + office.id + '">' + escapeHtml(officeLabel(office)) + '</option>').join('');
  byId('admin-official-office-filter').value = officialOffice;
  renderAdminAccounts();
  renderAdminOffices();
  renderAdminOfficials();
}

function showAdminTab(tab) {
  if (!isAdministrator() || !['accounts', 'offices', 'officials', 'file-codes', 'database'].includes(tab)) return;
  adminTab = tab;
  ['accounts', 'offices', 'officials', 'file-codes', 'database'].forEach((name) => byId('admin-' + name + '-panel').classList.toggle('d-none', name !== tab));
  if (tab === 'database') databaseManagement.load();
  if (tab === 'file-codes') fileCodeSettings.load();
  document.querySelectorAll('[data-admin-nav]').forEach((item) => item.classList.toggle('active', !byId('section-admin').classList.contains('d-none') && item.dataset.adminNav === tab));
  if (!byId('section-admin').classList.contains('d-none')) window.history.replaceState(null, '', tab === 'accounts' ? '#admin' : '#admin/' + tab);
}

async function loadAdmin() {
  if (!isAdministrator()) return;
  try {
    const [overview, accounts, offices] = await Promise.all([api('/api/admin/overview'), api('/api/admin/accounts'), api('/api/admin/offices')]);
    if (!isAdministrator()) return;
    state.admin.overview = overview.data;
    state.admin.accounts = accounts.data;
    state.admin.offices = offices.data;
    state.admin.officials = offices.data.flatMap((office) => (office.officials || []).map((official) => ({ ...official, office_name: office.name, office_campus: office.campus, office_active: office.is_active })));
    renderAdmin();
  } catch (error) { showNotice(error.message); }
}

function openAdminAccount(id = null) {
  if (!isAdministrator()) return;
  const account = id === null ? null : state.admin.accounts.find((item) => Number(item.id) === Number(id));
  if (id !== null && !account) return;
  byId('admin-account-form').reset();
  byId('admin-account-error').classList.add('d-none');
  byId('admin-account-title').textContent = account ? 'Edit account' : 'Add approved account';
  byId('admin-account-id').value = account?.id || '';
  byId('admin-account-name').value = account?.name || '';
  byId('admin-account-email').value = account?.email || '';
  byId('admin-account-position').value = account?.position || '';
  byId('admin-account-campus').value = account?.campus || '';
  const roles = account ? accountRoles(account) : [];
  accountRoleIds.forEach((role) => { accountRoleInput(role).checked = roles.includes(role) || (role === 'sksu_officials' && roles.includes('university_president')); });
  byId('admin-account-active').value = String(Number(account?.is_active ?? 1));
  byId('admin-account-office').innerHTML = adminOfficeOptions(account?.office_id);
  ['ovp_pad', 'ovp_central_records'].forEach((role) => { accountRoleOfficeInput(role).innerHTML = ovpRoleOfficeOptions(account?.[role + '_office_id']); });
  const self = account && Number(account.user_id) === Number(state.user.id);
  byId('admin-account-email').readOnly = Boolean(self);
  byId('admin-account-email-help').textContent = self ? 'Ask another administrator to change your own login email.' : account ? 'Changing this email revokes the old sign-in and links the new Google identity at the next login.' : 'The user signs in with this approved Google email.';
  byId('admin-account-role-admin').disabled = Boolean(self);
  byId('admin-account-active').disabled = Boolean(self);
  updateRoleOfficeRequirement();
  accountModal.show();
}

async function saveAdminAccount(event) {
  event.preventDefault();
  const button = byId('admin-account-submit');
  button.disabled = true;
  byId('admin-account-error').classList.add('d-none');
  const id = byId('admin-account-id').value;
  const roles = accountRoleIds.filter((role) => accountRoleInput(role).checked);
  if (!roles.length) {
    byId('admin-account-error').textContent = 'Select at least one account role.';
    byId('admin-account-error').classList.remove('d-none');
    button.disabled = false;
    return;
  }
  if (roles.includes('sksu_officials') && !byId('admin-account-office').value) {
    byId('admin-account-error').textContent = 'Select an SKSU office that has an office official recorded.';
    byId('admin-account-error').classList.remove('d-none');
    button.disabled = false;
    return;
  }
  for (const role of ['ovp_pad', 'ovp_central_records']) {
    if (roles.includes(role) && !accountRoleOfficeInput(role).value) {
      byId('admin-account-error').textContent = 'Select a routing office for ' + accountRoleTitle(role) + '.';
      byId('admin-account-error').classList.remove('d-none');
      button.disabled = false;
      return;
    }
  }
  const offices = moduleRoleIds.filter((role) => roles.includes(role)).map((role) => accountRoleOfficeInput(role).value);
  if (new Set(offices).size !== offices.length) {
    byId('admin-account-error').textContent = 'Choose a different routing office for each selected role.';
    byId('admin-account-error').classList.remove('d-none');
    button.disabled = false;
    return;
  }
  const payload = {
    name: byId('admin-account-name').value, email: byId('admin-account-email').value,
    position: byId('admin-account-position').value, campus: byId('admin-account-campus').value,
    roles, is_active: byId('admin-account-active').value === '1',
    office_id: roles.includes('sksu_officials') ? (byId('admin-account-office').value || null) : null,
    ovp_pad_office_id: roles.includes('ovp_pad') ? accountRoleOfficeInput('ovp_pad').value : null,
    ovp_central_records_office_id: roles.includes('ovp_central_records') ? accountRoleOfficeInput('ovp_central_records').value : null
  };
  try {
    await api('/api/admin/accounts' + (id ? '/' + id : ''), { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    accountModal.hide();
    if (payload.email.trim().toLowerCase() === state.user?.email.toLowerCase()) { state.user = (await api('/api/me')).user; setProfile(); }
    await loadAdmin();
    showNotice(id ? 'Account access updated.' : 'Google email approved and account created.', 'success');
  } catch (error) {
    byId('admin-account-error').textContent = error.message;
    byId('admin-account-error').classList.remove('d-none');
  } finally { button.disabled = false; }
}

function updateRoleOfficeRequirement() {
  const jquery = window.jQuery;
  moduleRoleIds.forEach((role) => {
    const enabled = accountRoleInput(role).checked;
    const office = accountRoleOfficeInput(role);
    const field = byId(role === 'sksu_officials' ? 'admin-account-office-field' : 'admin-account-' + role.replace(/_/g, '-') + '-field');
    const select = jquery?.(office);
    if (select?.hasClass('select2-hidden-accessible')) select.select2('destroy');
    const previous = office.value;
    office.innerHTML = role === 'sksu_officials' ? accountRoleOfficeOptions(previous) : ovpRoleOfficeOptions(previous);
    office.value = previous;
    office.required = enabled;
    office.disabled = !enabled;
    field.classList.toggle('d-none', !enabled);
    if (enabled && jquery?.fn?.select2) select.select2({
      dropdownParent: jquery(byId('admin-account-modal')), width: '100%',
      placeholder: role === 'sksu_officials' ? 'Search SKSU offices' : 'Search routing offices',
      allowClear: true, minimumResultsForSearch: 0
    });
  });
}

function handleAccountRoleChange() {
  updateRoleOfficeRequirement();
}

let officialFieldSequence = 0;
function appendOfficialFields(official = {}) {
  const row = document.createElement('div');
  row.className = 'border rounded p-3 mb-3';
  row.dataset.officialRow = '';
  row.dataset.officialId = official.id || '';
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
  byId('admin-office-active').value = String(Number(office?.is_active ?? 1));
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
  const officials = [...byId('admin-official-fields').querySelectorAll('[data-official-row]')].map((row) => ({ id: row.dataset.officialId || null, ...Object.fromEntries(['name', 'position', 'email', 'alternate_email'].map((key) => [key, row.querySelector('[data-official-field="' + key + '"]').value])) }));
  const payload = {
    code: byId('admin-office-code').value, name: byId('admin-office-name').value,
    campus: byId('admin-office-campus').value, domain: byId('admin-office-domain').value,
    contact_email: byId('admin-office-email').value, description: byId('admin-office-description').value,
    is_active: byId('admin-office-active').value === '1', officials
  };
  try {
    await api('/api/admin/offices' + (id ? '/' + id : ''), { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    officeRouting.invalidateOffices();
    officeModal.hide();
    await loadAdmin();
    await refreshWorkspace();
    state.user = (await api('/api/me')).user; setProfile();
    showNotice(id ? 'Office and officials updated.' : 'Routing office created.', 'success');
  } catch (error) {
    byId('admin-office-error').textContent = error.message;
    byId('admin-office-error').classList.remove('d-none');
  } finally { button.disabled = false; }
}

async function toggleAdminOffice(officeId, isActive) {
  try {
    await api('/api/admin/offices/' + officeId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !isActive }) });
    officeRouting.invalidateOffices();
    await loadAdmin();
    await refreshWorkspace();
    showNotice('Office routing status updated.', 'success');
  } catch (error) { showNotice(error.message); }
}


function adminRecord(kind, id) {
  const collection = ({ account: 'accounts', office: 'offices', official: 'officials' })[kind];
  return collection ? state.admin[collection].find((record) => Number(record.id) === Number(id)) : null;
}

function openAdminOfficial(id = null) {
  if (!isAdministrator()) return;
  const official = id === null ? null : adminRecord('official', id);
  if (id !== null && !official) return;
  byId('admin-official-form').reset();
  byId('admin-official-error').classList.add('d-none');
  byId('admin-official-title').textContent = official ? 'Edit office official' : 'Add office official';
  byId('admin-official-id').value = official?.id || '';
  byId('admin-official-office').innerHTML = '<option value="">Select a routing office</option>' + state.admin.offices.map((office) => '<option value="' + office.id + '">' + escapeHtml(officeLabel(office)) + (Number(office.is_active) === 1 ? '' : ' (inactive)') + '</option>').join('');
  byId('admin-official-office').value = official?.office_id || '';
  ['name', 'position', 'email', 'alternate-email'].forEach((field) => { byId('admin-official-' + field).value = official?.[field.replace('-', '_')] || ''; });
  officialModal.show();
}

async function saveAdminOfficial(event) {
  event.preventDefault();
  const button = byId('admin-official-submit');
  button.disabled = true;
  byId('admin-official-error').classList.add('d-none');
  const id = byId('admin-official-id').value;
  const payload = { office_id: byId('admin-official-office').value, name: byId('admin-official-name').value,
    position: byId('admin-official-position').value, email: byId('admin-official-email').value,
    alternate_email: byId('admin-official-alternate-email').value };
  try {
    await api('/api/admin/officials' + (id ? '/' + id : ''), { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    officialModal.hide();
    await loadAdmin();
    showNotice(id ? 'Office official updated.' : 'Office official created.', 'success');
  } catch (error) {
    byId('admin-official-error').textContent = error.message;
    byId('admin-official-error').classList.remove('d-none');
  } finally { button.disabled = false; }
}

function viewAdminRecord(kind, id) {
  if (!isAdministrator()) return;
  const record = adminRecord(kind, id);
  if (!record) return;
  byId('admin-detail-title').textContent = ({ account: 'Account details', office: 'Routing office details', official: 'Office official details' })[kind];
  let fields;
  if (kind === 'account') fields = [['Account roles', accountRoles(record).map(roleLabel).join(', ')], ['Access', Number(record.is_active) === 1 ? 'Active' : 'Disabled'], ['Position', record.position], ['Campus', record.campus], ['Role offices', accountOfficeLabel(record)], ['Last sign-in', record.last_login_at ? formatDate(record.last_login_at) : 'Not signed in yet'], ['Documents created', record.document_count || 0], ['Routing actions', record.route_count || 0]];
  if (kind === 'office') fields = [['Office code', record.code], ['Campus', record.campus], ['Administrative domain', record.domain], ['Document routing', Number(record.is_active) === 1 ? 'Active' : 'Inactive'], ['Assigned accounts', record.user_count || 0], ['Documents', record.document_count || 0], ['Routing actions', record.route_count || 0], ['Notes', record.description]];
  if (kind === 'official') fields = [['Position', record.position], ['Routing office', record.office_name], ['Campus', record.office_campus], ['Document routing', Number(record.office_active) === 1 ? 'Active office' : 'Inactive office']];
  byId('admin-detail-body').innerHTML = '<div class="mb-4">' + identityLabel(record.name, kind === 'office' ? record.contact_email : record.email, record.alternate_email) + '</div><dl class="row mb-0">' + fields.map(([label, value]) => '<dt class="col-sm-4 text-muted mb-2">' + escapeHtml(label) + '</dt><dd class="col-sm-8 mb-2">' + escapeHtml(value === null || value === undefined || value === '' ? '—' : value) + '</dd>').join('') + '</dl>' + (kind === 'office' ? '<h6 class="mt-4">Office officials</h6>' + (record.officials || []).map((official) => '<div class="mb-3">' + identityLabel(official.name, official.email, official.alternate_email) + '<small class="text-muted">' + escapeHtml(official.position) + '</small></div>').join('') : '');
  detailModal.show();
}

function openAdminDelete(kind, id) {
  if (!isAdministrator()) return;
  const record = adminRecord(kind, id);
  if (!record) return;
  const blocked = deletionBlock(kind, record);
  if (blocked) return showNotice(blocked, 'warning');
  pendingDeletion = { kind, id: record.id };
  byId('admin-delete-title').textContent = 'Delete ' + ({ account: 'account', office: 'routing office', official: 'office official' })[kind] + '?';
  byId('admin-delete-record').innerHTML = identityLabel(record.name, kind === 'office' ? record.contact_email : record.email);
  byId('admin-delete-description').textContent = kind === 'account' ? 'This removes the approved email and its PAD profile. The user will no longer be able to sign in.' : kind === 'office' ? 'This removes the routing office and its linked officials. It will no longer appear as a document destination.' : 'This removes the official from the office directory. The routing office and user accounts remain available.';
  byId('admin-delete-error').classList.add('d-none');
  deleteModal.show();
}

async function confirmAdminDelete(event) {
  event.preventDefault();
  if (!isAdministrator() || !pendingDeletion) return;
  const { kind, id } = pendingDeletion;
  const button = byId('admin-delete-submit');
  button.disabled = true;
  byId('admin-delete-error').classList.add('d-none');
  try {
    const collection = ({ account: 'accounts', office: 'offices', official: 'officials' })[kind];
    await api('/api/admin/' + collection + '/' + id, { method: 'DELETE' });
    if (kind === 'office') officeRouting.invalidateOffices();
    pendingDeletion = null;
    deleteModal.hide();
    await loadAdmin();
    if (kind === 'office') await refreshWorkspace();
    showNotice(({ account: 'Account', office: 'Routing office', official: 'Office official' })[kind] + ' deleted.', 'success');
  } catch (error) {
    byId('admin-delete-error').textContent = error.message;
    byId('admin-delete-error').classList.remove('d-none');
  } finally { button.disabled = false; }
}

function changeSection(section) {
  if (state.activeRole === 'university_president') return;
  if (!['dashboard', 'statistics', 'documents', 'track', 'admin'].includes(section) || (section === 'admin' && !isAdministrator())) {
    section = 'dashboard';
  }
  document.querySelectorAll('.app-section').forEach((element) => element.classList.toggle('d-none', element.id !== `section-${section}`));
  document.querySelectorAll('[data-nav]').forEach((element) => element.classList.toggle('active', element.dataset.nav === section));
  document.querySelectorAll('[data-admin-nav]').forEach((element) => element.classList.toggle('active', section === 'admin' && element.dataset.adminNav === adminTab));
  if (state.user) window.history.replaceState(null, '', isRoutingRole() ? section === 'dashboard' ? '#doc_router' : section === 'statistics' ? '#doc_router/statistics' : `#doc_router/${officeRouting.currentQueue()}` : `#${section}`);
  if (section === 'statistics' && state.user && state.activeRole) officeStatistics.load();
  if (section === 'admin') showAdminTab(adminTab);
  officeRouting.updateNavigation();
  if (window.Helpers && window.Helpers._toggleCollapsed) document.querySelector('.layout-overlay')?.click();
}

async function openDocument(reference) { await officeRouting.openDocument(reference); }

async function downloadDocument(reference, fileName) {
  if (!state.token) { showNotice('Sign in again before downloading this document.', 'warning'); return; }
  const downloadToken = state.token;
  const downloadRole = state.activeRole;
  try {
    const response = await fetch(`${API_BASE_URL}${apiPath('/api/documents/' + encodeURIComponent(reference) + '/download')}`, { headers: { Authorization: `Bearer ${state.token}`, 'X-PAD-Role': state.activeRole } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'The document could not be downloaded.');
    }
    const blob = await response.blob();
    if (downloadToken !== state.token || downloadRole !== state.activeRole) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = fileName || reference; document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  } catch (error) { showNotice(error.message); }
}

async function loadDocumentFile(reference, signal) {
  const token = state.token;
  const role = state.activeRole;
  if (!token || !role) throw new Error('Sign in again before opening this attachment.');
  const response = await fetch(`${API_BASE_URL}${apiPath('/api/documents/' + encodeURIComponent(reference) + '/download')}`, {
    signal, headers: { Authorization: `Bearer ${token}`, 'X-PAD-Role': role },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'The attachment could not be opened.');
  }
  return response.blob();
}

async function downloadAdministrativeBackup(id) {
  if (!isAdministrator() || !Number.isSafeInteger(id) || id <= 0) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/database/backups/${id}`, { headers: { Authorization: `Bearer ${state.token}`, 'X-PAD-Role': state.activeRole } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'The backup could not be downloaded.');
    if (!isAdministrator()) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `pad-recovery-backup-${id}.json`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  } catch (error) { showNotice(error.message); }
}

function openUpload() { officeRouting.openUpload(); }
async function uploadDocument(event) { await officeRouting.uploadDocument(event); }

function signOut(message = 'Sign in with your authorized Google account.') {
  roleRequest++;
  presidentView.reset();
  officeRouting.reset();
  attachmentPreview.reset();
  databaseManagement.reset();
  fileCodeSettings.reset();
  localStorage.removeItem('pad_access_token');
  localStorage.removeItem('pad_active_role');
  state.token = null; state.user = null; state.activeRole = null; state.documents = []; state.offices = [];
  state.admin = { overview: null, accounts: [], offices: [], officials: [] };
  adminTab = 'accounts'; pendingDeletion = null;
  uploadModal.hide();
  accountModal.hide();
  officeModal.hide();
  officialModal.hide(); detailModal.hide(); deleteModal.hide();
  changeSection('dashboard');
  byId('app-view').classList.add('d-none');
  byId('role-view').classList.add('d-none');
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
    localStorage.removeItem('pad_active_role');
    state.activeRole = null;
    await startApp();
  } catch (error) { byId('auth-status').textContent = error.message; }
  finally { signingIn = false; }
};

function showGooglePlaceholder(message) {
  googleButtonResizeObserver?.disconnect();
  googleButtonResizeObserver = null;
  const target = byId('google-signin');
  target.innerHTML = '<button class="google-button-placeholder" type="button" disabled><span class="google-letter" aria-hidden="true">G</span>Continue with Google</button>';
  if (message) byId('auth-status').textContent = message;
}

async function loadGoogleSignIn() {
  if (googleSignInPromise) return googleSignInPromise;
  if (window.isSecureContext === false) {
    showGooglePlaceholder('Google sign-in requires a secure connection. Open PAD using HTTPS.');
    return false;
  }
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
      let renderedWidth = 0;
      const renderButton = () => {
        const width = Math.min(400, Math.floor(target.getBoundingClientRect().width));
        // Hidden sign-in views report zero; render when they become visible again.
        if (!width || width === renderedWidth) return;
        target.innerHTML = '';
        window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', shape: 'rect', width, text: 'signin_with' });
        renderedWidth = width;
      };
      renderButton();
      googleButtonResizeObserver?.disconnect();
      if (window.ResizeObserver) {
        googleButtonResizeObserver = new window.ResizeObserver(renderButton);
        googleButtonResizeObserver.observe(target);
      }
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
    if (!state.token) return;
    state.user = response.user;
    const roles = accountRoles();
    const saved = localStorage.getItem('pad_active_role');
    if (roles.length === 1) await enterAccountRole(roles[0], window.location.hash || '');
    else if (saved && roles.includes(saved)) await enterAccountRole(saved, window.location.hash || '');
    else await showRolePicker();
  } catch (error) { signOut(error.message); }
}

document.addEventListener('click', (event) => {
  const attachmentButton = event.target.closest('[data-preview-attachment]');
  if (attachmentButton) {
    event.preventDefault();
    attachmentPreview.open(attachmentButton.dataset.previewAttachment, attachmentButton.dataset.fileName);
    return;
  }
  const roleChoice = event.target.closest('[data-choose-role]');
  if (roleChoice) { chooseAccountRole(roleChoice.dataset.chooseRole); return; }
  const section = event.target.closest('[data-section]');
  if (section) { event.preventDefault(); changeSection(section.dataset.section); if (section.dataset.section === 'dashboard') officeRouting.overview(); }
  const downloadLink = event.target.closest('a[href*="/download"]');
  if (downloadLink) {
    event.preventDefault();
    const pieces = downloadLink.pathname.split('/');
    downloadDocument(pieces[pieces.length - 2], downloadLink.dataset.fileName || 'pad-document');
    return;
  }
  const documentButton = event.target.closest('[data-document]');
  if (documentButton) openDocument(documentButton.dataset.document);
  if (event.target.closest('[data-open-upload]') || event.target.closest('#new-document-button')) openUpload();
  officeRouting.handleClick(event);
  databaseManagement.handleClick(event);
  const adminNavigation = event.target.closest('[data-admin-nav]'); if (adminNavigation) { event.preventDefault(); changeSection('admin'); showAdminTab(adminNavigation.dataset.adminNav); }
  const editAccount = event.target.closest('[data-edit-account]'); if (editAccount) openAdminAccount(editAccount.dataset.editAccount);
  const editOffice = event.target.closest('[data-edit-office]'); if (editOffice) openAdminOffice(editOffice.dataset.editOffice);
  const editOfficial = event.target.closest('[data-edit-official]'); if (editOfficial) openAdminOfficial(editOfficial.dataset.editOfficial);
  const viewRecord = event.target.closest('[data-view-admin]'); if (viewRecord) viewAdminRecord(viewRecord.dataset.viewAdmin, viewRecord.dataset.recordId);
  const deleteRecord = event.target.closest('[data-delete-admin]'); if (deleteRecord && !deleteRecord.disabled) openAdminDelete(deleteRecord.dataset.deleteAdmin, deleteRecord.dataset.recordId);
  const accountPage = event.target.closest('[data-account-page]'); if (accountPage) { adminPages.account += Number(accountPage.dataset.accountPage); renderAdminAccounts(); }
  const officePage = event.target.closest('[data-office-page]'); if (officePage) { adminPages.office += Number(officePage.dataset.officePage); renderAdminOffices(); }
  const officialPage = event.target.closest('[data-official-page]'); if (officialPage) { adminPages.official += Number(officialPage.dataset.officialPage); renderAdminOfficials(); }
  const removeOfficial = event.target.closest('[data-remove-official]'); if (removeOfficial) removeOfficial.closest('[data-official-row]').remove();
  const toggleOffice = event.target.closest('[data-toggle-office]'); if (toggleOffice) toggleAdminOffice(toggleOffice.dataset.toggleOffice, toggleOffice.dataset.officeActive === '1');
});
officeRouting.bind();
officeStatistics.bind();
databaseManagement.bind();
fileCodeSettings.bind();
byId('document-search').addEventListener('input', officeRouting.search);
byId('status-filter').addEventListener('change', officeRouting.search);
byId('origin-type').addEventListener('change', officeRouting.documentSource);
byId('upload-form').addEventListener('submit', uploadDocument);
byId('admin-office-form').addEventListener('submit', saveAdminOffice);
byId('admin-account-form').addEventListener('submit', saveAdminAccount);
byId('admin-official-form').addEventListener('submit', saveAdminOfficial);
byId('admin-delete-form').addEventListener('submit', confirmAdminDelete);
byId('admin-add-account').addEventListener('click', () => openAdminAccount());
byId('admin-add-office').addEventListener('click', () => openAdminOffice());
byId('admin-add-official').addEventListener('click', () => appendOfficialFields());
byId('admin-create-official').addEventListener('click', () => openAdminOfficial());
byId('admin-account-search').addEventListener('input', () => { adminPages.account = 1; renderAdminAccounts(); });
byId('admin-account-status').addEventListener('change', () => { adminPages.account = 1; renderAdminAccounts(); });
accountRoleIds.forEach((role) => accountRoleInput(role).addEventListener('change', handleAccountRoleChange));
byId('admin-office-search').addEventListener('input', () => { adminPages.office = 1; renderAdminOffices(); });
byId('admin-office-campus-filter').addEventListener('change', () => { adminPages.office = 1; renderAdminOffices(); });
byId('admin-office-status').addEventListener('change', () => { adminPages.office = 1; renderAdminOffices(); });
byId('admin-official-search').addEventListener('input', () => { adminPages.official = 1; renderAdminOfficials(); });
byId('admin-official-office-filter').addEventListener('change', () => { adminPages.official = 1; renderAdminOfficials(); });
byId('logout-button').addEventListener('click', () => signOut());
byId('role-logout-button').addEventListener('click', () => signOut());
byId('switch-role-button').addEventListener('click', () => showRolePicker(true).catch((error) => { byId('role-error').textContent = error.message; byId('role-error').classList.remove('d-none'); }));
byId('footer-year').textContent = `© ${new Date().getFullYear()} Sultan Kudarat State University`;

if (state.token) startApp(); else loadGoogleSignIn();
