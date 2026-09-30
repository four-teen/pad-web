import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
  .replace('import.meta.env.VITE_API_BASE_URL', JSON.stringify('http://pad.test'));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function page({ token, authorize = true, restore = true, role = 'staff' } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(id === 'app-view' || (id.startsWith('section-') && id !== 'section-dashboard') ? ['d-none'] : []);
      elements.set(id, {
        id, textContent: '', innerHTML: '', value: '', dataset: {},
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
        addEventListener(name, handler) { this[name] = handler; },
      });
    }
    return elements.get(id);
  }
  const storage = new Map(token ? [['pad_access_token', token]] : []);
  const calls = [];
  let rendered = 0;
  let disabledAutoSelect = 0;
  let currentUrl = '/';
  const sections = ['dashboard', 'documents', 'track', 'admin'].map((name) => element(`section-${name}`));
  const navigation = ['dashboard', 'documents', 'track', 'admin'].map((name) => {
    const item = element(`nav-${name}`);
    item.dataset.nav = name;
    return item;
  });
  const user = { id: 1, name: 'Approved Staff', email: 'allowed@example.test', role, avatar_url: null };
  const context = vm.createContext({
    Headers, URL, Intl, Date, console, setTimeout, clearTimeout,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    bootstrap: { Modal: class { hide() {} } },
    document: { getElementById: element, addEventListener() {}, querySelectorAll: (selector) => selector === '.app-section' ? sections : selector === '[data-nav]' ? navigation : [],
      head: { appendChild(script) { script.onload(); } }, createElement: () => ({ remove() {} }) },
    window: { scrollTo() {}, location: { pathname: '/', search: '' }, history: { replaceState(_state, _title, url) { currentUrl = url; } }, google: { accounts: { id: {
      initialize() {}, renderButton() { rendered++; }, disableAutoSelect() { disabledAutoSelect++; }
    } } } },
    fetch: async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, options });
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
      else body = { data: [] };
      return { ok: status === 200, status, json: async () => body };
    }
  });
  vm.runInContext(source, context);
  return { context, element, storage, calls, rendered: () => rendered, disabledAutoSelect: () => disabledAutoSelect, url: () => currentUrl };
}

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
  assert.equal(app.url(), '#dashboard');
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
  assert.equal(app.calls.filter(({ path }) => path.startsWith('/api/admin/')).length, 4);
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
  assert.equal(app.url(), '#dashboard');
  assert.equal(app.calls.some(({ path }) => path.startsWith('/api/admin/')), false);
});
