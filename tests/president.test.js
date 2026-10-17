import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresidentView } from '../src/president/index.js';
import { presidentReport, presidentOffices, presidentDocuments } from './president-fixtures.js';

function fixture(respond) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      const attributes = new Map();
      elements.set(id, { value: '', textContent: '', innerHTML: '', disabled: false,
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
        setAttribute: (key, value) => attributes.set(key, value), getAttribute: (key) => attributes.get(key),
        addEventListener(name, handler) { this[name] = handler; }, querySelectorAll: () => [], focus() {}, scrollIntoView() {} });
    }
    return elements.get(id);
  };
  const calls = [];
  const state = { token: 'sample-session', activeRole: 'university_president', user: { name: 'Sample President', roles: ['university_president'] } };
  const esc = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  const api = async (path) => {
    calls.push(path);
    if (respond) { const result = respond(path); if (result !== undefined) return result; }
    if (path.startsWith('/api/president/statistics')) return presidentReport();
    if (path === '/api/president/offices') return { data: presidentOffices };
    if (path.startsWith('/api/president/documents/')) return { data: presidentDocuments[0] };
    return { data: presidentDocuments.slice(0, 20), pagination: { page: 1, pages: 2, total: 25 } };
  };
  const view = createPresidentView({ state, api, byId, escapeHtml: esc, formatDate: (value) => value, downloadDocument() {}, signOut() {}, switchRole() {} });
  return { byId, state, calls, view };
}
globalThis.window = { history: { replaceState() {} } };

test('the overview shows every type with its distinct Act count and escapes monitored values', async () => {
  const app = fixture((path) => {
    if (path.startsWith('/api/president/statistics')) {
      const data = presidentReport(); data.oldest_pending[0].subject = '<script>alert(1)</script>'; data.office_workload[0].name = '<Private office>'; data.acted_type_breakdown.push({ name: '<Private type>', documents: 0 }); return data;
    }
  });
  await app.view.enter();
  const html = app.byId('president-overview-content').innerHTML;
  assert.match(html, /Memorandum<\/small><strong>382<\/strong>/);
  assert.match(html, /Unacted Type<\/small><strong>0<\/strong>/);
  assert.match(html, /Acted documents · selected period/);
  assert.match(html, /&lt;Private type&gt;<\/small><strong>0<\/strong>/);
  assert.doesNotMatch(html, /Documents tracked|Awaiting action|Awaiting receipt|482/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(app.byId('president-office-list').innerHTML, /&lt;Private office&gt;/);
  assert.match(app.byId('president-office').innerHTML, /Former Extension Office.*\(inactive\)/);
});

test('report errors hide stale figures and permit correction and retry', async () => {
  let failed = false;
  const app = fixture((path) => { if (failed && path.startsWith('/api/president/statistics')) throw new Error('Start date must be on or before end date.'); });
  await app.view.enter(); failed = true;
  await app.view.loadReport();
  assert.equal(app.byId('president-overview-content').classList.contains('d-none'), true);
  assert.equal(app.byId('president-office-list').classList.contains('d-none'), true);
  assert.equal(app.byId('president-updated').textContent, '');
  assert.match(app.byId('president-report-error').textContent, /Start date/);
  assert.equal(app.byId('president-apply').disabled, false);
  failed = false; await app.view.loadReport();
  assert.equal(app.byId('president-report-error').textContent, '');
  assert.equal(app.byId('president-overview-content').classList.contains('d-none'), false);
});

test('a report in flight cannot restore global figures after role reset', async () => {
  let complete;
  const app = fixture((path) => path.startsWith('/api/president/statistics') ? new Promise((resolve) => { complete = resolve; }) : undefined);
  const pending = app.view.enter();
  app.view.reset(); app.state.activeRole = 'sksu_officials';
  complete(presidentReport()); await pending;
  assert.equal(app.byId('president-overview-content').innerHTML, '');
  assert.equal(app.byId('president-office-list').innerHTML, '');
  assert.equal(app.byId('president-view').classList.contains('d-none'), true);
});

test('document filters are encoded together and empty results retain usable pagination', async () => {
  const app = fixture((path) => path.startsWith('/api/president/documents?') ? { data: [], pagination: { page: 1, pages: 1, total: 0 } } : undefined);
  await app.view.enter('#president/documents');
  app.byId('president-document-search').value = 'research & extension';
  app.byId('president-status').value = 'received'; app.byId('president-office').value = '5';
  await app.view.loadDocuments();
  const query = new URL(app.calls.at(-1), 'http://localhost');
  assert.equal(query.searchParams.get('search'), 'research & extension');
  assert.equal(query.searchParams.get('office_id'), '5');
  assert.equal(query.searchParams.get('status'), 'received');
  assert.match(app.byId('president-document-list').innerHTML, /No documents match/);
  assert.equal(app.byId('president-prev').disabled, true);
  assert.equal(app.byId('president-next').disabled, true);
});

test('leaving a document detail cancels its stale response', async () => {
  let complete;
  const app = fixture((path) => path.startsWith('/api/president/documents/') ? new Promise((resolve) => { complete = resolve; }) : undefined);
  await app.view.enter();
  const pending = app.view.openDocument('PAD-2026-000124');
  app.view.navigate('overview');
  complete({ data: presidentDocuments[0] }); await pending;
  assert.doesNotMatch(app.byId('president-detail').innerHTML, /Document journey/);
  assert.equal(app.byId('president-documents').classList.contains('d-none'), true);
});

test('the latest document request wins when searches finish out of order', async () => {
  const completions = [];
  const app = fixture((path) => path.startsWith('/api/president/documents?') ? new Promise((resolve) => completions.push(resolve)) : undefined);
  await app.view.enter();
  const first = app.view.loadDocuments();
  app.byId('president-document-search').value = 'new search';
  const second = app.view.loadDocuments();
  completions[1]({ data: [{ ...presidentDocuments[0], subject: 'Latest result' }], pagination: { page: 1, pages: 1, total: 1 } }); await second;
  completions[0]({ data: [{ ...presidentDocuments[0], subject: 'Stale result' }], pagination: { page: 1, pages: 1, total: 1 } }); await first;
  assert.match(app.byId('president-document-list').innerHTML, /Latest result/);
  assert.doesNotMatch(app.byId('president-document-list').innerHTML, /Stale result/);
});
