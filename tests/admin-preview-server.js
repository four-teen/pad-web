// Isolated browser QA: sample records live only in memory; no PAD API calls.
// Run: node tests/admin-preview-server.js, then open http://localhost:5184/#admin.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';

const offices = [
  { id: 1, code: 'PAD-RECORDS', name: 'Presidential Action Desk - Records', campus: 'ACCESS', domain: 'Administration', contact_email: 'RECORDS@Example.Test', is_active: 1 },
  { id: 2, code: 'CCS', name: 'College of Computer Studies', campus: 'Isulan', domain: 'Academic Affairs', contact_email: 'CCS@Example.Test', is_active: 1 },
  { id: 3, code: 'ACCESS-PAD', name: 'OFFICE OF THE PRESIDENT - PAD', campus: 'ACCESS', domain: 'Administration', contact_email: 'PAD@Example.Test', is_active: 1 },
  { id: 4, code: 'ARCHIVE', name: 'Previous Office', campus: 'Isulan', domain: '', contact_email: '', is_active: 0 },
];
const accounts = [
  { id: 1, user_id: 101, name: 'Maya Reyes', email: 'MAYA.REYES@Example.Test', role: 'admin', roles: ['admin', 'ovp_pad', 'ovp_central_records', 'sksu_officials'], office_id: 2,
    ovp_pad_office_id: 3, ovp_central_records_office_id: 1, is_active: 1, position: 'Administrator', last_login_at: '2026-10-04 05:00:00', document_count: 2 },
  ...Array.from({ length: 22 }, (_, i) => ({ id: i + 2, user_id: i + 102, name: `Sample Staff ${String(i + 1).padStart(2, '0')}`, email: `STAFF${i + 1}@Example.Test`, role: 'staff', office_id: i < 3 ? 2 : null, is_active: i === 4 ? 0 : 1, position: 'Office staff', last_login_at: null })),
];
const officials = [
  { id: 1, office_id: 1, name: 'Ana Santos', position: 'Records Officer', email: 'ANA.SANTOS@Example.Test', alternate_email: '' },
  { id: 2, office_id: 2, name: 'Miguel Dela Cruz', position: 'Dean', email: 'MIGUEL.DELACRUZ@Example.Test', alternate_email: 'DEAN@Example.Test' },
];
const documents = [
  { id: 1, subject: 'Request for laboratory equipment', status: 'in_transit', current_office_id: 2, pending_office_id: 1, source_office_id: 2, last_from_office_id: 2 },
  { id: 2, subject: 'Approval of campus maintenance schedule', status: 'received', current_office_id: 1, source_office_id: 3, last_from_office_id: 3 },
  { id: 3, subject: 'Extension program endorsement', status: 'in_transit', current_office_id: 1, pending_office_id: 3, source_office_id: 1, last_from_office_id: 1 },
  { id: 4, subject: 'Travel authority for field activity', status: 'received', movement_type: 'return', current_office_id: 1, source_office_id: 1, last_from_office_id: 2 },
  { id: 5, subject: 'Signed memorandum for distribution', status: 'acted', current_office_id: 1, source_office_id: 1, last_from_office_id: 2 },
  { id: 6, subject: 'Completed request for certification', status: 'delivered', current_office_id: 1, source_office_id: 2, last_from_office_id: 2, file_name: null, stored_file_name: null },
].map((record) => ({ reference_no: `PAD-2026-${String(record.id).padStart(6, '0')}`, document_type: 'Memorandum', origin_type: 'office', movement_type: 'forward', pending_office_id: null,
  file_name: 'sample-document.pdf', stored_file_name: 'sample-document.pdf', created_at: '2026-10-05 01:00:00', updated_at: '2026-10-05 02:30:00', description: 'Sample routing data for browser verification.', ...record }));
const documentData = (record) => {
  const office = (id) => offices.find((item) => item.id === Number(id));
  const held = record.current_office_id === 1 && !record.pending_office_id && ['created', 'received', 'acted'].includes(record.status);
  return { ...record, ...Object.fromEntries(['source', 'current', 'pending', 'last_from'].flatMap((key) => [[`${key}_office_name`, office(record[`${key}_office_id`])?.name], [`${key}_office_campus`, office(record[`${key}_office_id`])?.campus]])),
    permissions: { receive: record.pending_office_id === 1, route: held, return: held && record.last_from_office_id !== 1, act: held && record.status !== 'acted', complete: held, deliver: held,
      upload_file: record.source_office_id === 1 || record.current_office_id === 1 },
    history: [{ action: 'created', origin_office_name: null, destination_office_name: office(record.source_office_id)?.name, acted_by_name: 'Sample Staff', created_at: record.created_at, notes: 'Document registered.' },
      { action: record.movement_type === 'return' ? 'returned' : 'routed', origin_office_name: office(record.last_from_office_id)?.name, destination_office_name: office(record.pending_office_id || record.current_office_id)?.name, acted_by_name: 'Maya Reyes', created_at: record.updated_at, notes: record.movement_type === 'return' ? 'Please include the supporting approval.' : 'For review and appropriate action.' }] };
};
const inQueue = (record, queue) => ({ incoming: record.pending_office_id === 1, received: record.current_office_id === 1 && !record.pending_office_id && ['created', 'received'].includes(record.status),
  outgoing: Boolean(record.pending_office_id) && record.last_from_office_id === 1, returned: record.movement_type === 'return', acted: record.status === 'acted', delivered: ['completed', 'delivered'].includes(record.status), all: true })[queue];
let sequence = 1000;
const officeData = () => offices.map((office) => ({ ...office, officials: officials.filter((official) => Number(official.office_id) === office.id), user_count: accounts.filter((account) => Number(account.office_id) === office.id).length, document_count: 0, route_count: 0 }));
const accountData = () => accounts.map((account) => {
  const assigned = (id) => offices.find((office) => office.id === Number(id));
  const ovpNames = Object.fromEntries(['ovp_pad', 'ovp_central_records'].flatMap((role) => ['name', 'campus', 'code'].map((field) => [role + '_office_' + field, assigned(account[role + '_office_id'])?.[field]])));
  return { ...account, ...ovpNames, campus: 'Isulan', office_name: assigned(account.office_id)?.name, office_campus: assigned(account.office_id)?.campus };
});
const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:5184');
  if (url.pathname.startsWith('/pad-api/public/api/')) {
    response.setHeader('Content-Type', 'application/json');
    const reply = (body, status = 200) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    const selectedRole = request.headers['x-pad-role'];
    let path = url.pathname.replace('/pad-api/public', '');
    if (selectedRole && !accountData()[0].roles.includes(selectedRole)) return reply({ message: 'Your selected account role is no longer assigned. Choose another account role.' }, 403);
    if (path === '/api/me') {
      const account = accountData()[0];
      const roleOffices = Object.fromEntries(['ovp_pad', 'ovp_central_records', 'sksu_officials'].map((role) => [role,
        offices.find((office) => office.id === Number(account[role === 'sksu_officials' ? 'office_id' : role + '_office_id']))]));
      const activeOffice = roleOffices[selectedRole];
      return reply({ user: { ...account, id: 101, active_role: selectedRole || null, role_offices: roleOffices,
        ...(activeOffice ? { office_id: activeOffice.id, office_name: activeOffice.name, office_campus: activeOffice.campus } : {}) } });
    }
    if (path.startsWith('/api/admin/') && selectedRole !== 'admin') return reply({ message: 'Administrator access is required.' }, 403);
    if (path.startsWith('/api/doc_router/')) {
      if (!['ovp_pad', 'ovp_central_records', 'sksu_officials'].includes(selectedRole)) return reply({ message: 'Select an office role.' }, 403);
      path = '/api/' + path.slice('/api/doc_router/'.length);
    }
    if (path === '/api/offices') return reply({ data: officeData().filter((office) => office.is_active) });
    if (path === '/api/routing/workspace' || path === '/api/documents') {
      const queue = url.searchParams.get('queue') || 'all';
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const status = url.searchParams.get('status');
      const data = documents.filter((record) => inQueue(record, queue) && (!status || record.status === status) && `${record.subject} ${record.reference_no}`.toLowerCase().includes(search)).map(documentData);
      return reply({ data, counts: Object.fromEntries(['incoming', 'received', 'outgoing', 'returned', 'acted', 'delivered', 'all'].map((key) => [key, documents.filter((record) => inQueue(record, key)).length])), office: offices[0], can_monitor: true, can_register: true, can_register_external: true, pagination: { page: 1, pages: 1, total: data.length, per_page: 20 } });
    }
    const documentMatch = path.match(/^\/api\/documents\/([A-Za-z0-9-]+)(?:\/(receive|route|return|act|complete|deliver))?$/);
    if (documentMatch) {
      const record = documents.find((item) => item.reference_no === documentMatch[1]);
      if (!record) return reply({ message: 'Sample document not found.' }, 404);
      if (request.method === 'GET') return reply({ data: documentData(record) });
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      const action = documentMatch[2];
      if (!documentData(record).permissions[action]) return reply({ message: 'This sample action is unavailable.' }, 409);
      if (action === 'receive') { record.current_office_id = 1; record.pending_office_id = null; record.status = 'received'; }
      else if (['route', 'return'].includes(action)) { record.pending_office_id = action === 'return' ? record.last_from_office_id : Number(payload.to_office_id); record.last_from_office_id = 1; record.status = 'in_transit'; record.movement_type = action === 'return' ? 'return' : 'forward'; }
      else record.status = { act: 'acted', complete: 'completed', deliver: 'delivered' }[action];
      return reply({ reference_no: record.reference_no, message: 'Sample action saved.' });
    }
    if (path === '/api/admin/overview') return reply({ data: { users: accounts.length, active_users: accounts.filter((account) => Number(account.is_active) === 1).length, offices: offices.filter((office) => Number(office.is_active) === 1).length, documents: 2 } });
    const match = path.match(/^\/api\/admin\/(accounts|offices|officials)(?:\/(\d+))?$/);
    if (!match) return reply({ message: 'Unknown fixture endpoint.' }, 404);
    const collection = { accounts, offices, officials }[match[1]];
    const id = Number(match[2]);
    if (request.method === 'GET') return reply({ data: match[1] === 'offices' ? officeData() : match[1] === 'accounts' ? accountData() : officials });
    if (request.method === 'DELETE') {
      const index = collection.findIndex((record) => record.id === id);
      if (index < 0) return reply({ message: 'Record not found.' }, 404);
      collection.splice(index, 1);
      if (match[1] === 'offices') {
        for (let i = officials.length - 1; i >= 0; i--) if (Number(officials[i].office_id) === id) officials.splice(i, 1);
      }
      return reply({ message: 'Fixture record deleted.' });
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body || '{}');
    const record = id ? collection.find((record) => record.id === id) : { id: ++sequence, user_id: sequence + 1000 };
    if (!record) return reply({ message: 'Record not found.' }, 404);
    Object.assign(record, payload);
    if ('is_active' in payload) record.is_active = Number(payload.is_active);
    for (const field of ['office_id', 'ovp_pad_office_id', 'ovp_central_records_office_id']) if (payload[field]) record[field] = Number(payload[field]);
    if (!id) collection.push(record);
    if (match[1] === 'offices' && payload.officials) {
      for (let i = officials.length - 1; i >= 0; i--) if (Number(officials[i].office_id) === record.id) officials.splice(i, 1);
      officials.push(...payload.officials.map((official) => ({ ...official, id: Number(official.id) || ++sequence, office_id: record.id })));
    }
    return reply({ id: record.id, message: 'Fixture saved.' }, id ? 200 : 201);
  }
  if (url.pathname === '/') {
    let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    html = html.replace('<head>', '<head><script>const fixtureStorage = new Map([["pad_access_token", "fixture-session"], ["pad_active_role", "admin"]]); Object.defineProperty(window, "localStorage", { value: { getItem: (key) => fixtureStorage.get(key) || null, setItem: (key, value) => fixtureStorage.set(key, value), removeItem: (key) => fixtureStorage.delete(key) } });</script>');
    html = html.replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;z-index:2000;background:#fff3cd;padding:4px 12px;font-size:12px">Browser QA · sample records · no live PAD data</div>');
    response.setHeader('Content-Type', 'text/html');
    response.end(await vite.transformIndexHtml(url.pathname, html));
    return;
  }
  vite.middlewares(request, response, () => { response.statusCode = 404; response.end(); });
});
server.listen(5184, '127.0.0.1', () => console.log('PAD sample administration preview: http://localhost:5184/#admin'));
