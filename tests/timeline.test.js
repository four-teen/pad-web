import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/doc_router/index.js', import.meta.url), 'utf8').replace('export function createDocRouter', 'function createDocRouter');
const context = vm.createContext({ Date });
vm.runInContext(source, context);
const timeline = (data) => context.custodyTimeline(data);
const duration = (start, end) => context.officeDuration(start, end);
const event = (id, action, from, to, time, extra = {}) => ({ id, action, from_office_id: from, to_office_id: to,
  origin_office_name: from ? `Office ${from}` : null, destination_office_name: `Office ${to}`, created_at: time, ...extra });

test('UTC and explicit Manila offsets identify the same instant and retain seconds', () => {
  assert.equal(context.routingTime('2026-10-07 17:02:03'), context.routingTime('2026-10-08T01:02:03+08:00'));
  assert.equal(duration('2026-10-07 00:00:00', '2026-10-08 02:03:04'), '1 day 2 hrs 3 mins 4 secs');
  assert.equal(duration('2026-10-07 00:00:00', '2026-10-07 00:00:00'), '0 secs');
  assert.equal(duration('2026-10-07 01:00:00', '2026-10-07 00:00:00'), 'Duration unavailable');
  assert.equal(duration(null, '2026-10-07 00:00:00'), 'Duration unavailable');
});

test('Act dispatch ends Records custody while owner receipt records delivery separately', () => {
  const history = [event(1, 'received', 80, 2, '2026-10-07 01:00:00'),
    event(2, 'acted', 2, 9, '2026-10-07 01:10:00', { dispatched_at: '2026-10-07 01:10:00', received_at: '2026-10-07 02:00:00' }),
    event(3, 'received', 2, 9, '2026-10-07 02:00:00'), event(4, 'delivered', 9, 9, '2026-10-07 02:00:00')];
  const result = timeline({ history, status: 'delivered', pending_office_id: null });
  const dispatch = result.events.find(item => item.action === 'acted');
  assert.equal(duration(dispatch.officeStay.startedAt, dispatch.officeStay.endedAt), '10 mins');
  assert.equal(duration(dispatch.transit.startedAt, dispatch.transit.endedAt), '50 mins');
  assert.equal(result.currentStay, null);
  const correction = timeline({ history, status: 'delivered', is_owner_release: true, pad_decision: 'returned_for_correction' });
  assert.equal(correction.currentStay.officeId, 9, 'Delivery of correction instructions retains owner custody for resubmission.');
});

test('latest events come first with descending IDs when timestamps tie', () => {
  const history = [event(3, 'received', 1, 2, '2026-10-07 02:00:00'), event(1, 'created', null, 1, '2026-10-07 01:00:00'),
    event(2, 'routed', 1, 2, '2026-10-07 02:00:00')];
  assert.deepEqual(Array.from(timeline({ history }).events, (item) => item.id), [3, 2, 1]);
  assert.equal(history[0].officeStay, undefined, 'Source events are not mutated');
});

test('office visits exclude transit and restart on a return receipt', () => {
  const history = [event(1, 'created', null, 1, '2026-10-07 00:00:00'),
    event(2, 'routed', 1, 2, '2026-10-07 00:05:00', { dispatched_at: '2026-10-07 00:05:00', received_at: '2026-10-07 01:00:00' }),
    event(3, 'received', 1, 2, '2026-10-07 01:00:00'), event(4, 'acted', 2, 2, '2026-10-07 01:02:00'),
    event(5, 'returned', 2, 1, '2026-10-07 03:00:00'), event(6, 'file_uploaded', 2, 2, '2026-10-07 03:01:00'),
    event(7, 'received', 2, 1, '2026-10-07 04:00:00')];
  const result = timeline({ status: 'received', current_office_id: 1, history });
  const events = new Map(result.events.map((item) => [item.id, item]));
  assert.equal(duration(events.get(1).officeStay.startedAt, events.get(1).officeStay.endedAt), '5 mins');
  assert.equal(duration(events.get(3).officeStay.startedAt, events.get(3).officeStay.endedAt), '2 hrs');
  assert.equal(duration(events.get(2).transit.startedAt, events.get(2).transit.endedAt), '55 mins');
  assert.equal(duration(events.get(4).officeStay.startedAt, events.get(4).officeStay.observedAt), '2 mins');
  assert.equal(events.get(6).officeStay, undefined, 'Uploads during transit cannot restart office stay');
  assert.equal(result.currentStay.startedAt, '2026-10-07 04:00:00');
});

test('external registration begins in Records and final actions stop processing duration', () => {
  for (const finalAction of ['acted', 'completed', 'delivered']) {
    const result = timeline({ status: finalAction, history: [event(1, 'externally_received', null, 2, '2026-10-07 00:00:00'),
      event(2, finalAction, 2, 2, '2026-10-08 00:01:00'), event(3, 'file_uploaded', 2, 2, '2026-10-09 00:00:00')] });
    assert.equal(result.currentStay, null);
    const stay = result.events.find((item) => item.id === 1).officeStay;
    assert.equal(duration(stay.startedAt, stay.endedAt), '1 day 1 min');
  }
});

test('pending handoff has no current office duration', () => {
  const result = timeline({ status: 'in_transit', pending_office_id: 2, history: [
    event(1, 'created', null, 1, '2026-10-07 00:00:00'), event(2, 'routed', 1, 2, '2026-10-07 00:05:00')] });
  assert.equal(result.currentStay, null);
  assert.equal(result.events[0].officeStay.endedAt, '2026-10-07 00:05:00');
});

test('Manila formatting is independent of the operating system timezone', () => {
  const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const formatter = appSource.slice(appSource.indexOf('function formatDate('), appSource.indexOf('function statusBadge('));
  const dateContext = vm.createContext({ Date, Intl });
  vm.runInContext(formatter, dateContext);
  const value = dateContext.formatDate('2026-10-07 17:02:03');
  assert.match(value, /Oct 8, 2026/);
  assert.match(value, /1:02:03 AM/);
  assert.equal(value, dateContext.formatDate('2026-10-08T01:02:03+08:00'));
  assert.equal(dateContext.formatDate('invalid'), '—');
});
