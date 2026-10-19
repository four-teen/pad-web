import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { presidentReport, presidentOffices, presidentDocuments } from './president-fixtures.js';

const routingSource = readFileSync(new URL('../src/doc_router/index.js', import.meta.url), 'utf8').replace('export function createDocRouter', 'function createDocRouter');
const statisticsSource = readFileSync(new URL('../src/doc_router/statistics.js', import.meta.url), 'utf8').replace('export function createStatistics', 'function createStatistics');
const databaseSource = readFileSync(new URL('../src/database-management.js', import.meta.url), 'utf8').replace('export function createDatabaseManagement', 'function createDatabaseManagement');
const fileCodeSource = readFileSync(new URL('../src/file-code-settings.js', import.meta.url), 'utf8').replace('export function createFileCodeSettings', 'function createFileCodeSettings');
const presidentSource = readFileSync(new URL('../src/president/index.js', import.meta.url), 'utf8').replace('export function createPresidentView', 'function createPresidentView');
const attachmentSource = readFileSync(new URL('../src/attachment-preview.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const source = routingSource + '\n' + statisticsSource + '\n' + databaseSource + '\n' + fileCodeSource + '\n' + presidentSource + '\n' + attachmentSource + '\n' + readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
  .replace("import { createDocRouter } from './doc_router/index.js';", '').replace("import { createStatistics } from './doc_router/statistics.js';", '')
  .replace("import { createDatabaseManagement } from './database-management.js';", '')
  .replace("import { createFileCodeSettings } from './file-code-settings.js';", '')
  .replace("import { createAttachmentPreview } from './attachment-preview.js';", '')
  .replace("import { createPresidentView } from './president/index.js';", '');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

const approvalDocument = {
  reference_no: 'PAD-2026-000777', subject: 'Campus request', document_type: 'Memorandum', status: 'received',
  current_office_id: 80, pending_office_id: null, last_from_office_name: 'Presidential Action Desk - Records',
  last_sender_role: 'ovp_central_records', awaiting_pad_decision: true, pad_return_office_name: 'Presidential Action Desk - Records',
  last_received_by_name: 'Sample Receiver', last_receipt_action: 'received', last_received_at: '2026-10-07 01:00:00',
  permissions: { decide: true }, history: [],
};

test('document lists show an escaped preview button only for an attached file', async () => {
  const app = page(); await flush();
  const row = (data) => vm.runInContext(`officeRouting.row(${JSON.stringify(data)})`, app.context);
  assert.doesNotMatch(row({ reference_no: 'NO-FILE', file_name: 'missing.jpg' }), /data-preview-attachment/);
  const attached = row({ reference_no: '25-6776', file_name: 'a"<file>.pdf', stored_file_name: 'private.pdf' });
  assert.match(attached, /data-preview-attachment="25-6776"/);
  assert.match(attached, /a&quot;&lt;file&gt;\.pdf/);
  assert.doesNotMatch(attached, /href=.*download/);
});

test('attachment fetch uses the selected module and its existing authorization headers', async () => {
  const file = new Blob(['sample-pdf'], { type: 'application/pdf' });
  const app = page({ token: 'sample', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path) {
    if (path.endsWith('/documents/25-6776/download')) return { body: file };
  } });
  await flush();
  assert.equal(await vm.runInContext("loadDocumentFile('25-6776')", app.context), file);
  const request = app.calls.find((call) => call.path.endsWith('/documents/25-6776/download'));
  assert.equal(request.path, '/api/doc_router/documents/25-6776/download');
  assert.equal(request.options.headers.Authorization, 'Bearer sample');
  assert.equal(request.options.headers['X-PAD-Role'], 'ovp_central_records');
});

test('View shows latest-first milestones with original step numbers, an uppercase heading, and Manila custody times', async () => {
  const record = { ...approvalDocument, reference_no: 'PAD-2026-000777', created_at: '2026-10-06 17:02:03',
    status: 'received', current_office_id: 80, server_time: '2026-10-08T18:03:04Z', history: [
      { id: 1, action: 'created', to_office_id: 2, destination_office_name: 'Records', created_at: '2026-10-06 17:02:03', notes: 'Oldest entry' },
      { id: 2, action: 'routed', from_office_id: 2, to_office_id: 80, origin_office_name: 'Records', destination_office_name: 'PAD', created_at: '2026-10-07 16:00:00' },
      { id: 3, action: 'received', from_office_id: 2, to_office_id: 80, origin_office_name: 'Records', destination_office_name: '<PAD>', created_at: '2026-10-07 17:02:03', notes: 'Latest entry' }
    ] };
  const app = page({ token: 'sample', role: 'staff', profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path) {
    if (path.endsWith('/documents/PAD-2026-000777')) return { body: { data: record } };
  } });
  await flush();
  await vm.runInContext("officeRouting.openDocument('PAD-2026-000777')", app.context);
  const html = app.element('document-detail').innerHTML;
  assert.match(html, /Asia\/Manila \(UTC\+08:00\)/);
  assert.match(html, /Oct 7, 2026, 1:02:03 AM/);
  assert.match(html, /1 day 1 hr 1 min 1 sec/);
  assert.match(html, /Oct 9, 2026, 2:03:04 AM/);
  assert.match(html, /Latest activity first/);
  assert.ok(html.indexOf('Latest entry') < html.indexOf('Oldest entry'));
  assert.deepEqual([...html.matchAll(/class="journey-number">(\d+)</g)].map((match) => Number(match[1])), [3, 2, 1]);
  assert.match(html, /class="routing-timeline-title">CAMPUS REQUEST<\/h4>/);
  assert.equal((html.match(/class="journey-node"/g) || []).length, 3);
  assert.equal((html.match(/class="journey-latest"/g) || []).length, 1);
  assert.match(html, /datetime="2026-10-07T17:02:03.000Z"/);
  assert.match(html, /Time in office · &lt;PAD&gt;/);
  assert.doesNotMatch(html, /<PAD>/);
});

function page({ token, authorize = true, restore = true, role = 'staff',
  origin = 'http://localhost', pathname = '/', apiBase = 'http://pad.test',
  profile = {}, accounts = [], offices = [], respond, activeRole, hash = '', jquery, formData = FormData, googleWidth = 330 } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(['app-view', 'role-view'].includes(id) || (id.startsWith('section-') && id !== 'section-dashboard') ? ['d-none'] : []);
      const attributes = new Map();
      elements.set(id, {
        id, textContent: '', innerHTML: '', value: '', dataset: {}, clientWidth: id === 'google-signin' ? googleWidth : 0,
        getBoundingClientRect() { return { width: this.clientWidth }; },
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
        addEventListener(name, handler) { this[name] = handler; },
        setAttribute(name, value) { attributes.set(name, value); }, getAttribute(name) { return attributes.get(name); }, reset() {}, focus() {}, scrollIntoView() {}, querySelectorAll: () => [],
        replaceChildren() { this.innerHTML = ''; },
      });
    }
    return elements.get(id);
  }
  const storage = new Map(token ? [['pad_access_token', token]] : []);
  if (activeRole) storage.set('pad_active_role', activeRole);
  const calls = [];
  let rendered = 0;
  const googleButtonWidths = [];
  let googleResizeCallback;
  let disabledAutoSelect = 0;
  let currentUrl = '/';
  const sections = ['dashboard', 'statistics', 'documents', 'track', 'admin'].map((name) => element(`section-${name}`));
  const navigation = ['dashboard', 'statistics', 'documents', 'track', 'admin'].map((name) => {
    const item = element(`nav-${name}`);
    item.dataset.nav = name;
    return item;
  });
  const registrationButtons = ['new-document-button', 'overview-register-button', 'statistics-register-button', 'documents-register-button'].map(element);
  const queueCounts = ['incoming', 'received', 'for_action', 'outgoing', 'returned', 'all'].map((queue) => {
    const item = element(`queue-count-${queue}`);
    item.dataset.queueCount = queue;
    return item;
  });
  const user = { id: 1, name: 'Approved Staff', email: 'allowed@example.test', role, avatar_url: null, ...profile };
  const context = vm.createContext({
    Headers, URL, URLSearchParams, Intl, Date, console, setTimeout, clearTimeout, AbortController, FormData: formData,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    bootstrap: { Modal: class { constructor(target) { this.target = target; } hide() { this.target.visible = false; } show() { this.target.visible = true; } } },
    document: { getElementById: element, addEventListener() {}, querySelectorAll: (selector) => selector === '.app-section' ? sections : selector === '[data-nav]' ? navigation : selector === '[data-queue-count]' ? queueCounts : selector === '[data-open-upload], #new-document-button' ? registrationButtons : [],
      head: { appendChild(script) { script.onload(); } }, createElement: () => ({ remove() {} }) },
    window: { crypto: webcrypto, jQuery: jquery, scrollTo() {}, addEventListener() {}, location: { origin, pathname, search: '', hash },
      ResizeObserver: class {
        constructor(callback) { this.callback = callback; }
        observe() { googleResizeCallback = this.callback; }
        disconnect() { googleResizeCallback = undefined; }
      },
      isSecureContext: origin.startsWith('https:') || new URL(origin).hostname === 'localhost',
      history: { replaceState(_state, _title, url) { currentUrl = url; } }, google: { accounts: { id: {
      initialize() {}, renderButton(_target, options) { rendered++; googleButtonWidths.push(options.width); }, disableAutoSelect() { disabledAutoSelect++; }
    } } } },
    fetch: async (url, options = {}) => {
      const requestUrl = new URL(url, origin);
      const path = requestUrl.pathname.replace(/^\/pad-api\/public(?=\/)/, '');
      calls.push({ path, url: requestUrl.href, options });
      let status = 200;
      let body = {};
      if (path === '/api/auth/google/config') body = { enabled: true, client_id: 'pad-test' };
      else if (path === '/api/auth/google') {
        status = authorize ? 200 : 403;
        body = authorize ? { access_token: 'pad-session', user } : { message: 'Your Google account is not authorized to use PAD.' };
      } else if (path === '/api/me') {
        status = restore ? 200 : 401;
        body = restore ? { user } : { message: 'Your session has expired. Please sign in again.' };
      } else if (path === '/api/admin/overview') body = { data: { users: 1, active_users: 1, offices: 2, documents: 0 } };
      else if (path === '/api/admin/accounts') body = { data: accounts };
      else if (path === '/api/admin/offices') body = { data: offices };
      else body = { data: [] };
      const override = await respond?.(path, options, requestUrl);
      if (override) { body = override.body; status = override.status ?? 200; }
      return { ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => body };
    }
  });
  vm.runInContext(source.replace('import.meta.env.VITE_API_BASE_URL', JSON.stringify(apiBase)), context);
  return { context, element, storage, calls, rendered: () => rendered, disabledAutoSelect: () => disabledAutoSelect, url: () => currentUrl,
    googleButtonWidths, resizeGoogleSignIn(width) { element('google-signin').clientWidth = width; googleResizeCallback?.(); } };
}

test('Google sign-in fits a narrow container and responds to orientation changes without duplicate renders', async () => {
  const app = page({ googleWidth: 246.75 });
  await flush();
  assert.deepEqual(app.googleButtonWidths, [246]);
  app.resizeGoogleSignIn(246);
  assert.equal(app.rendered(), 1);
  app.resizeGoogleSignIn(350);
  assert.deepEqual(app.googleButtonWidths, [246, 350]);
  app.resizeGoogleSignIn(500);
  assert.equal(app.googleButtonWidths.at(-1), 400);
});

test('Google sign-in waits for a visible container and survives hiding and reopening the login view', async () => {
  const app = page({ googleWidth: 0 });
  await flush();
  assert.equal(app.rendered(), 0);
  app.resizeGoogleSignIn(280);
  assert.deepEqual(app.googleButtonWidths, [280]);
  app.resizeGoogleSignIn(0);
  app.resizeGoogleSignIn(280);
  assert.equal(app.rendered(), 1);
  app.resizeGoogleSignIn(246);
  assert.deepEqual(app.googleButtonWidths, [280, 246]);
});

test('module login opens the received attention list without fetching statistics', async () => {
  const app = page({ token: 'sample', profile: { roles: ['ovp_pad'], office_id: 80, office_name: 'PAD Office' }, respond(path) {
    if (path.endsWith('/routing/workspace')) return { body: { data: [approvalDocument], counts: {}, office: { id: 80, name: 'PAD Office' }, pagination: { page: 1, pages: 1, total: 1 } } };
  } });
  await flush();
  assert.equal(app.element('section-dashboard').classList.contains('d-none'), false);
  assert.equal(app.element('section-statistics').classList.contains('d-none'), true);
  assert.match(app.element('overview-documents').innerHTML, /Campus request/i);
  assert.match(app.element('overview-documents').innerHTML, /Record decision & return/);
  assert.equal(new URL(app.calls.find(call => call.path.endsWith('/routing/workspace')).url).searchParams.get('queue'), 'attention');
  assert.equal(app.calls.some(call => call.path.endsWith('/routing/statistics')), false);
  app.element('overview-search').value = 'Campus'; app.element('document-search').value = 'Old search'; app.element('status-filter').value = 'completed';
  await vm.runInContext('officeRouting.refresh()', app.context);
  const search = new URL(app.calls.filter(call => call.path.endsWith('/routing/workspace')).at(-1).url);
  assert.equal(search.searchParams.get('search'), 'Campus');
  assert.equal(search.searchParams.get('status'), '');
});

const presidentialResponse = (path) => {
  if (path === '/api/president/statistics') return { body: presidentReport() };
  if (path === '/api/president/offices') return { body: { data: presidentOffices } };
  if (path === '/api/president/documents') return { body: { data: presidentDocuments.slice(0, 20), pagination: { page: 1, pages: 2, total: 25 } } };
  if (path.startsWith('/api/president/documents/')) return { body: { data: presidentDocuments[0] } };
};

test('a President opens a separate monitoring workspace even with an old Router URL', async () => {
  const app = page({ token: 'sample', activeRole: 'sksu_officials', hash: '#doc_router/received', profile: { roles: ['university_president'], office_id: 1, office_code: 'OP', position: 'President', office_name: presidentOffices[0].name }, respond: presidentialResponse });
  await flush();
  assert.equal(app.element('president-view').classList.contains('d-none'), false);
  assert.equal(app.element('app-view').classList.contains('d-none'), true);
  assert.equal(app.url(), '#president');
  assert.equal(app.element('register-document-nav-item').classList.contains('d-none'), true);
  for (const id of ['new-document-button', 'overview-register-button', 'statistics-register-button', 'documents-register-button']) {
    assert.equal(app.element(id).classList.contains('d-none'), true);
    assert.equal(app.element(id).disabled, true);
  }
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.equal(app.element('upload-modal').visible, undefined);
  assert.equal(app.calls.some((call) => call.path.endsWith('/routing/registration-options')), false);
  assert.match(app.element('president-overview-content').innerHTML, /Memorandum<\/small><strong>600<\/strong>/);
  assert.equal(app.calls.some((call) => /doc_router|\/api\/admin\//.test(call.path)), false);
  assert.equal(app.calls.filter((call) => call.path.startsWith('/api/president/')).every((call) => call.options.headers.get('X-PAD-Role') === 'university_president'), true);
  await vm.runInContext('signOut()', app.context);
  assert.equal(app.element('president-view').classList.contains('d-none'), true);
  assert.equal(app.element('president-overview-content').innerHTML, '');
  assert.equal(app.storage.has('pad_access_token'), false);
});

test('ordinary SKSU Officials retain every Register button and can open registration', async () => {
  const app = page({ token: 'sample', profile: { roles: ['sksu_officials'], office_id: 9, office_code: 'CCS' }, respond(path) {
    if (path.endsWith('/routing/registration-options')) return { body: { document_types: [{ id: 1, name: 'Memorandum', details_kind: 'personnel' }], personnel: [], source_divisions: [] } };
  } });
  await flush();
  assert.equal(app.element('register-document-nav-item').classList.contains('d-none'), false);
  for (const id of ['new-document-button', 'overview-register-button', 'statistics-register-button', 'documents-register-button']) {
    assert.equal(app.element(id).classList.contains('d-none'), false);
    assert.equal(app.element(id).disabled, false);
  }
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.equal(app.element('upload-modal').visible, true);
  assert.equal(app.element('upload-submit').disabled, false);
});

test('switching from OP monitoring to an assigned PAD module restores registration controls', async () => {
  const profile = { id: 1, name: 'Sample Multi-role Staff', email: 'sample@example.test', roles: ['university_president', 'ovp_pad'], office_id: 1, office_code: 'OP', office_name: 'Office of the University President' };
  const app = page({ token: 'sample', activeRole: 'university_president', profile, respond(path, options) {
    if (path === '/api/me' && options.headers.get('X-PAD-Role') === 'ovp_pad') return { body: { user: { ...profile, office_id: 80, office_code: 'PAD', office_name: 'OVP PAD' } } };
    return presidentialResponse(path);
  } });
  await flush();
  assert.equal(app.element('new-document-button').disabled, true);
  await vm.runInContext("enterAccountRole('ovp_pad')", app.context);
  assert.equal(app.element('president-view').classList.contains('d-none'), true);
  assert.equal(app.element('register-document-nav-item').classList.contains('d-none'), false);
  assert.equal(app.element('new-document-button').disabled, false);
});

test('Send and Act destination choices exclude OP and keep the PAD receiving office', async () => {
  const offices = [{ id: 1, code: 'OP', name: 'Presidential monitoring', can_receive_documents: false }, { id: 80, code: 'PAD', name: 'OVP PAD Receiving Office', can_receive_documents: true }, { id: 9, code: 'CCS', name: 'My Office', can_receive_documents: true }];
  const app = page({ token: 'sample', profile: { roles: ['sksu_officials'], office_id: 9, office_code: 'CCS' }, respond(path) {
    if (path === '/api/offices') return { body: { data: offices } };
    if (path.endsWith('/documents/PAD-2026-000777')) return { body: { data: { ...approvalDocument, current_office_id: 9, source_office_id: 1, permissions: { route: true, act: true } } } };
  } });
  await flush();
  const target = (action) => ({ closest: (selector) => selector === '[data-routing-action]' ? { dataset: { routingAction: action, reference: 'PAD-2026-000777' } } : null });
  app.context.routeTarget = target('route');
  await vm.runInContext('officeRouting.handleClick({target:routeTarget})', app.context); await flush();
  assert.doesNotMatch(app.element('routing-destination').innerHTML, /Presidential monitoring|value="1"/);
  assert.match(app.element('routing-destination').innerHTML, /OVP PAD Receiving Office/);
  assert.match(app.element('routing-office-filter').innerHTML, /Presidential monitoring/);
  app.context.routeTarget = target('act');
  await vm.runInContext('officeRouting.handleClick({target:routeTarget})', app.context); await flush();
  assert.doesNotMatch(app.element('routing-destination').innerHTML, /Presidential monitoring|value="1"/);
  assert.equal(app.element('routing-destination').value, '');
});

test('a presidential document deep link is read-only even when the server sends action flags', async () => {
  const app = page({ token: 'sample', hash: '#president/document/PAD-2026-000124', profile: { roles: ['university_president'], office_id: 1 }, respond(path) {
    if (path.endsWith('/president/documents/PAD-2026-000124')) return { body: { data: { ...presidentDocuments[0], subject: '<img src=x onerror=alert(1)>', permissions: { receive: true, route: true, decide: true, delete: true } } } };
    return presidentialResponse(path);
  } });
  await flush();
  const detail = app.element('president-detail').innerHTML;
  assert.match(detail, /Document journey/);
  assert.match(detail, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(detail, /data-routing-action|data-open-upload|data-open-decision|data-delete-document|<img/);
  assert.equal(app.calls.every((call) => !call.options.method || call.options.method === 'GET'), true);
});

test('a multi-role President can choose monitoring and return to the role picker without a second login', async () => {
  const app = page({ token: 'sample', role: 'admin', profile: { roles: ['admin', 'university_president'], office_id: 1 }, respond: presidentialResponse });
  await flush();
  assert.match(app.element('role-options').innerHTML, /Read-only presidential view/);
  await vm.runInContext("enterAccountRole('university_president')", app.context);
  await flush();
  assert.equal(app.element('president-switch-role').classList.contains('d-none'), false);
  await vm.runInContext('showRolePicker(true)', app.context);
  assert.equal(app.element('president-view').classList.contains('d-none'), true);
  assert.equal(app.element('role-view').classList.contains('d-none'), false);
  assert.equal(app.storage.get('pad_access_token'), 'sample');
});

const maintenanceInventory = { audit_ready: true, events: [], tables: [
  { name: 'documents', label: 'Document registry', group: 'operations', count: 2, can_clear: true, blocked_reasons: [], affected_counts: { documents: 2, document_routes: 4 } },
  { name: 'document_types', label: 'Document type catalog', group: 'preparation', count: 8, can_clear: false, blocked_reasons: ['Documents reference this catalog.'], affected_counts: { document_types: 8 } },
  { name: 'users', label: 'users', group: 'system', count: 1, can_clear: false, blocked_reasons: ['Login profiles are protected.'], affected_counts: { users: 1 } },
] };
const maintenanceReview = { label: 'Document registry', target: 'documents', counts: { documents: 2, document_routes: 4 }, total_records: 6, confirmation: 'CLEAR documents', token: 'fixture-operation-review' };

const fileCodeData = { current_year: 2026, format: 'YY-NNNNN', selected: { year: 2026, last_number: 6548, next_number: 6549, preview: '26-06549' },
  series: [{ year: 2026, last_number: 6548, next_number: 6549, preview: '26-06549' }] };

test('administrator file code menu loads its form and previews and saves a new sequence', async () => {
  const app = page({ token: 'sample', role: 'admin', hash: '#admin/file-codes', respond(path, options) {
    if (path === '/api/admin/file-codes') {
      if (options.method === 'PATCH') {
        const selected = { year: 2026, last_number: 6999, next_number: 7000, preview: '26-07000' };
        return { body: { data: { ...fileCodeData, selected, series: [selected] } } };
      }
      return { body: { data: fileCodeData } };
    }
  } });
  await flush();
  assert.equal(app.url(), '#admin/file-codes');
  assert.equal(app.element('admin-file-codes-panel').classList.contains('d-none'), false);
  assert.equal(app.element('admin-accounts-panel').classList.contains('d-none'), true);
  assert.equal(app.element('file-code-year').value, '2026');
  assert.equal(app.element('file-code-next').value, '6549');
  assert.equal(app.element('file-code-preview').textContent, '26-06549');
  app.element('file-code-next').value = '7000'; app.element('file-code-next').input();
  assert.equal(app.element('file-code-preview').textContent, '26-07000');
  await app.element('file-code-form').submit({ preventDefault() {} });
  const request = app.calls.find(call => call.path === '/api/admin/file-codes' && call.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(request.options.body), { year: 2026, next_number: 7000, expected_next_number: 6549 });
  assert.equal(request.options.headers.get('X-PAD-Role'), 'admin');
  assert.match(app.element('file-code-success').textContent, /26-07000/);
  assert.equal(app.element('file-code-save').disabled, false);
});

test('file code settings reject reused numbers and require a refresh after a stale save', async () => {
  const app = page({ token: 'sample', role: 'admin', hash: '#admin/file-codes', respond(path, options) {
    if (path === '/api/admin/file-codes') return options.method === 'PATCH'
      ? { status: 409, body: { message: 'The file code series changed. Refresh the settings before saving again.' } }
      : { body: { data: fileCodeData } };
  } });
  await flush();
  for (const value of ['0', '6548', '6549.5', '4294967296']) {
    app.element('file-code-next').value = value; app.element('file-code-next').input();
    assert.equal(app.element('file-code-save').disabled, true);
  }
  app.element('file-code-next').value = '7000'; app.element('file-code-next').input();
  await app.element('file-code-form').submit({ preventDefault() {} });
  assert.match(app.element('file-code-error').textContent, /Refresh/);
  assert.equal(app.element('file-code-save').disabled, true);
  await app.element('file-code-refresh').click();
  assert.equal(app.element('file-code-save').disabled, false);
  vm.runInContext('signOut()', app.context);
  assert.equal(app.element('file-code-preview').textContent, '—');
  assert.equal(app.element('file-code-series').innerHTML, '');
});

test('office roles cannot open administrator file code settings', async () => {
  const app = page({ token: 'sample', hash: '#admin/file-codes', profile: { roles: ['sksu_officials'], office_id: 2 } });
  await flush();
  vm.runInContext("showAdminTab('file-codes')", app.context);
  assert.equal(app.calls.some(call => call.path.startsWith('/api/admin/file-codes')), false);
  assert.equal(app.element('section-admin').classList.contains('d-none'), true);
});

test('administrator database page loads counts and protected-table explanations', async () => {
  const app = page({ token: 'sample', role: 'admin', hash: '#admin/database', respond(path) {
    if (path === '/api/admin/database') return { body: maintenanceInventory };
  } });
  await flush();
  assert.equal(app.url(), '#admin/database');
  assert.match(app.element('database-tables').innerHTML, /Document registry/);
  assert.match(app.element('database-tables').innerHTML, /Login profiles are protected/);
  assert.match(app.element('database-tables').innerHTML, /PREPARATION/);
  assert.match(app.element('database-tables').innerHTML, /OPERATIONS/);
  assert.match(app.element('database-tables').innerHTML, /SYSTEM &amp; ACCESS/);
  assert.match(app.element('database-tables').innerHTML, /1 tables · 8 stored rows/);
  assert.equal(app.element('database-clear-documents').disabled, false);
  assert.equal(app.calls.some(call => call.path === '/api/admin/database/clear'), false);
});

test('table clearing requires a preview, exact confirmation, reason and acknowledgement', async () => {
  const app = page({ token: 'sample', role: 'admin', hash: '#admin/database', respond(path) {
    if (path === '/api/admin/database') return { body: maintenanceInventory };
    if (path === '/api/admin/database/preview') return { body: maintenanceReview };
    if (path === '/api/admin/database/clear') return { body: { message: 'Records cleared and backed up.' } };
  } });
  await flush();
  await app.element('database-clear-documents').click();
  assert.equal(app.element('database-clear-submit').disabled, true);
  assert.match(app.element('database-clear-impact').innerHTML, /document_routes/);
  app.element('database-confirmation').value = 'CLEAR documents'; app.element('database-confirmation').input();
  app.element('database-reason').value = 'Clean fixture records'; app.element('database-reason').input();
  assert.equal(app.element('database-clear-submit').disabled, true);
  app.element('database-acknowledged').checked = true; app.element('database-acknowledged').change();
  assert.equal(app.element('database-clear-submit').disabled, false);
  const first = app.element('database-clear-form').submit({ preventDefault() {} });
  assert.equal(app.element('database-acknowledged').disabled, true);
  await app.element('database-clear-form').submit({ preventDefault() {} });
  await first;
  assert.equal(app.element('database-acknowledged').disabled, false);
  const clears = app.calls.filter(call => call.path === '/api/admin/database/clear');
  assert.equal(clears.length, 1);
  assert.deepEqual(JSON.parse(clears[0].options.body), { token: maintenanceReview.token, confirmation: 'CLEAR documents', acknowledged: true, reason: 'Clean fixture records' });
  assert.equal(app.element('database-clear-modal').visible, false);
  assert.match(app.element('database-success').textContent, /backed up/);
});

test('a stale operation stays open and requires another preview before retrying', async () => {
  const app = page({ token: 'sample', role: 'admin', hash: '#admin/database', respond(path) {
    if (path === '/api/admin/database') return { body: maintenanceInventory };
    if (path === '/api/admin/database/preview') return { body: maintenanceReview };
    if (path === '/api/admin/database/clear') return { status: 409, body: { message: 'Records changed after the review.' } };
  } });
  await flush(); await app.element('database-clear-documents').click();
  app.element('database-confirmation').value = 'CLEAR documents'; app.element('database-reason').value = 'Reset fixture'; app.element('database-acknowledged').checked = true;
  app.element('database-acknowledged').change();
  await app.element('database-clear-form').submit({ preventDefault() {} });
  assert.equal(app.element('database-clear-modal').visible, true);
  assert.equal(app.element('database-clear-submit').disabled, true);
  assert.match(app.element('database-clear-error').textContent, /Records changed.*review the operation again/);
});

test('an unreadable operation preview leaves clearing disabled and shows a useful error', async () => {
  const app = page({ token: 'sample', role: 'admin', hash: '#admin/database', respond(path) {
    if (path === '/api/admin/database') return { body: maintenanceInventory };
    if (path === '/api/admin/database/preview') return { body: {} };
  } });
  await flush(); await app.element('database-clear-documents').click();
  assert.equal(app.element('database-clear-submit').disabled, true);
  assert.match(app.element('database-clear-error').textContent, /review could not be loaded/);
  assert.equal(app.calls.some(call => call.path === '/api/admin/database/clear'), false);
});

test('an office role cannot open database management or issue clear requests', async () => {
  const app = page({ token: 'sample', activeRole: 'sksu_officials', profile: { roles: ['admin', 'sksu_officials'], office_id: 9 } });
  await flush();
  await vm.runInContext("showAdminTab('database'); databaseManagement.load()", app.context);
  await app.element('database-clear-documents').click();
  assert.equal(app.calls.some(call => call.path.startsWith('/api/admin/database')), false);
});

test('statistics has its own section and direct link, and Overview restores local attention scope', async () => {
  const app = page({ token: 'sample', hash: '#doc_router/statistics', profile: { roles: ['ovp_central_records'], office_id: 2 } });
  await flush();
  assert.equal(app.element('section-statistics').classList.contains('d-none'), false);
  assert.equal(app.element('section-dashboard').classList.contains('d-none'), true);
  assert.equal(app.url(), '#doc_router/statistics');
  assert.ok(app.calls.some(call => call.path.endsWith('/routing/statistics')));
  await vm.runInContext("changeSection('dashboard'); officeRouting.overview()", app.context);
  const latest = app.calls.filter(call => call.path.endsWith('/routing/workspace')).at(-1);
  assert.equal(new URL(latest.url).searchParams.get('queue'), 'attention');
  assert.equal(new URL(latest.url).searchParams.has('office_id'), false);
  assert.equal(app.url(), '#doc_router');
});

test('OVP All Timeline shows the global office scope and restores own-office queues after leaving it', async () => {
  for (const role of ['ovp_pad', 'ovp_central_records']) {
    const office = { id: role === 'ovp_pad' ? 80 : 2, name: 'Assigned OVP office' };
    const app = page({ token: 'sample', hash: '#doc_router/all', profile: { roles: [role], office_id: office.id }, respond(path, _options, url) {
      if (path === '/api/offices') return { body: { data: [office, { id: 10, name: 'Another office' }] } };
      if (path.endsWith('/routing/workspace')) {
        const queue = url.searchParams.get('queue'); const selected = url.searchParams.get('office_id');
        const global = queue === 'all' && !selected;
        return { body: { data: [], office: global ? null : selected ? { id: Number(selected), name: 'Another office' } : office,
          can_monitor: queue === 'all' || role === 'ovp_central_records', can_read_all_timelines: true,
          counts: { all: global ? 25 : selected ? 3 : 25 }, desk_counts: { all: 25 }, pagination: { page: 1, pages: 1, total: 0 } } };
      }
    } });
    await flush();
    assert.equal(app.element('routing-office-filter').value, 'all');
    assert.equal(app.element('routing-queue-office').textContent, 'All offices');
    assert.match(app.element('routing-queue-description').textContent, /Documents from all offices/);
    assert.equal(app.element('queue-count-all').textContent, 25);
    assert.equal(app.element('routing-monitor-wrap').classList.contains('d-none'), false);
    app.element('routing-office-filter').value = '10';
    await app.element('routing-office-filter').change({ target: app.element('routing-office-filter') });
    await flush();
    assert.match(app.element('routing-queue-description').textContent, /selected office/);
    await vm.runInContext("officeRouting.showQueue('incoming')", app.context);
    const own = app.calls.filter(call => call.path.endsWith('/routing/workspace')).at(-1);
    assert.equal(new URL(own.url).searchParams.has('office_id'), false);
    assert.equal(app.element('routing-office-filter').value, String(office.id));
    assert.equal(app.element('routing-monitor-wrap').classList.contains('d-none'), role === 'ovp_pad');
    await vm.runInContext("officeRouting.showQueue('all')", app.context);
    assert.equal(app.element('routing-office-filter').value, 'all');
  }
});

test('ordinary All Timeline uses created-or-sent wording and keeps the office monitoring selector hidden', async () => {
  const app = page({ token: 'sample', hash: '#doc_router/all', activeRole: 'sksu_officials', profile: { roles: ['ovp_pad', 'sksu_officials'], office_id: 9 }, respond(path) {
    if (path.endsWith('/routing/workspace')) return { body: { data: [], office: { id: 9, name: 'Ordinary office' },
      can_monitor: false, can_read_all_timelines: false, counts: { all: 4 }, pagination: { page: 1, pages: 1, total: 0 } } };
  } });
  await flush();
  assert.match(app.element('routing-queue-description').textContent, /created or sent by your office/);
  assert.equal(app.element('routing-monitor-wrap').classList.contains('d-none'), true);
  assert.equal(app.element('queue-count-all').textContent, 4);
});

test('Outgoing refresh clears received handoffs from the list, navigation badge, and own-office dashboard count', async () => {
  let received = false;
  const pending = { ...approvalDocument, reference_no: '26-06549', subject: 'Pending PAD submission', status: 'in_transit',
    current_office_id: 2, pending_office_id: 80, current_office_name: 'Central Records', pending_office_name: 'PAD', permissions: {} };
  const app = page({ token: 'sample', hash: '#doc_router/outgoing', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path) {
    if (path.endsWith('/routing/workspace')) return { body: { data: received ? [] : [pending],
      counts: { outgoing: received ? 0 : 1, all: 1 }, desk_counts: { outgoing: received ? 0 : 1, all: 1 },
      office: { id: 2, name: 'Central Records' }, pagination: { page: 1, pages: 1, total: received ? 0 : 1 } } };
  } });
  await flush();
  assert.equal(app.url(), '#doc_router/outgoing');
  assert.match(app.element('document-list').innerHTML, /26-06549/);
  assert.equal(app.element('queue-count-outgoing').textContent, 1);
  assert.match(app.element('routing-queue-description').textContent, /awaiting receipt by the destination/);
  received = true;
  await vm.runInContext('officeRouting.refresh()', app.context);
  assert.doesNotMatch(app.element('document-list').innerHTML, /26-06549/);
  assert.match(app.element('document-list').innerHTML, /No documents in this queue/);
  assert.equal(app.element('queue-count-outgoing').textContent, 0);
  assert.equal(app.element('queue-count-all').textContent, 1);
  assert.match(app.element('routing-stats').innerHTML, /data-open-queue="outgoing"[^]*?routing-stat-value">0</);
  assert.equal(app.element('routing-document-count').textContent, 'No matching documents');
});

test('Overview renders all received records on the page and keeps its pagination independent from statistics', async () => {
  const records = Array.from({ length: 20 }, (_, index) => ({ ...approvalDocument, reference_no: `PAD-2026-${String(index + 1).padStart(6, '0')}` }));
  const app = page({ token: 'sample', profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path) {
    if (path.endsWith('/routing/workspace')) return { body: { data: records, counts: {}, pagination: { page: 1, pages: 2, total: 25 } } };
  } });
  await flush();
  assert.equal((app.element('overview-documents').innerHTML.match(/<article/g) || []).length, 20);
  assert.match(app.element('overview-document-count').textContent, /1–20 of 25/);
  assert.equal(app.element('overview-next').disabled, false);
  assert.equal(app.element('overview-prev').disabled, true);
});

test('an expired restored session returns to a usable Google sign-in button', async () => {
  const app = page({ token: 'expired-session', restore: false });
  await flush();
  assert.equal(app.storage.has('pad_access_token'), false);
  assert.equal(app.element('auth-view').classList.contains('d-none'), false);
  assert.equal(app.element('app-view').classList.contains('d-none'), true);
  assert.equal(app.rendered(), 1);
  assert.match(app.element('auth-status').textContent, /session has expired/);
});

test('an unlisted Google email stays signed out and sees the API denial', async () => {
  const app = page({ authorize: false });
  await flush();
  await app.context.window.handleGoogleCredential({ credential: 'google-test-credential' });
  assert.equal(app.storage.has('pad_access_token'), false);
  assert.equal(app.element('app-view').classList.contains('d-none'), true);
  assert.match(app.element('auth-status').textContent, /not authorized/);
  assert.equal(app.calls.some(({ path }) => path === '/api/me'), false);
});

test('an approved login sends the Google credential and uses the PAD session', async () => {
  const app = page();
  await flush();
  await Promise.all([
    app.context.window.handleGoogleCredential({ credential: 'google-test-credential' }),
    app.context.window.handleGoogleCredential({ credential: 'google-test-credential' }),
  ]);
  const logins = app.calls.filter(({ path }) => path === '/api/auth/google');
  assert.equal(logins.length, 1);
  assert.deepEqual(JSON.parse(logins[0].options.body), { credential: 'google-test-credential' });
  assert.equal(app.storage.get('pad_access_token'), 'pad-session');
  assert.equal(app.calls.find(({ path }) => path === '/api/me').options.headers.get('Authorization'), 'Bearer pad-session');
  assert.equal(app.element('auth-view').classList.contains('d-none'), true);
  assert.equal(app.element('app-view').classList.contains('d-none'), false);
  assert.equal(app.element('section-dashboard').classList.contains('d-none'), false);
  assert.equal(app.element('section-admin').classList.contains('d-none'), true);
  assert.equal(app.url(), '#doc_router');
});

test('sign-out after restoring a session initializes Google and clears the session', async () => {
  const app = page({ token: 'restored-session' });
  await flush();
  assert.equal(app.rendered(), 0);
  app.element('logout-button').click();
  await flush();
  assert.equal(app.rendered(), 1);
  assert.equal(app.disabledAutoSelect(), 1);
  assert.equal(app.storage.has('pad_access_token'), false);
  assert.equal(app.element('auth-view').classList.contains('d-none'), false);
  assert.equal(app.url(), '/');
});

test('an administrator lands in Administration after successful Google login', async () => {
  const app = page({ role: 'admin' });
  await flush();
  await app.context.window.handleGoogleCredential({ credential: 'google-test-credential' });
  assert.equal(app.element('section-admin').classList.contains('d-none'), false);
  assert.equal(app.element('section-dashboard').classList.contains('d-none'), true);
  assert.equal(app.element('nav-admin').classList.contains('active'), true);
  assert.equal(app.element('admin-nav-item').classList.contains('d-none'), false);
  assert.equal(app.element('admin-users-total').textContent, 1);
  assert.equal(app.url(), '#admin');
  assert.deepEqual(app.calls.filter(({ path }) => path.startsWith('/api/admin/')).map(({ path }) => path).sort(),
    ['/api/admin/accounts', '/api/admin/offices', '/api/admin/overview']);
});

test('an administrator with a restored session opens Administration', async () => {
  const app = page({ token: 'restored-admin-session', role: 'admin' });
  await flush();
  assert.equal(app.element('section-admin').classList.contains('d-none'), false);
  assert.equal(app.url(), '#admin');
  assert.equal(app.rendered(), 0);
});

test('a staff account cannot navigate to Administration', async () => {
  const app = page({ token: 'restored-staff-session' });
  await flush();
  vm.runInContext("changeSection('admin')", app.context);
  assert.equal(app.element('section-admin').classList.contains('d-none'), true);
  assert.equal(app.element('admin-nav-item').classList.contains('d-none'), true);
  assert.equal(app.element('section-dashboard').classList.contains('d-none'), false);
  assert.equal(app.url(), '#doc_router');
  assert.equal(app.calls.some(({ path }) => path.startsWith('/api/admin/')), false);
});

test('Apache login and sign-out retain the /pad-web/ URL', async () => {
  const app = page({ pathname: '/pad-web/', apiBase: '/pad-api/public' });
  await flush();
  await app.context.window.handleGoogleCredential({ credential: 'google-test-credential' });
  assert.equal(app.storage.get('pad_access_token'), 'pad-session');
  assert.equal(app.calls.every(({ url }) => url.startsWith('http://localhost/pad-api/public/api/')), true);
  app.element('logout-button').click();
  await flush();
  assert.equal(app.url(), '/pad-web/');
  assert.equal(app.rendered(), 1);
});

test('a Vercel frontend uses the separate hosted API for authenticated requests', async () => {
  const app = page({ token: 'restored-session', origin: 'https://pad-web.vercel.app', apiBase: 'https://padapi.sksu-orms.net', activeRole: 'sksu_officials', profile: { roles: ['sksu_officials'], office_id: 9 } });
  await flush();
  assert.equal(app.element('app-view').classList.contains('d-none'), false);
  assert.equal(app.calls.every(({ url }) => url.startsWith('https://padapi.sksu-orms.net/api/')), true);
  assert.equal(app.calls.find(({ path }) => path === '/api/me').options.headers.get('Authorization'), 'Bearer restored-session');
  assert.equal(app.calls.filter(({ path }) => path === '/api/me').at(-1).options.headers.get('X-PAD-Role'), 'sksu_officials');
});

test('an unset API setting uses the hosted API even on a Vercel frontend', async () => {
  const app = page({ origin: 'https://pad-web.vercel.app', apiBase: '' });
  await flush();
  assert.equal(app.calls[0].url, 'https://padapi.sksu-orms.net/api/auth/google/config');
  assert.equal(app.rendered(), 1);
});

test('HTTP hosting explains the HTTPS requirement without attempting Google sign-in', async () => {
  const app = page({ origin: 'http://isulan.sksu.edu.ph:8082', apiBase: '/pad-api/public' });
  await flush();
  assert.equal(app.rendered(), 0);
  assert.equal(app.calls.length, 0);
  assert.match(app.element('auth-status').textContent, /HTTPS/);
});

test('the header shows the managed display name and lowercase email', async () => {
  const app = page({ token: 'admin-session', role: 'admin', profile: { name: 'Managed Display Name', email: 'Mixed.Case@Example.Test' } });
  await flush();
  assert.equal(app.element('user-name').textContent, 'Managed Display Name');
  assert.equal(app.element('user-email').textContent, 'mixed.case@example.test');
  assert.equal(app.element('user-menu-email').textContent, 'mixed.case@example.test');
});

test('account and official rows display uppercase names and escaped lowercase emails', async () => {
  const app = page({ token: 'admin-session', role: 'admin',
    accounts: [{ id: 2, user_id: 2, name: 'Ana <Santos>', email: 'ANA@Example.Test', role: 'staff', is_active: 1 }],
    offices: [{ id: 3, name: 'Test Office', is_active: 1, officials: [{ id: 4, office_id: 3, name: 'Mixed Official', position: 'Director', email: 'OFFICIAL@Example.Test' }] }] });
  await flush();
  assert.match(app.element('admin-users-list').innerHTML, /ANA &lt;SANTOS&gt;/);
  assert.match(app.element('admin-users-list').innerHTML, /ana@example.test/);
  assert.match(app.element('admin-officials-list').innerHTML, /MIXED OFFICIAL/);
  assert.match(app.element('admin-officials-list').innerHTML, /official@example.test/);
  assert.match(app.element('admin-officials-list').innerHTML, /Test Office/);
});

test('account saving uses PATCH and surfaces server validation without closing the form', async () => {
  const app = page({ token: 'admin-session', role: 'admin', respond: (path, options) =>
    path === '/api/admin/accounts/2' && options.method === 'PATCH' ? { status: 409, body: { message: 'That email is already in use.' } } : null });
  await flush();
  for (const [field, value] of Object.entries({ id: '2', name: 'Edited Name', email: 'edited@example.test', active: '1', office: '3' })) app.element('admin-account-' + field).value = value;
  app.element('admin-account-role-admin').checked = true;
  app.element('admin-account-role-sksu-officials').checked = true;
  app.element('admin-account-modal').visible = true;
  await vm.runInContext('saveAdminAccount({ preventDefault() {} })', app.context);
  const call = app.calls.find(({ path }) => path === '/api/admin/accounts/2');
  assert.equal(call.options.method, 'PATCH');
  assert.equal(JSON.parse(call.options.body).office_id, '3');
  assert.deepEqual(JSON.parse(call.options.body).roles, ['admin', 'sksu_officials']);
  assert.match(app.element('admin-account-error').textContent, /already in use/);
  assert.equal(app.element('admin-account-modal').visible, true);
  assert.equal(app.element('admin-account-submit').disabled, false);
});

test('official saving creates the contact with its selected office', async () => {
  const app = page({ token: 'admin-session', role: 'admin' });
  await flush();
  for (const [field, value] of Object.entries({ office: '3', name: 'New Official', position: 'Dean', email: 'dean@example.test', 'alternate-email': '' })) app.element('admin-official-' + field).value = value;
  await vm.runInContext('saveAdminOfficial({ preventDefault() {} })', app.context);
  const call = app.calls.find(({ path }) => path === '/api/admin/officials');
  assert.equal(call.options.method, 'POST');
  assert.equal(JSON.parse(call.options.body).office_id, '3');
  assert.equal(app.element('admin-official-modal').visible, false);
});

test('an account saves all four roles with three independent office selections', async () => {
  const app = page({ token: 'admin-session', role: 'admin' });
  await flush();
  for (const [field, value] of Object.entries({ id: '2', name: 'Four Roles', email: 'four@example.test', active: '1', office: '51',
    'ovp-pad-office': '80', 'ovp-central-records-office': '2' })) app.element('admin-account-' + field).value = value;
  for (const role of ['admin', 'ovp-pad', 'ovp-central-records', 'sksu-officials']) app.element('admin-account-role-' + role).checked = true;
  await vm.runInContext('saveAdminAccount({ preventDefault() {} })', app.context);
  const payload = JSON.parse(app.calls.find(({ path }) => path === '/api/admin/accounts/2').options.body);
  assert.deepEqual(payload.roles, ['admin', 'ovp_pad', 'ovp_central_records', 'sksu_officials']);
  assert.equal(payload.ovp_pad_office_id, '80');
  assert.equal(payload.ovp_central_records_office_id, '2');
  assert.equal(payload.office_id, '51');
});

test('OVP roles offer routing offices without official records and reject missing or duplicate selections', async () => {
  const app = page({ token: 'admin-session', role: 'admin', offices: [
    { id: 80, name: 'OFFICE OF THE PRESIDENT - PAD', code: 'ACCESS-PAD', is_active: 1, officials: [] },
    { id: 51, name: 'College of Computer Studies', is_active: 1, officials: [{ id: 1, name: 'Director' }] },
  ] });
  await flush();
  vm.runInContext('openAdminAccount()', app.context);
  app.element('admin-account-role-ovp-pad').checked = true;
  vm.runInContext('handleAccountRoleChange()', app.context);
  assert.equal(app.element('admin-account-ovp-pad-office').required, true);
  assert.equal(app.element('admin-account-ovp-pad-field').classList.contains('d-none'), false);
  assert.match(app.element('admin-account-ovp-pad-office').innerHTML, /OFFICE OF THE PRESIDENT - PAD \[ACCESS-PAD\]/);
  assert.doesNotMatch(app.element('admin-account-office').innerHTML, /OFFICE OF THE PRESIDENT - PAD/);
  await vm.runInContext('saveAdminAccount({ preventDefault() {} })', app.context);
  assert.match(app.element('admin-account-error').textContent, /Select a routing office for OVP PAD/);
  app.element('admin-account-role-ovp-central-records').checked = true;
  app.element('admin-account-ovp-pad-office').value = '80';
  app.element('admin-account-ovp-central-records-office').value = '80';
  await vm.runInContext('saveAdminAccount({ preventDefault() {} })', app.context);
  assert.match(app.element('admin-account-error').textContent, /different routing office/);
  assert.equal(app.calls.some(({ path, options }) => path.startsWith('/api/admin/accounts') && options.method), false);
});

test('deletion opens confirmation first and server conflicts keep the dialog open', async () => {
  const app = page({ token: 'admin-session', role: 'admin', accounts: [{ id: 2, user_id: 2, name: 'Test Account', email: 'test@example.test' }],
    respond: (path, options) => path === '/api/admin/accounts/2' && options.method === 'DELETE' ? { status: 409, body: { message: 'This account has document history.' } } : null });
  await flush();
  vm.runInContext("openAdminDelete('account', 2)", app.context);
  assert.equal(app.element('admin-delete-modal').visible, true);
  assert.equal(app.calls.some(({ options }) => options.method === 'DELETE'), false);
  await vm.runInContext('confirmAdminDelete({ preventDefault() {} })', app.context);
  assert.equal(app.calls.filter(({ options }) => options.method === 'DELETE').length, 1);
  assert.match(app.element('admin-delete-error').textContent, /document history/);
  assert.equal(app.element('admin-delete-modal').visible, true);
  assert.equal(app.element('admin-delete-submit').disabled, false);
});

test('self, core offices, and referenced offices cannot open deletion confirmation', async () => {
  const app = page({ token: 'admin-session', role: 'admin', accounts: [{ id: 1, user_id: 1, name: 'Self', email: 'allowed@example.test' }],
    offices: [{ id: 1, code: 'RECORDS', name: 'Records Office', is_active: 1 }, { id: 2, code: 'USED', name: 'Used Office', is_active: 1, document_count: 1 }] });
  await flush();
  for (const expression of ["openAdminDelete('account', 1)", "openAdminDelete('office', 1)", "openAdminDelete('office', 2)"]) vm.runInContext(expression, app.context);
  assert.notEqual(app.element('admin-delete-modal').visible, true);
  assert.equal(app.calls.some(({ options }) => options.method === 'DELETE'), false);
  assert.match(app.element('notice').textContent, /preserve document history/);
});

test('office officials are an independent administration view', async () => {
  const app = page({ token: 'admin-session', role: 'admin' });
  await flush();
  vm.runInContext("showAdminTab('officials')", app.context);
  assert.equal(app.element('admin-officials-panel').classList.contains('d-none'), false);
  assert.equal(app.element('admin-accounts-panel').classList.contains('d-none'), true);
  assert.equal(app.element('admin-offices-panel').classList.contains('d-none'), true);
  assert.equal(app.url(), '#admin/officials');
});

const dualProfile = { roles: ['admin', 'sksu_officials'], office_id: 3, office_name: 'College of Computer Studies', office_campus: 'Isulan',
  role_offices: { sksu_officials: { id: 3, name: 'College of Computer Studies', campus: 'Isulan', code: 'CCS' } } };

test('multiple roles show a role choice before opening any module after Google login', async () => {
  const app = page({ role: 'admin', profile: dualProfile, activeRole: 'admin' });
  await flush();
  await app.context.window.handleGoogleCredential({ credential: 'google-test-credential' });
  assert.equal(app.element('role-view').classList.contains('d-none'), false);
  assert.equal(app.element('app-view').classList.contains('d-none'), true);
  assert.match(app.element('role-options').innerHTML, /Administrator/);
  assert.match(app.element('role-options').innerHTML, /SKSU Officials/);
  assert.match(app.element('role-options').innerHTML, /College of Computer Studies — Isulan \[CCS\]/);
  assert.equal(app.calls.some(({ path }) => path.startsWith('/api/admin/') || path.includes('/routing/workspace')), false);
  assert.equal(app.url(), '#choose-role');
});

test('choosing SKSU Officials opens doc_router with office identity and role-scoped requests', async () => {
  const app = page({ token: 'dual-session', role: 'admin', profile: dualProfile });
  await flush();
  await vm.runInContext("chooseAccountRole('sksu_officials')", app.context);
  assert.equal(app.url(), '#doc_router');
  assert.equal(app.element('user-role').textContent, 'SKSU Officials');
  assert.equal(app.element('admin-nav-item').classList.contains('d-none'), true);
  assert.equal(app.calls.some(({ path }) => path.startsWith('/api/admin/')), false);
  assert.equal(app.calls.find(({ path }) => path.startsWith('/api/doc_router/routing/workspace')).options.headers.get('X-PAD-Role'), 'sksu_officials');
  assert.equal(app.storage.get('pad_active_role'), 'sksu_officials');
});

test('switching from SKSU Officials to Administrator retains one Google session', async () => {
  const app = page({ token: 'dual-session', role: 'admin', profile: dualProfile });
  await flush();
  await vm.runInContext("chooseAccountRole('sksu_officials')", app.context);
  await app.element('switch-role-button').click();
  assert.equal(app.element('role-view').classList.contains('d-none'), false);
  assert.equal(app.element('app-view').classList.contains('d-none'), true);
  await vm.runInContext("chooseAccountRole('admin')", app.context);
  assert.equal(app.url(), '#admin');
  assert.equal(app.element('user-role').textContent, 'Administrator');
  assert.equal(app.calls.find(({ path }) => path === '/api/admin/accounts').options.headers.get('X-PAD-Role'), 'admin');
  assert.equal(app.storage.get('pad_access_token'), 'dual-session');
  assert.equal(app.calls.some(({ path }) => path === '/api/auth/google'), false);
});

test('an SKSU-only identity cannot select Administrator', async () => {
  const app = page({ token: 'office-session', role: 'router', profile: { ...dualProfile, roles: ['sksu_officials'] } });
  await flush();
  await vm.runInContext("chooseAccountRole('admin')", app.context);
  vm.runInContext("changeSection('admin')", app.context);
  assert.equal(app.url(), '#doc_router');
  assert.equal(app.calls.some(({ path }) => path.startsWith('/api/admin/')), false);
});

test('reload restores an authorized selected role and doc_router queue', async () => {
  const app = page({ token: 'dual-session', role: 'admin', profile: dualProfile, activeRole: 'sksu_officials', hash: '#doc_router/incoming' });
  await flush();
  assert.equal(app.url(), '#doc_router/incoming');
  assert.equal(app.element('role-view').classList.contains('d-none'), true);
  assert.equal(app.element('section-documents').classList.contains('d-none'), false);
  assert.equal(app.calls.some(({ path }) => path.startsWith('/api/admin/')), false);
});

test('a role removed from the profile cannot be restored from local storage', async () => {
  const app = page({ token: 'office-session', role: 'router', profile: { ...dualProfile, roles: ['sksu_officials'] }, activeRole: 'admin' });
  await flush();
  assert.equal(app.url(), '#doc_router');
  assert.equal(app.storage.get('pad_active_role'), 'sksu_officials');
  assert.equal(app.calls.some(({ path }) => path.startsWith('/api/admin/')), false);
});

test('sign-out from role selection clears the identity and selected role', async () => {
  const app = page({ token: 'dual-session', role: 'admin', profile: dualProfile });
  await flush();
  app.element('role-logout-button').click();
  await flush();
  assert.equal(app.storage.has('pad_access_token'), false);
  assert.equal(app.storage.has('pad_active_role'), false);
  assert.equal(app.element('role-view').classList.contains('d-none'), true);
  assert.equal(app.element('auth-view').classList.contains('d-none'), false);
});

test('selecting SKSU Officials requires its office field in account management', async () => {
  const app = page({ token: 'admin-session', role: 'admin' });
  await flush();
  vm.runInContext('openAdminAccount()', app.context);
  app.element('admin-account-role-sksu-officials').checked = true;
  vm.runInContext('handleAccountRoleChange()', app.context);
  assert.equal(app.element('admin-account-office').required, true);
  app.element('admin-account-role-sksu-officials').checked = false;
  app.element('admin-account-role-admin').checked = true;
  app.element('admin-account-role-admin').change();
  assert.equal(app.element('admin-account-office').required, false);
});

test('registration loads role-scoped catalog choices and enables travel fields only for Travel Order', async () => {
  const app = page({ token: 'router-session', role: 'router', profile: { office_id: 1 }, respond(path) {
    if (path === '/api/doc_router/routing/registration-options') return { body: {
      document_types: [{ id: 1, name: 'ACTIVITY DESIGN', details_kind: 'personnel' }, { id: 7, name: 'TRAVEL ORDER', details_kind: 'travel_order' }],
      personnel: [{ id: 10, name: 'Sample <person>' }],
    } };
  } });
  await flush();
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.equal(app.element('upload-modal').visible, true);
  assert.match(app.element('document-type').innerHTML, /TRAVEL ORDER/);
  assert.match(app.element('document-personnel').innerHTML, /<option value="10">Sample &lt;person&gt;<\/option>/);
  assert.equal(app.element('document-personnel').disabled, true);
  assert.equal(app.element('travel-order-fields').disabled, true);
  assert.equal(app.element('upload-submit').disabled, false);
  const request = app.calls.find(({ path }) => path.endsWith('/registration-options'));
  assert.equal(request.options.headers.get('X-PAD-Role'), 'sksu_officials');
  app.element('document-type').value = '7';
  app.element('document-type').change();
  assert.equal(app.element('travel-order-section').classList.contains('d-none'), false);
  assert.equal(app.element('travel-order-fields').disabled, false);
  assert.equal(app.element('document-personnel').disabled, false);
  assert.match(app.element('document-personnel-label').textContent, /Travelers/);
  app.element('document-type').value = '1';
  app.element('document-type').change();
  assert.equal(app.element('travel-order-section').classList.contains('d-none'), true);
  assert.equal(app.element('travel-order-fields').disabled, true);
  assert.match(app.element('document-personnel-label').textContent, /optional/);
  app.element('travel-departure-date').value = '2026-10-10';
  app.element('travel-departure-date').change();
  assert.equal(app.element('travel-return-date').min, '2026-10-10');
});

test('failed registration catalog loading keeps saving disabled and reports the error', async () => {
  const app = page({ token: 'router-session', role: 'router', profile: { office_id: 1 }, respond(path) {
    if (path.endsWith('/registration-options')) return { status: 500, body: { message: 'Unable to load document types.' } };
  } });
  await flush();
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.equal(app.element('document-type').disabled, true);
  assert.equal(app.element('upload-submit').disabled, true);
  assert.equal(app.element('upload-error').classList.contains('d-none'), false);
  assert.equal(app.element('upload-error').textContent, 'Unable to load document types.');
  assert.equal(app.calls.some(({ options }) => options.method === 'POST'), false);
});

test('personnel Select2 searches the modal catalog and retains multiple selections', async () => {
  const configurations = [];
  const jquery = (node) => ({
    hasClass: () => Boolean(node.select2Initialized),
    select2(options) { node.select2Initialized = true; if (node.id === 'document-personnel') configurations.push(options); return this; },
    on(_event, handler) { node.jqueryChange = handler; return this; },
    trigger(event) { if (event === 'change') node.jqueryChange?.(); return this; },
  });
  jquery.fn = { select2() {} };
  const app = page({ token: 'router-session', role: 'router', profile: { office_id: 1 }, jquery, respond(path) {
    if (path.endsWith('/registration-options')) return { body: {
      document_types: [{ id: 7, name: 'TRAVEL ORDER', details_kind: 'travel_order' }],
      personnel: [{ id: 10, name: 'First Traveler' }, { id: 11, name: 'Second Traveler' }],
    } };
  } });
  await flush();
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].closeOnSelect, false);
  assert.equal(configurations[0].width, '100%');
  assert.match(configurations[0].placeholder, /Search and select/);
  assert.equal(configurations[0].maximumSelectionLength, 100);
  app.element('document-type').value = '7';
  app.element('document-type').change();
  app.element('document-personnel').selectedOptions = [{ value: '10' }, { value: '11' }];
  jquery(app.element('document-personnel')).trigger('change');
  assert.equal(app.element('personnel-selection-count').textContent, '2 names selected.');
  app.element('document-personnel').selectedOptions = [];
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.equal(configurations.length, 1);
  assert.equal(app.element('personnel-selection-count').textContent, 'No names selected.');
});

test('completed documents without a file show later upload only to an authorized office', async () => {
  for (const canUpload of [true, false]) {
    const app = page({ token: 'router-session', role: 'router', profile: { office_id: 1 }, respond(path) {
      if (path === '/api/doc_router/documents/PAD-2026-000111') return { body: { data: {
        reference_no: 'PAD-2026-000111', subject: 'Signed document', document_type: 'Memorandum', status: 'completed',
        file_name: null, stored_file_name: null, permissions: { upload_file: canUpload }, history: [],
      } } };
    } });
    await flush();
    await vm.runInContext("officeRouting.openDocument('PAD-2026-000111')", app.context);
    const html = app.element('document-detail').innerHTML;
    assert.match(html, /No document file uploaded yet/);
    assert.doesNotMatch(html, /href="[^"]*\/download"/);
    assert.equal(html.includes('id="document-attachment-form"'), canUpload);
    if (canUpload) assert.match(html, /even after completion/);
  }
});

test('later upload uses the Router endpoint and preserves retry controls after failure', async () => {
  let fail = true;
  class MultipartFixture { constructor(form) { this.form = form; } }
  const app = page({ token: 'router-session', role: 'router', profile: { office_id: 1 }, formData: MultipartFixture, respond(path, options) {
    if (path === '/api/doc_router/documents/PAD-2026-000111/file' && options.method === 'POST') {
      return fail ? { status: 422, body: { message: 'Only allowed document files can be uploaded.' } }
        : { body: { reference_no: 'PAD-2026-000111', message: 'Document file uploaded.' } };
    }
    if (path === '/api/doc_router/documents/PAD-2026-000111') return { body: { data: {
      reference_no: 'PAD-2026-000111', subject: 'Signed document', document_type: 'Memorandum', status: 'completed',
      file_name: 'signed.pdf', stored_file_name: 'stored.pdf', permissions: { upload_file: true },
      history: [{ action: 'file_uploaded', acted_by_name: 'Sample staff', notes: 'Updated document file: signed.pdf' }],
    } } };
  } });
  await flush();
  const button = { textContent: 'Upload file', disabled: false };
  const form = { id: 'document-attachment-form', dataset: { reference: 'PAD-2026-000111' }, querySelector: () => button };
  const event = { target: form, preventDefault() {} };
  await app.element('document-detail').submit(event);
  assert.equal(app.element('document-attachment-error').classList.contains('d-none'), false);
  assert.match(app.element('document-attachment-error').textContent, /Only allowed/);
  assert.equal(button.disabled, false);
  fail = false;
  await app.element('document-detail').submit(event);
  const request = app.calls.filter(({ path }) => path.endsWith('/file')).at(-1);
  assert.ok(request.options.body instanceof MultipartFixture);
  assert.equal(request.options.headers.get('X-PAD-Role'), 'sksu_officials');
  assert.equal(request.options.headers.has('Content-Type'), false);
  assert.match(app.element('document-detail').innerHTML, /signed.pdf/);
  assert.match(app.element('document-detail').innerHTML, /Document file uploaded/);
  assert.match(app.element('document-detail').innerHTML, /This replaces the current attached file/);
  assert.equal(button.disabled, false);
});

test('Document source contains only the division catalog and saves the selected identity', async () => {
  const app = page({ token: 'admin-session', role: 'admin', profile: { office_id: 1 }, respond(path) {
    if (path.startsWith('/api/routing/workspace')) return { body: { data: [], can_register_external: true } };
    if (path.endsWith('/registration-options')) return { body: {
      document_types: [{ id: 1, name: 'EMAIL', details_kind: 'personnel' }], personnel: [],
      source_divisions: [{ id: 12, name: 'Sample & Agency' }, { id: 13, name: 'Second Agency' }],
    } };
  } });
  await flush();
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.match(app.element('origin-type').innerHTML, /value="division:12">Sample &amp; Agency/);
  assert.match(app.element('origin-type').innerHTML, /value="division:13">Second Agency/);
  assert.doesNotMatch(app.element('origin-type').innerHTML, /My office|value="office"/);
  assert.equal(app.element('origin-type').disabled, false);
  assert.equal(app.element('origin-type').value, '');
  app.element('origin-type').value = 'division:12';
  app.element('origin-type').change();
  assert.equal(app.element('document-origin-value').value, 'external');
  assert.equal(app.element('document-source-division').value, '12');
  app.element('origin-type').value = '';
  app.element('origin-type').change();
  assert.equal(app.element('document-origin-value').value, 'office');
  assert.equal(app.element('document-source-division').value, '');
});

test('ordinary Router accounts select a source owner while registering for their assigned office', async () => {
  const app = page({ token: 'router-session', role: 'router', profile: { office_id: 1 }, respond(path) {
    if (path.endsWith('/registration-options')) return { body: {
      document_types: [{ id: 1, name: 'EMAIL', details_kind: 'personnel' }], personnel: [],
      source_divisions: [{ id: 12, name: 'Sample Agency' }],
    } };
  } });
  await flush();
  await vm.runInContext('officeRouting.openUpload()', app.context);
  assert.doesNotMatch(app.element('origin-type').innerHTML, /disabled|My office/);
  app.element('origin-type').value = 'division:12';
  app.element('origin-type').change();
  assert.equal(app.element('document-origin-value').value, 'office');
  assert.equal(app.element('document-source-division').value, '12');
});

test('source selection is submitted separately from the registering office and shown as the origin', async () => {
  for (const role of ['router', 'admin']) {
    class RegistrationForm {
      constructor() { this.fields = new Map([['document_type_id', '1'], ['document_source', 'division:12']]); }
      get(name) { return this.fields.get(name); }
      getAll() { return []; }
      set(name, value) { this.fields.set(name, value); }
      delete(name) { this.fields.delete(name); }
    }
    const reference = 'PAD-2026-000123';
    const app = page({ token: 'sample-session', role, profile: { office_id: 1 }, formData: RegistrationForm, respond(path, options) {
      if (path.includes('/routing/workspace')) return { body: { data: [], can_register_external: role === 'admin' } };
      if (path.endsWith('/registration-options')) return { body: {
        document_types: [{ id: 1, name: 'EMAIL', details_kind: 'personnel' }], personnel: [], source_divisions: [{ id: 12, name: 'Sample source owner' }],
      } };
      if (path.endsWith('/documents') && options.method === 'POST') return { body: { reference_no: reference } };
      if (path.endsWith('/documents/' + reference)) return { body: { data: {
        reference_no: reference, subject: 'Sample', status: 'created', document_type: 'EMAIL', source_division_id: 12,
        external_sender: 'Sample source owner', source_office_name: 'Registering Office', current_office_name: 'Registering Office', history: [],
      } } };
    } });
    await flush();
    await vm.runInContext('officeRouting.openUpload()', app.context);
    await vm.runInContext('officeRouting.uploadDocument({preventDefault(){}, currentTarget:{}})', app.context);
    const request = app.calls.find(({ path, options }) => path.endsWith('/documents') && options.method === 'POST');
    assert.equal(request.options.body.get('source_division_id'), '12');
    assert.equal(request.options.body.get('origin_type'), role === 'admin' ? 'external' : 'office');
    assert.equal(request.options.body.get('document_source'), undefined);
    assert.equal(app.url(), role === 'admin' ? '#routing/received' : '#doc_router/my_documents');
    await vm.runInContext("officeRouting.openDocument('PAD-2026-000123')", app.context);
    assert.match(app.element('document-detail').innerHTML, /Origin<\/small><strong[^>]*>Sample source owner/);
  }
});


test('PAD keeps For Approval, Records gets For Action, and every role retains Returned without PAD Results', async () => {
  for (const role of ['ovp_pad', 'ovp_central_records', 'sksu_officials']) {
    const app = page({ token: 'sample', role: 'staff', profile: { roles: [role], office_id: role === 'ovp_pad' ? 80 : 2 }, respond(path) {
      if (path.includes('/routing/workspace')) return { body: { data: [], counts: { for_approval: 1, for_action: 2, pad_results: 2 } } };
    } });
    await flush();
    const html = app.element('routing-stats').innerHTML;
    assert.equal(html.includes('data-open-queue="for_approval"'), role === 'ovp_pad');
    assert.equal(html.includes('data-open-queue="for_action"'), role === 'ovp_central_records');
    assert.equal(html.includes('data-open-queue="pad_results"'), false);
    assert.equal(html.includes('data-open-queue="returned"'), true);
    assert.match(html, /Awaiting Receipt/);
  }
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(markup, /data-routing-queue="pad_results"|data-queue-count="pad_results"|routing-act-received/);
  assert.match(markup, /data-routing-queue="returned"/);
  assert.match(markup, /data-queue-count="returned"/);
  assert.match(markup, /data-routing-queue="for_action"/);
  assert.match(markup, /data-queue-count="for_action"/);
});

test('For Approval uses simple cards with sender, purpose and physical status', async () => {
  const app = page({ token: 'sample', role: 'staff', hash: '#doc_router/for_approval', profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path) {
    if (path.includes('/routing/workspace')) return { body: { data: [approvalDocument], counts: { for_approval: 1 } } };
    if (path.endsWith('/documents/PAD-2026-000777')) return { body: { data: approvalDocument } };
  } });
  await flush();
  const html = app.element('received-card-list').innerHTML;
  assert.match(html, /OVP Central Records/);
  assert.match(html, /For approval/);
  assert.match(html, /Record decision & return/);
  assert.doesNotMatch(html, /Sample Receiver|Received Date|Encoded by/);
  assert.equal(app.element('document-table-wrap').classList.contains('d-none'), true);
  await vm.runInContext("officeRouting.openDocument('PAD-2026-000777')", app.context);
  assert.match(app.element('document-detail').innerHTML, /Received by Sample Receiver/);
});

test('PAD decision form requires reasons and sends the selected outcome through the role endpoint', async () => {
  const app = page({ token: 'sample', role: 'staff', profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path, options) {
    if (path.endsWith('/documents/PAD-2026-000777')) return { body: { data: approvalDocument } };
    if (path.endsWith('/decide') && options.method === 'POST') return { body: { message: 'Decision recorded.' } };
  } });
  await flush();
  vm.runInContext("officeRouting.handleClick({target:{closest:(selector)=>selector==='[data-routing-action]'?{dataset:{routingAction:'decide',reference:'PAD-2026-000777'}}:null}})", app.context);
  await flush();
  assert.equal(app.element('routing-decision-wrap').classList.contains('d-none'), false);
  assert.equal(app.element('routing-destination-wrap').classList.contains('d-none'), true);
  assert.match(app.element('routing-action-description').textContent, /Returning to: Presidential Action Desk - Records/);
  app.element('routing-decision').value = 'returned_for_correction';
  app.element('routing-decision').change();
  assert.equal(app.element('routing-notes').required, true);
  await app.element('routing-action-form').submit({ preventDefault() {} });
  assert.match(app.element('routing-action-error').textContent, /reason or correction instructions/);
  assert.equal(app.calls.some(({ path }) => path.endsWith('/decide')), false);
  app.element('routing-notes').value = 'Attach the signed request.';
  await app.element('routing-action-form').submit({ preventDefault() {} });
  const call = app.calls.find(({ path }) => path.endsWith('/decide'));
  assert.equal(call.path, '/api/doc_router/documents/PAD-2026-000777/decide');
  assert.equal(call.options.headers.get('X-PAD-Role'), 'ovp_pad');
  assert.deepEqual(JSON.parse(call.options.body), { decision: 'returned_for_correction', notes: 'Attach the signed request.' });
});

test('PAD decisions await a separate receipt with Receive, no Act, and retain all review cycles in details', async () => {
  const result = { ...approvalDocument, status: 'in_transit', awaiting_pad_decision: false, pending_office_id: 2,
    is_pad_return: true, is_issue_return: false, movement_type: 'return',
    last_from_office_name: 'Exact PAD Office', last_sender_role: 'ovp_pad', pad_decision: 'approved',
    permissions: { receive: true, act: true, route: true, return: true }, pad_reviews: [
      { decision: 'returned_for_correction', decision_notes: '<script>Attach supporting papers</script>', decided_by_name: 'Sample PAD Staff', decided_at: '2026-10-06 01:00:00' },
      { decision: 'approved', decided_by_name: 'Sample PAD Staff', decided_at: '2026-10-07 01:00:00' },
    ] };
  const app = page({ token: 'sample', role: 'staff', hash: '#doc_router/incoming', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path) {
    if (path.includes('/routing/workspace')) return { body: { data: [result], counts: { incoming: 1, returned: 0 } } };
    if (path.endsWith('/documents/PAD-2026-000777')) return { body: { data: result } };
  } });
  await flush();
  assert.match(app.element('document-list').innerHTML, /OVP PAD/);
  assert.match(app.element('document-list').innerHTML, /Approved/);
  assert.match(app.element('document-list').innerHTML, /Awaiting receipt/);
  assert.doesNotMatch(app.element('document-list').innerHTML, /Returning/);
  assert.deepEqual(Array.from(app.element('document-list').innerHTML.matchAll(/<button[^>]*>(.*?)<\/button>/g), m => m[1]), ['View', 'Receive']);
  assert.equal(app.element('queue-count-returned').textContent, 0);
  await vm.runInContext("officeRouting.openDocument('PAD-2026-000777')", app.context);
  const detail = app.element('document-detail').innerHTML;
  assert.match(detail, /Review 1: Returned for correction/);
  assert.match(detail, /Review 2: Approved/);
  assert.match(detail, /Recorded by Sample PAD Staff/);
  assert.doesNotMatch(detail, /<script>/);
  assert.match(detail, /data-routing-action="receive"/);
  assert.doesNotMatch(detail, /data-routing-action="act"/);
  vm.runInContext("officeRouting.handleClick({target:{closest:s=>s==='[data-routing-action]'?{dataset:{routingAction:'act',reference:'PAD-2026-000777'}}:null}})", app.context);
  await flush();
  assert.notEqual(app.element('routing-action-modal').visible, true);
  assert.match(app.element('notice').textContent, /no longer available/);
});


test('older PAD returns show a missing decision without inventing an outcome', async () => {
  const document = { ...approvalDocument, current_office_id: 2, awaiting_pad_decision: false,
    last_from_office_name: 'Exact PAD Office', last_sender_role: 'ovp_pad', pad_result_unrecorded: true,
    permissions: { route: true }, pad_reviews: [] };
  const app = page({ token: 'sample', role: 'staff', hash: '#doc_router/for_action', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path) {
    if (path.includes('/routing/workspace')) return { body: { data: [document] } };
    if (path.endsWith('/documents/PAD-2026-000777')) return { body: { data: document } };
  } });
  await flush();
  assert.match(app.element('received-card-list').innerHTML, /Decision not recorded/);
  assert.doesNotMatch(app.element('received-card-list').innerHTML, /badge-pad-approved|badge-pad-disapproved/);
  await vm.runInContext("officeRouting.openDocument('PAD-2026-000777')", app.context);
  assert.match(app.element('document-detail').innerHTML, /No PAD decision has been recorded for this return/);
});

test('old PAD Results links open Awaiting Receipt without restoring a duplicate menu', async () => {
  const app = page({ token: 'sample', hash: '#doc_router/pad_results', profile: { roles: ['ovp_central_records'], office_id: 2 } });
  await flush();
  assert.equal(app.url(), '#doc_router/incoming');
  const request = app.calls.filter(call => call.path.endsWith('/routing/workspace')).at(-1);
  assert.equal(new URL(request.url).searchParams.get('queue'), 'incoming');
  assert.doesNotMatch(app.element('routing-stats').innerHTML, /data-open-queue="pad_results"/);
});

test('For Action opens directly for Records and shows every PAD outcome with its own count', async () => {
  const outcomes = ['approved', 'disapproved', 'returned_for_correction'];
  const records = outcomes.map((decision, index) => ({ ...approvalDocument, reference_no: `26-0655${index}`,
    current_office_id: 2, pending_office_id: null, awaiting_pad_decision: false, is_pad_return: true,
    last_sender_role: 'ovp_pad', pad_decision: decision, permissions: { act: true } }));
  const app = page({ token: 'sample', hash: '#doc_router/for_action', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path) {
    if (path.endsWith('/routing/workspace')) return { body: { data: records, counts: { for_action: 3, received: 0, incoming: 0 },
      pagination: { page: 1, pages: 1, total: 3 } } };
  } });
  await flush();
  assert.equal(app.url(), '#doc_router/for_action');
  assert.equal(app.element('routing-queue-title').textContent, 'For Action');
  assert.equal(app.element('queue-count-for_action').textContent, 3);
  assert.equal(app.element('queue-count-received').textContent, 0);
  assert.equal(app.element('queue-count-incoming').textContent, 0);
  const html = app.element('received-card-list').innerHTML;
  for (const label of ['Approved', 'Disapproved', 'Returned for correction']) assert.ok(html.includes(label));
  assert.equal((html.match(/data-routing-action="act"/g) || []).length, 3);
  assert.doesNotMatch(html, /data-routing-action="receive"/);
  assert.match(app.element('routing-stats').innerHTML, /data-open-queue="for_action"[^]*?routing-stat-value">3</);
});


test('My Document shows only Send and Delete and keeps the timeline accessible from its title', async () => {
  const record = { reference_no: 'PAD-2026-000800', subject: 'Own <draft>', status: 'created', is_my_document: true,
    permissions: { route: true, delete: true }, history: [] };
  const app = page({ token: 'sample', role: 'staff', hash: '#doc_router/my_documents', profile: { roles: ['sksu_officials'], office_id: 9 }, respond(path) {
    if (path.includes('/routing/workspace')) return { body: { data: [record], counts: { my_documents: 1 } } };
  } });
  await flush();
  assert.equal(app.element('routing-queue-title').textContent, 'My Document');
  const html = app.element('received-card-list').innerHTML;
  assert.deepEqual(Array.from(html.matchAll(/<button[^>]*>(.*?)<\/button>/g), m => m[1]), ['Send', 'Delete']);
  assert.match(html, /data-document="PAD-2026-000800">OWN &lt;DRAFT&gt;<\/a>/);
});

test('Awaiting Receipt shows View, Receive and Return with no Act or Send', async () => {
  const record = { reference_no: 'PAD-2026-000801', subject: 'Incoming', status: 'in_transit',
    permissions: { receive: true, return: true }, pending_office_id: 9 };
  const app = page({ token: 'sample', role: 'staff', hash: '#doc_router/incoming', profile: { roles: ['sksu_officials'], office_id: 9 }, respond(path) {
    if (path.includes('/routing/workspace')) return { body: { data: [record] } };
  } });
  await flush();
  assert.deepEqual(Array.from(app.element('document-list').innerHTML.matchAll(/<button[^>]*>(.*?)<\/button>/g), m => m[1]), ['View', 'Receive', 'Return']);
});

test('receipt remark selection saves standard, custom or empty notes without leaking into Return', async () => {
  const reference = 'PAD-2026-000801';
  const record = { reference_no: reference, permissions: { receive: true, return: true }, last_from_office_name: 'College of Computer Studies' };
  const app = page({ token: 'sample', role: 'staff', hash: '#doc_router/incoming', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path, options) {
    if (path.endsWith(`/documents/${reference}`)) return { body: { data: record } };
    if (path.endsWith('/receive') && options.method === 'POST') return { body: { message: 'Receipt recorded.' } };
  } });
  await flush();
  const open = async (action) => {
    vm.runInContext(`officeRouting.handleClick({target:{closest:(selector)=>selector==='[data-routing-action]'?{dataset:{routingAction:'${action}',reference:'${reference}'}}:null}})`, app.context);
    await flush();
  };
  const select = (value) => {
    app.element('routing-receipt-remark').value = value;
    app.element('routing-receipt-remark').change();
  };
  const submit = () => app.element('routing-action-form').submit({ preventDefault() {} });
  await open('receive');
  assert.equal(app.element('routing-receipt-remark-wrap').classList.contains('d-none'), false);
  assert.equal(app.element('routing-notes').disabled, true);
  select('custom');
  assert.equal(app.element('routing-notes').disabled, false);
  await submit();
  assert.match(app.element('routing-action-error').textContent, /custom receipt remark/);
  assert.equal(app.calls.some(({ path }) => path.endsWith('/receive')), false);
  app.element('routing-notes').value = '  Received with two supporting attachments.  ';
  await submit();
  await open('receive');
  select('custom');
  app.element('routing-notes').value = 'This draft should not be sent.';
  select('Received for review.');
  assert.equal(app.element('routing-notes').disabled, true);
  await submit();
  await open('receive');
  assert.equal(app.element('routing-receipt-remark').value, '');
  await submit();
  const receipts = app.calls.filter(({ path }) => path.endsWith('/receive'));
  assert.deepEqual(receipts.map(({ options }) => JSON.parse(options.body).notes), ['Received with two supporting attachments.', 'Received for review.', '']);
  assert.equal(receipts[0].options.headers.get('X-PAD-Role'), 'ovp_central_records');
  await open('return');
  assert.equal(app.element('routing-receipt-remark-wrap').classList.contains('d-none'), true);
  assert.equal(app.element('routing-receipt-remark').disabled, true);
  assert.equal(app.element('routing-notes-wrap').classList.contains('d-none'), false);
  assert.equal(app.element('routing-notes').disabled, false);
  assert.equal(app.element('routing-notes').required, true);
});

test('Delete confirms first, calls the scoped DELETE endpoint and stays open after a conflict', async () => {
  let conflict = true;
  const record = { reference_no: 'PAD-2026-000802', is_my_document: true, permissions: { delete: true }, history: [] };
  const app = page({ token: 'sample', role: 'staff', profile: { roles: ['sksu_officials'], office_id: 9 }, respond(path, options) {
    if (path.endsWith('/documents/PAD-2026-000802')) return options.method === 'DELETE'
      ? conflict ? { status: 409, body: { message: 'Already sent; cannot delete.' } } : { body: { message: 'Deleted.' } }
      : { body: { data: record } };
  } });
  await flush();
  await vm.runInContext("officeRouting.handleClick({target:{closest(s){return s === '[data-routing-action]' ? {dataset:{routingAction:'delete',reference:'PAD-2026-000802'}} : null}},preventDefault(){}})", app.context);
  await flush();
  assert.equal(app.element('routing-action-modal').visible, true);
  assert.equal(app.calls.some(c => c.options.method === 'DELETE'), false);
  assert.equal(app.element('routing-notes').disabled, true);
  assert.match(app.element('routing-action-description').textContent, /cannot be undone/);
  await app.element('routing-action-form').submit({ preventDefault() {} });
  assert.equal(app.element('routing-action-modal').visible, true);
  assert.match(app.element('routing-action-error').textContent, /Already sent/);
  conflict = false;
  await app.element('routing-action-form').submit({ preventDefault() {} });
  assert.equal(app.element('routing-action-modal').visible, false);
  assert.equal(app.url(), '#doc_router/my_documents');
  assert.equal(app.calls.filter(c => c.options.method === 'DELETE').at(-1).options.headers.get('X-PAD-Role'), 'sksu_officials');
});

test('Act explains missing prerequisites and displays escaped latest routing notes in View', async () => {
  const record = { reference_no: 'PAD-2026-000803', status: 'received', permissions: { act: true },
    act_blockers: ['Attach the document first.'], last_route_notes: '<script>PAD instructions</script>', history: [] };
  const app = page({ token: 'sample', role: 'staff', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path) {
    if (path.endsWith('/documents/PAD-2026-000803')) return { body: { data: record } };
  } });
  await flush();
  await vm.runInContext("officeRouting.handleClick({target:{closest(s){return s === '[data-routing-action]' ? {dataset:{routingAction:'act',reference:'PAD-2026-000803'}} : null}},preventDefault(){}})", app.context);
  await flush();
  assert.notEqual(app.element('routing-action-modal').visible, true);
  assert.match(app.element('notice').textContent, /Attach the document first/);
  await vm.runInContext("officeRouting.openDocument('PAD-2026-000803')", app.context);
  assert.match(app.element('document-detail').innerHTML, /Latest routing notes/);
  assert.match(app.element('document-detail').innerHTML, /&lt;script&gt;PAD instructions&lt;\/script&gt;/);
});

test('Records receives the PAD decision into For Action, then acts without a repeated receipt confirmation', async () => {
  let received = false; let released = false;
  const reference = 'PAD-2026-000804';
  const pending = { reference_no: reference, subject: 'Signed campus request', status: 'in_transit', current_office_id: 80,
    pending_office_id: 2, source_office_id: 9, is_pad_return: true, permissions: { act: false, receive: true }, history: [] };
  const confirmed = { ...pending, current_office_id: 2, pending_office_id: null, status: 'received', permissions: { act: true } };
  const sent = { ...pending, is_pad_return: false, is_owner_release: true, current_office_id: 2, pending_office_id: 9, permissions: {} };
  const app = page({ token: 'sample', role: 'staff', hash: '#doc_router/incoming', profile: { roles: ['ovp_central_records'], office_id: 2 }, respond(path, options, requestUrl) {
    if (path.endsWith('/offices')) return { body: { data: [{ id: 2, name: 'Records' }, { id: 80, name: 'PAD' }, { id: 9, name: 'College owner' }] } };
    if (path.includes('/routing/workspace')) {
      const queue = requestUrl.searchParams.get('queue');
      const document = released ? sent : received ? confirmed : pending;
      const present = queue === 'incoming' ? !received : queue === 'for_action' ? received && !released : queue === 'received' ? false : true;
      return { body: { data: present ? [document] : [], counts: { incoming: received ? 0 : 1, received: 0, for_action: received && !released ? 1 : 0 },
        pagination: { page: 1, pages: 1, total: present ? 1 : 0 } } };
    }
    if (path.endsWith(`/documents/${reference}`)) return { body: { data: released ? sent : received ? confirmed : pending } };
    if (path.endsWith('/receive') && options.method === 'POST') { received = true; return { body: { message: 'Receipt confirmed.' } }; }
    if (path.endsWith('/act') && options.method === 'POST') { released = true; return { body: { message: 'Acted and sent to owner.' } }; }
  } });
  await flush();
  assert.deepEqual(Array.from(app.element('document-list').innerHTML.matchAll(/<button[^>]*>(.*?)<\/button>/g), m => m[1]), ['View', 'Receive']);
  vm.runInContext(`officeRouting.handleClick({target:{closest:(selector)=>selector==='[data-routing-action]'?{dataset:{routingAction:'receive',reference:'${reference}'}}:null}})`, app.context);
  await flush();
  assert.equal(app.element('routing-action-title').textContent, 'Confirm hard-copy receipt');
  assert.equal(app.element('routing-receipt-remark-wrap').classList.contains('d-none'), false);
  for (const remark of ['Hard copy received.', 'Received for review.', 'Received for appropriate action.', 'Received for approval.', 'Received for signature.', 'Received for filing.', 'Other / custom remark']) {
    assert.ok(app.element('routing-receipt-remark').innerHTML.includes(remark));
  }
  app.element('routing-receipt-remark').value = 'Hard copy received.';
  await app.element('routing-action-form').submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(app.calls.find(({ path }) => path.endsWith('/receive')).options.body), { notes: 'Hard copy received.' });
  assert.deepEqual(app.calls.filter(({ path }) => path.endsWith('/routing/workspace')).map(({ url }) => new URL(url).searchParams.get('queue')), ['incoming', 'for_action']);
  assert.equal(app.url(), '#doc_router/for_action');
  assert.equal(app.element('routing-queue-title').textContent, 'For Action');
  assert.equal(app.element('queue-count-for_action').textContent, 1);
  assert.equal(app.element('queue-count-received').textContent, 0);
  assert.equal(app.element('queue-count-incoming').textContent, 0);
  assert.deepEqual(Array.from(app.element('received-card-list').innerHTML.matchAll(/<button[^>]*>(.*?)<\/button>/g), m => m[1]), ['View', 'Act']);
  vm.runInContext(`officeRouting.handleClick({target:{closest:(selector)=>selector==='[data-routing-action]'?{dataset:{routingAction:'act',reference:'${reference}'}}:null}})`, app.context);
  await flush();
  assert.equal(app.element('routing-action-title').textContent, 'Act & send to owner');
  assert.equal(app.element('routing-destination-wrap').classList.contains('d-none'), false);
  assert.equal(app.element('routing-destination').value, '9');
  assert.doesNotMatch(app.element('routing-destination').innerHTML, /value="2"/);
  assert.equal(app.element('routing-receipt-remark-wrap').classList.contains('d-none'), true);
  app.element('routing-notes').value = 'Checked the approved copy and released it to the college.';
  app.element('routing-destination').value = '';
  await app.element('routing-action-form').submit({ preventDefault() {} });
  assert.equal(app.calls.some(({ path }) => path.endsWith('/act')), false);
  app.element('routing-destination').value = '9';
  await app.element('routing-action-form').submit({ preventDefault() {} });
  const call = app.calls.find(({ path }) => path.endsWith('/act'));
  assert.deepEqual(JSON.parse(call.options.body), { notes: 'Checked the approved copy and released it to the college.', owner_office_id: 9 });
  assert.equal(app.calls.filter(({ path }) => path.endsWith('/receive')).length, 1);
  assert.equal(call.options.headers.get('X-PAD-Role'), 'ovp_central_records');
  assert.equal(app.url(), '#doc_router/acted');
  assert.deepEqual(app.calls.filter(({ path }) => path.endsWith('/routing/workspace')).map(({ url }) => new URL(url).searchParams.get('queue')), ['incoming', 'for_action', 'acted']);
  assert.equal(app.calls.filter(({ path }) => path.endsWith('/offices')).length, 1);
  assert.equal(app.element('queue-count-for_action').textContent, 0);
  assert.match(app.element('document-list').innerHTML, /Acted.*Awaiting owner receipt/);
  assert.equal(app.element('routing-action-modal').visible, false);
  let ownerReceived = false;
  const ownerPending = { ...sent, permissions: { receive: true } };
  const ownerDelivered = { ...sent, status: 'delivered', pending_office_id: null, current_office_id: 9 };
  const ownerApp = page({ token: 'owner-sample', role: 'staff', hash: '#doc_router/incoming', profile: { roles: ['sksu_officials'], office_id: 9 }, respond(path, options) {
    if (path.includes('/routing/workspace')) return { body: { data: [ownerReceived ? ownerDelivered : ownerPending] } };
    if (path.endsWith(`/documents/${reference}`)) return { body: { data: ownerPending } };
    if (path.endsWith('/receive') && options.method === 'POST') { ownerReceived = true; return { body: { delivery_confirmed: true, message: 'Owner delivery confirmed.' } }; }
  } });
  await flush();
  vm.runInContext(`officeRouting.handleClick({target:{closest:(selector)=>selector==='[data-routing-action]'?{dataset:{routingAction:'receive',reference:'${reference}'}}:null}})`, ownerApp.context);
  await flush();
  assert.match(ownerApp.element('routing-action-description').textContent, /owner office.*records delivery/);
  await ownerApp.element('routing-action-form').submit({ preventDefault() {} });
  assert.equal(ownerApp.url(), '#doc_router/delivered');
  assert.deepEqual(ownerApp.calls.filter(({ path }) => path.endsWith('/routing/workspace')).map(({ url }) => new URL(url).searchParams.get('queue')), ['incoming', 'delivered']);
  assert.match(ownerApp.element('document-list').innerHTML, /Delivered to owner/);
});

test('queue loaders hide stale actions, disable pagination, and keep the newest search busy until it finishes', async () => {
  const pending = [];
  let delay = false;
  const workspace = (subject) => ({ body: { data: [{ ...approvalDocument, subject }], counts: {}, pagination: { page: 1, pages: 2, total: 30 } } });
  const app = page({ token: 'sample', hash: '#doc_router/all', profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path, options) {
    if (delay && path.endsWith('/routing/workspace')) return new Promise((resolve) => pending.push({ resolve, signal: options.signal }));
    if (path.endsWith('/routing/workspace')) return workspace('Original document');
  } });
  await flush(); delay = true;
  const first = vm.runInContext('officeRouting.refresh()', app.context);
  await flush();
  assert.match(app.element('document-list').innerHTML, /spinner-border.*Loading documents/s);
  assert.doesNotMatch(app.element('document-list').innerHTML, /Original document|data-routing-action/);
  assert.equal(app.element('document-list').getAttribute('aria-busy'), 'true');
  assert.equal(app.element('routing-next').disabled, true);
  app.element('document-search').value = 'Newest';
  const second = vm.runInContext('officeRouting.refresh()', app.context);
  await flush();
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(workspace('Old response')); await first;
  assert.equal(app.element('document-list').getAttribute('aria-busy'), 'true');
  assert.match(app.element('document-list').innerHTML, /Loading documents/);
  pending[1].resolve(workspace('Newest response')); await second;
  assert.match(app.element('document-list').innerHTML, /Newest response/i);
  assert.doesNotMatch(app.element('document-list').innerHTML, /Old response|Loading documents/);
  assert.equal(app.element('document-list').getAttribute('aria-busy'), 'false');
  assert.equal(app.element('routing-next').disabled, false);
});

test('overview and card queues show loaders and failures offer a working retry without old records', async () => {
  for (const hash of ['', '#doc_router/for_approval']) {
    let finish;
    let mode = 'ready';
    const app = page({ token: 'sample', hash, profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path) {
      if (!path.endsWith('/routing/workspace')) return;
      if (mode === 'pending') return new Promise((resolve) => { finish = resolve; });
      return { body: { data: [approvalDocument] } };
    } });
    await flush(); mode = 'pending';
    const refresh = vm.runInContext('officeRouting.refresh()', app.context);
    await flush();
    const target = app.element(hash ? 'received-card-list' : 'overview-documents');
    assert.match(target.innerHTML, /Loading documents/);
    assert.equal(target.getAttribute('aria-busy'), 'true');
    finish({ status: 503, body: { message: 'Temporary outage.' } }); await refresh;
    assert.match(target.innerHTML, /could not be loaded.*data-retry-documents/s);
    assert.doesNotMatch(target.innerHTML, /Campus request/);
    assert.equal(target.getAttribute('aria-busy'), 'false');
    mode = 'ready';
    vm.runInContext("officeRouting.handleClick({target:{closest:s=>s==='[data-retry-documents]'?{}:null}})", app.context);
    await flush();
    assert.match(target.innerHTML, /Campus request/i);
  }
});

test('office directory requests are shared, expire, invalidate after edits, and clear on role reset', async () => {
  let now = Date.now(); let finish;
  let delay = false;
  const app = page({ token: 'sample', hash: '#doc_router/all', profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path) {
    if (path.endsWith('/offices') && delay) return new Promise(resolve => { finish = resolve; });
  } });
  await flush();
  vm.runInContext(`Date = class extends Date { static now() { return ${now}; } }`, app.context);
  await vm.runInContext('officeRouting.refresh(); officeRouting.refresh()', app.context);
  await flush();
  const officeCalls = () => app.calls.filter(({ path }) => path.endsWith('/offices')).length;
  assert.equal(officeCalls(), 1);
  vm.runInContext(`Date.now = () => ${now + 61000}`, app.context);
  await vm.runInContext('officeRouting.refresh()', app.context);
  assert.equal(officeCalls(), 2);
  delay = true;
  vm.runInContext('officeRouting.invalidateOffices(); officeRouting.refresh(); officeRouting.refresh()', app.context);
  await flush();
  assert.equal(officeCalls(), 3);
  finish({ body: { data: [{ id: 9, name: 'Updated office' }] } }); await flush();
  assert.match(app.element('routing-office-filter').innerHTML, /Updated office/);
  vm.runInContext('officeRouting.reset()', app.context);
  delay = false;
  await vm.runInContext('officeRouting.refresh()', app.context);
  assert.equal(officeCalls(), 4);
  assert.doesNotMatch(app.element('routing-office-filter').innerHTML, /Updated office/);
});

test('role reset aborts a loading queue and a late response cannot restore documents', async () => {
  let finish; let signal;
  let delay = false;
  const app = page({ token: 'sample', hash: '#doc_router/all', profile: { roles: ['ovp_pad'], office_id: 80 }, respond(path, options) {
    if (delay && path.endsWith('/routing/workspace')) {
      signal = options.signal;
      return new Promise(resolve => { finish = resolve; });
    }
  } });
  await flush(); delay = true;
  const refresh = vm.runInContext('officeRouting.refresh()', app.context);
  await flush();
  vm.runInContext('officeRouting.reset()', app.context);
  assert.equal(signal.aborted, true);
  finish({ body: { data: [{ ...approvalDocument, subject: 'Private old response' }] } });
  await refresh;
  assert.doesNotMatch(app.element('document-list').innerHTML, /Private old response/);
  assert.equal(app.element('document-list').getAttribute('aria-busy'), 'false');
});
