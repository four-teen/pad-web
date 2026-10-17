// Browser QA with sample records in memory. Never connects to the real PAD API/database.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';

const offices = [
  { id: 2, code: 'CENTRAL', name: 'Presidential Action Desk - Records', campus: 'ACCESS', is_active: 1 },
  { id: 80, code: 'ACCESS-PAD', name: 'OFFICE OF THE PRESIDENT - PAD', campus: 'ACCESS', is_active: 1 },
  { id: 9, code: 'CCS', name: 'College of Computer Studies', campus: 'ISULAN', is_active: 1 },
];
const user = { id: 1, name: 'Sample PAD Staff', email: 'sample@example.test', role: 'admin',
  roles: ['admin', 'ovp_pad', 'ovp_central_records', 'sksu_officials'], office_id: 9,
  ovp_pad_office_id: 80, ovp_central_records_office_id: 2, is_active: 1 };
const roleOffices = { ovp_pad: offices[1], ovp_central_records: offices[0], sksu_officials: offices[2] };
const documents = [
  { id: 1, subject: 'Request for approval of campus equipment procurement', status: 'received', current_office_id: 80, last_from_office_id: 2, last_sender_role: 'ovp_central_records', awaiting_pad_decision: true },
  { id: 2, subject: 'Faculty attendance at the research ethics workshop', document_type: 'TRAVEL ORDER', status: 'received', current_office_id: 80, last_from_office_id: 2, last_sender_role: 'ovp_central_records', awaiting_pad_decision: true },
  { id: 3, subject: 'Endorsement of university extension program', status: 'in_transit', current_office_id: 2, pending_office_id: 80, last_from_office_id: 2, last_sender_role: 'ovp_central_records', awaiting_pad_decision: true },
  { id: 7, subject: 'Office memorandum ready to send', status: 'created', current_office_id: 9, is_my_document: true, last_receipt_action: 'created' },
  { id: 8, subject: 'Incoming handoff for the College of Computer Studies', status: 'in_transit', current_office_id: 2, pending_office_id: 9, last_from_office_id: 2, last_sender_role: 'ovp_central_records' },
  { id: 9, subject: 'Approved campus request ready for final Records action', status: 'received', current_office_id: 2, last_from_office_id: 80, last_sender_role: 'ovp_pad', pad_decision: 'approved',
    last_route_notes: 'Approved and signed by PAD. Central Records may finalize and file the attached copy.', file_name: 'signed-campus-request.pdf', stored_file_name: 'sample-signed.pdf' },
  ...['approved', 'disapproved', 'returned_for_correction'].map((decision, index) => ({ id: 4 + index,
    subject: ['Campus maintenance schedule', 'Request for additional funding', 'Travel authority with missing supporting papers'][index],
    status: index === 1 ? 'received' : 'in_transit', current_office_id: index === 1 ? 2 : 80, pending_office_id: index === 1 ? null : 2,
    last_from_office_id: 80, last_sender_role: 'ovp_pad', pad_decision: decision, movement_type: 'return',
    pad_reviews: [{ decision, decision_notes: decision === 'approved' ? '' : 'Please review the supporting requirements.', decided_by_name: 'Sample PAD Staff', decided_at: '2026-10-07 01:30:00' }] })),
].map((data) => ({ reference_no: `PAD-2026-${String(data.id).padStart(6, '0')}`, document_type: 'Memorandum', origin_type: 'office',
  source_office_id: 9, source_office_name: offices[2].name, pending_office_id: null, movement_type: 'forward',
  last_received_at: '2026-10-07 01:00:00', last_dispatched_at: '2026-10-07 01:30:00', last_receipt_action: 'received', last_received_by_name: 'Sample Receiver',
  created_at: '2026-10-06 01:00:00', updated_at: '2026-10-07 01:30:00', pad_return_office_name: offices[0].name,
  file_name: null, stored_file_name: null, ...data }));
const inQueue = (d, queue, office) => ({
  attention: d.current_office_id === office && !d.pending_office_id && !d.is_my_document && (['created', 'received'].includes(d.status) || (d.status === 'delivered' && d.pad_decision === 'returned_for_correction')),
  incoming: d.pending_office_id === office,
  my_documents: d.current_office_id === office && d.is_my_document && !d.pending_office_id,
  received: d.current_office_id === office && !d.is_my_document && !d.pending_office_id && ['created', 'received'].includes(d.status),
  for_approval: d.current_office_id === office && !d.pending_office_id && d.awaiting_pad_decision,
  pad_results: ['in_transit', 'received'].includes(d.status) && Boolean(d.pad_decision) && (d.pending_office_id === office || (!d.pending_office_id && d.current_office_id === office)),
  outgoing: d.last_from_office_id === office && Boolean(d.pending_office_id),
  returned: d.movement_type === 'return' && (d.pending_office_id === office || (!d.pending_office_id && d.current_office_id === office)),
  acted: (d.status === 'acted' && d.current_office_id === office) || d.release_records_office_id === office,
  delivered: ['completed', 'delivered'].includes(d.status), all: true,
})[queue];
const data = (d, role) => {
  const office = roleOffices[role]?.id || 9;
  const held = d.current_office_id === office && !d.pending_office_id && ['created', 'received'].includes(d.status);
  const padReturn = role === 'ovp_central_records' && d.last_sender_role === 'ovp_pad' && (held || d.pending_office_id === office);
  return { ...d, current_office_name: offices.find((o) => o.id === d.current_office_id)?.name,
    pending_office_name: offices.find((o) => o.id === d.pending_office_id)?.name,
    last_from_office_name: offices.find((o) => o.id === d.last_from_office_id)?.name,
    is_pad_return: padReturn,
    act_blockers: padReturn
      ? [...(!d.stored_file_name ? ['Open View and attach the document before marking it Acted.'] : []), ...(!d.last_route_notes ? ['The latest PAD route requires notes.'] : [])] : [],
    permissions: { receive: d.pending_office_id === office, decide: role === 'ovp_pad' && held && d.awaiting_pad_decision,
      route: held && !d.awaiting_pad_decision && !padReturn, delete: held && d.is_my_document,
      return: !padReturn && ((held && !d.awaiting_pad_decision) || d.pending_office_id === office) && Boolean(d.last_from_office_id) && d.last_from_office_id !== office,
      act: padReturn, upload_file: !d.is_owner_release && (held || padReturn) },
    history: [{ action: 'created', destination_office_name: offices[2].name, acted_by_name: 'Sample Encoder', created_at: d.created_at },
      { action: 'received', origin_office_name: offices[0].name, destination_office_name: offices[1].name, acted_by_name: 'Sample Receiver', created_at: d.last_received_at },
      ...(d.pad_reviews || []).map((review) => ({ action: 'pad_decided', origin_office_name: offices[1].name, destination_office_name: offices[1].name,
        acted_by_name: review.decided_by_name, created_at: review.decided_at, notes: review.decision + ': ' + review.decision_notes })), ...(d.release_history || [])] };
};
const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:5185');
  if (url.pathname.startsWith('/pad-api/public/api/')) {
    response.setHeader('Content-Type', 'application/json');
    const reply = (value, status = 200) => { response.statusCode = status; response.end(JSON.stringify(value)); };
    const role = request.headers['x-pad-role'];
    const office = roleOffices[role]?.id || 9;
    let path = url.pathname.replace('/pad-api/public', '').replace('/api/doc_router/', '/api/');
    if (path === '/api/me') return reply({ user: { ...user, active_role: role, role_offices: roleOffices,
      ...(roleOffices[role] ? { office_id: office, office_name: roleOffices[role].name, office_campus: roleOffices[role].campus } : {}) } });
    if (path === '/api/offices') return reply({ data: offices });
    if (path === '/api/routing/statistics') {
      const global = role !== 'sksu_officials';
      const scoped = global ? documents : documents.filter(d => d.source_office_id === office || d.current_office_id === office || d.pending_office_id === office);
      const pending = scoped.filter(d => d.pending_office_id && (global || d.pending_office_id === office));
      const held = scoped.filter(d => !d.pending_office_id && ['created', 'received'].includes(d.status) && (global || d.current_office_id === office));
      const localPending = [...pending, ...held].filter(d => (d.pending_office_id || d.current_office_id) === office);
      const period = { registered: scoped.length, received: scoped.filter(d => !d.is_my_document && !d.pending_office_id).length,
        acted: scoped.filter(d => d.release_records_office_id && (global || d.release_records_office_id === office)).length,
        delivered: scoped.filter(d => d.status === 'delivered').length, completed: 0, sent: scoped.filter(d => !d.is_my_document).length,
        returned: scoped.filter(d => d.movement_type === 'return').length, handoffs: scoped.length * 2 };
      return reply({ scope: global ? 'global' : 'office', office: roleOffices[role], server_time: '2026-10-10T00:00:00Z',
        filters: { start_date: url.searchParams.get('start_date') || '2026-01-01', end_date: url.searchParams.get('end_date') || '2026-10-10', document_type: url.searchParams.get('document_type') || '' },
        document_types: ['Memorandum', 'TRAVEL ORDER'],
        snapshot: { total_documents: scoped.length, awaiting_receipt: pending.length, pending_action: held.length, returned_pending: pending.filter(d => d.movement_type === 'return').length, correction_pending: 0, oldest_days: 3 },
        milestones: { acted: period.acted, delivered: period.delivered }, period,
        current_statuses: Object.fromEntries(['created', 'in_transit', 'received', 'acted', 'completed', 'delivered'].map(s => [s, scoped.filter(d => d.status === s).length])),
        monthly: Array.from({ length: 10 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, registered: i === 9 ? period.registered : 0,
          received: i === 9 ? period.received : 0, acted: i === 9 ? period.acted : 0, delivered: i === 9 ? period.delivered : 0, handoffs: i === 9 ? period.handoffs : 0 })),
        type_breakdown: ['Memorandum', 'TRAVEL ORDER'].map(name => ({ name, documents: scoped.filter(d => d.document_type === name).length, share: Math.round(scoped.filter(d => d.document_type === name).length * 100 / scoped.length) })),
        pending_age: { '0–3 days': pending.length + held.length, '4–7 days': 0, '8–15 days': 0, '16+ days': 0 },
        office_workload: offices.filter(o => global || o.id === office).map(o => ({ ...o, awaiting_receipt: scoped.filter(d => d.pending_office_id === o.id).length,
          pending_action: scoped.filter(d => !d.pending_office_id && d.current_office_id === o.id && ['created', 'received'].includes(d.status)).length, oldest_days: 3, period_received: 2, period_acted: 0, period_sent: 3, period_handoffs: 5 })),
        oldest_pending: localPending.map(d => ({ reference_no: d.reference_no, subject: d.subject, queue: d.pending_office_id ? 'Awaiting receipt' : 'Pending action', since: d.pending_office_id ? d.last_dispatched_at : d.last_received_at, days: 3 })),
        processing_time: { registration_to_act: { seconds: null, samples: 0 }, office_handling: { seconds: 43200, samples: 4 }, act_to_delivery: { seconds: null, samples: 0 } } });
    }
    if (path === '/api/routing/workspace') {
      const queue = url.searchParams.get('queue') || 'all';
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const records = documents.filter((d) => inQueue(d, queue, office) && (!search || `${d.reference_no} ${d.subject} ${d.document_type}`.toLowerCase().includes(search)));
      if (queue === 'attention') records.sort((a, b) => String(a.last_received_at || a.created_at).localeCompare(String(b.last_received_at || b.created_at)) || a.id - b.id);
      return reply({ data: records.map((d) => data(d, role)), office: roleOffices[role], can_monitor: role === 'ovp_central_records',
        can_register: true, can_register_external: role === 'ovp_central_records', pagination: { page: 1, pages: 1, total: records.length },
        counts: Object.fromEntries(['my_documents', 'incoming', 'received', 'for_approval', 'pad_results', 'outgoing', 'returned', 'acted', 'delivered', 'all'].map((key) => [key, documents.filter((d) => inQueue(d, key, office)).length])) });
    }
    const match = path.match(/^\/api\/documents\/([A-Za-z0-9-]+)(?:\/(decide|receive|act))?$/);
    if (match) {
      const d = documents.find((record) => record.reference_no === match[1]);
      if (!d) return reply({ message: 'Sample not found.' }, 404);
      if (request.method === 'GET') return reply({ data: data(d, role) });
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      const record = data(d, role);
      if (!record.permissions[match[2]]) return reply({ message: 'Action no longer available.' }, 409);
      if (match[2] === 'act' && record.act_blockers.length) return reply({ message: record.act_blockers.join(' ') }, 422);
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      if (match[2] === 'act') {
        const owner = offices.find(o => o.id === payload.owner_office_id && o.id !== office);
        if (!payload.hard_copy_received || !owner || !payload.notes?.trim()) return reply({message:'Confirm receipt, select the owner, and record the action.'},422);
        d.current_office_id = office; d.pending_office_id = owner.id; d.recipient_office_id = owner.id; d.status = 'in_transit';
        d.is_owner_release = true; d.release_records_office_id = office; d.release_owner_office_id = owner.id;
        d.last_from_office_id = office; d.last_sender_role = role; d.last_dispatched_at = now; d.movement_type = 'forward';
        d.release_history = [{action:'acted',from_office_id:office,to_office_id:owner.id,origin_office_name:roleOffices[role].name,
          destination_office_name:owner.name,dispatched_at:now,created_at:now,acted_by_name:user.name,notes:payload.notes}];
      }
      if (match[2] === 'receive') {
        d.current_office_id = office; d.pending_office_id = null; d.status = d.is_owner_release ? 'delivered' : 'received';
        if (d.is_owner_release) {
          d.release_history[0].received_at = now;
          d.release_history.push({action:'received',from_office_id:d.last_from_office_id,to_office_id:office,origin_office_name:roleOffices.ovp_central_records.name,
            destination_office_name:roleOffices[role].name,received_at:now,created_at:now,acted_by_name:user.name,notes:payload.notes},
          {action:'delivered',from_office_id:office,to_office_id:office,origin_office_name:roleOffices[role].name,destination_office_name:roleOffices[role].name,created_at:now,acted_by_name:user.name});
        }
      }
      if (match[2] === 'decide') {
        d.pad_decision = payload.decision; d.awaiting_pad_decision = false; d.pending_office_id = 2; d.status = 'in_transit';
        d.movement_type = 'return'; d.last_from_office_id = 80; d.last_sender_role = 'ovp_pad';
        d.pad_reviews = [{ decision: payload.decision, decision_notes: payload.notes, decided_by_name: user.name, decided_at: '2026-10-07 02:00:00' }];
      }
      return reply({ reference_no: d.reference_no, delivery_confirmed: match[2] === 'receive' && d.is_owner_release, message: 'Sample action saved.' });
    }
    return reply({ data: [] });
  }
  if (url.pathname === '/') {
    const role = ['ovp_pad', 'ovp_central_records', 'sksu_officials'].includes(url.searchParams.get('qa_role')) ? url.searchParams.get('qa_role') : 'ovp_pad';
    let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    html = html.replace('<head>', `<head><script>const fixtureStorage = new Map([["pad_access_token", "sample-session"], ["pad_active_role", ${JSON.stringify(role)}]]); Object.defineProperty(window, "localStorage", { value: { getItem: (key) => fixtureStorage.get(key) || null, setItem: (key, value) => fixtureStorage.set(key, value), removeItem: (key) => fixtureStorage.delete(key) } });</script>`);
    html = html.replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;z-index:2000;background:#fff3cd;padding:4px 12px;font-size:12px">Browser QA · sample records · no live PAD data</div>');
    response.setHeader('Content-Type', 'text/html');
    response.end(await vite.transformIndexHtml(url.pathname, html)); return;
  }
  vite.middlewares(request, response, () => { response.statusCode = 404; response.end(); });
}).listen(5185, '127.0.0.1', () => console.log('PAD review sample preview: http://localhost:5185/#doc_router/for_approval'));
