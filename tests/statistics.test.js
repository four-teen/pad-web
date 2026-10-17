import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatistics } from '../src/doc_router/statistics.js';

function fixture(scope = 'global') {
  return { scope, office: { id: 9, name: 'My Office' }, server_time: '2026-10-10T00:00:00Z',
    filters: { start_date: '2026-01-01', end_date: '2026-10-10', document_type: '' }, document_types: ['Memorandum', '<Private>'],
    snapshot: { total_documents: 20, awaiting_receipt: 2, pending_action: 5, oldest_days: 40, returned_pending: 1, correction_pending: 0 },
    current_statuses: { created: 3, in_transit: 2, received: 2, acted: 0, delivered: 12, completed: 1 }, milestones: { acted: 12, delivered: 12 },
    period: { registered: 20, received: 15, acted: 12, delivered: 12, completed: 1, sent: 15, returned: 2, handoffs: 45 },
    monthly: [{ month: '2026-01', registered: 20, received: 15, acted: 12, delivered: 12, handoffs: 45 }],
    type_breakdown: [{ name: '<Private>', documents: 20, share: 100 }], pending_age: { '0–3 days': 2, '4–7 days': 3, '8–15 days': 1, '16+ days': 1 },
    office_workload: [{ name: '<Office>', campus: 'ISULAN', awaiting_receipt: 2, pending_action: 5, oldest_days: 40 }],
    oldest_pending: [{ reference_no: 'PAD-2026-000001', subject: '<img src=x onerror=alert(1)>', queue: 'Pending action', since: '2026-09-01 00:00:00', days: 40 }],
    processing_time: { registration_to_act: { seconds: 172800, samples: 12 }, office_handling: { seconds: null, samples: 0 }, act_to_delivery: { seconds: 86400, samples: 10 } } };
}
function page(api) {
  const elements = new Map();
  function byId(id) {
    if (!elements.has(id)) {
      const classes = new Set(['d-none']);
      elements.set(id, { value: '', innerHTML: '', textContent: '', disabled: false,
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
        setAttribute() {}, addEventListener(name, fn) { this[name] = fn; } });
    }
    return elements.get(id);
  }
  const state = { activeRole: 'ovp_pad', user: { office_id: 9 } };
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  const stats = createStatistics({ state, api, byId, escapeHtml, formatDate: (value) => value });
  stats.bind();
  return { state, byId, stats };
}

test('OVP dashboard distinguishes current backlog from unique period counts and escapes record values', async () => {
  const app = page(async () => fixture());
  await app.stats.load();
  assert.equal(app.byId('statistics-title').textContent, 'OVP Statistics');
  assert.match(app.byId('statistics-scope').textContent, /All offices/);
  assert.match(app.byId('statistics-snapshot').innerHTML, /recorded Act · all time/);
  assert.match(app.byId('statistics-types').innerHTML, /&lt;Private&gt;/);
  assert.doesNotMatch(app.byId('statistics-oldest').innerHTML, /<img/);
  assert.match(app.byId('statistics-oldest').innerHTML, /&lt;img/);
  assert.match(app.byId('statistics-processing').innerHTML, /No completed samples/);
  assert.match(app.byId('statistics-processing').innerHTML, /Act dispatch to owner receipt/);
  assert.match(app.byId('statistics-monthly-table').innerHTML, /45/);
  assert.equal(app.byId('statistics-report').classList.contains('d-none'), false);
});

test('office dashboard uses local wording and sends only date and type filters', async () => {
  const calls = [];
  const app = page(async (path) => { calls.push(path); return fixture('office'); });
  app.state.activeRole = 'sksu_officials';
  await app.stats.load();
  assert.equal(app.byId('statistics-title').textContent, 'Office Statistics');
  assert.match(app.byId('statistics-snapshot').innerHTML, /Incoming to your office now/);
  assert.doesNotMatch(app.byId('statistics-processing').innerHTML, /Registration to first Act/);
  app.byId('statistics-start').value = '2025-04-01'; app.byId('statistics-end').value = '2025-04-30'; app.byId('statistics-type').value = '<Private>';
  await app.byId('statistics-form').submit({ preventDefault() {} });
  await new Promise(setImmediate);
  const url = new URL(calls.at(-1), 'http://localhost');
  assert.equal(url.searchParams.get('start_date'), '2025-04-01');
  assert.equal(url.searchParams.get('document_type'), '<Private>');
  assert.equal(url.searchParams.has('office_id'), false);
});

test('an old global response cannot render after switching to an office role', async () => {
  let resolve;
  const app = page(() => new Promise((done) => { resolve = done; }));
  const old = app.stats.load();
  app.state.activeRole = 'sksu_officials'; app.stats.reset();
  resolve(fixture()); await old;
  assert.equal(app.byId('statistics-report').classList.contains('d-none'), true);
  assert.equal(app.byId('statistics-updated').textContent, '');
});

test('a failed refresh hides old figures and shows the server validation error', async () => {
  let fail = false;
  const app = page(async () => { if (fail) throw new Error('Start date must be on or before end date.'); return fixture(); });
  await app.stats.load(); fail = true; await app.stats.load();
  assert.equal(app.byId('statistics-report').classList.contains('d-none'), true);
  assert.match(app.byId('statistics-error').textContent, /Start date/);
  assert.equal(app.byId('statistics-apply').disabled, false);
});
