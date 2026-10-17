// Local browser QA with invented data. No requests reach the live PAD API.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import { presidentReport, presidentOffices, presidentDocuments } from './president-fixtures.js';

const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:5186');
  if (url.pathname.startsWith('/pad-api/public/api/')) {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const reply = (body, code = 200) => { response.statusCode = code; response.end(JSON.stringify(body)); };
    if (request.method !== 'GET') return reply({ message: 'Presidential monitoring is read-only.' }, 403);
    if (url.pathname.endsWith('/api/me')) return reply({ user: { id: 101, name: 'University President', email: 'president@example.test', role: 'router', roles: ['university_president'], office_id: 1, office_name: presidentOffices[0].name, position: 'University President', role_offices: { university_president: presidentOffices[0] } } });
    if (url.pathname.endsWith('/api/president/statistics')) {
      const data = presidentReport();
      for (const key of ['start_date', 'end_date', 'document_type']) if (url.searchParams.has(key)) data.filters[key] = url.searchParams.get(key);
      if (data.filters.start_date > data.filters.end_date) return reply({ message: 'Start date must be on or before end date.' }, 422);
      return reply(data);
    }
    if (url.pathname.endsWith('/api/president/offices')) return reply({ data: presidentOffices });
    if (url.pathname.endsWith('/api/president/documents')) {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const office = url.searchParams.get('office_id');
      const status = url.searchParams.get('status');
      const rows = presidentDocuments.filter((d) => (!office || office === 'all' || Number(office) === d.current_office_id || Number(office) === d.pending_office_id) && (!status || d.status === status) && `${d.subject} ${d.reference_no} ${d.document_type}`.toLowerCase().includes(search));
      const pages = Math.max(1, Math.ceil(rows.length / 20));
      const page = Math.min(pages, Math.max(1, Number(url.searchParams.get('page')) || 1));
      return reply({ data: rows.slice((page - 1) * 20, page * 20), pagination: { page, pages, total: rows.length, per_page: 20 } });
    }
    const match = url.pathname.match(/\/api\/president\/documents\/([A-Za-z0-9-]+)$/);
    if (match) { const data = presidentDocuments.find((d) => d.reference_no === match[1]); return data ? reply({ data }) : reply({ message: 'Document not found.' }, 404); }
    return reply({ message: 'Unexpected sample endpoint.' }, 404);
  }
  if (url.pathname === '/') {
    let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    html = html.replace('<head>', '<head><script>const qaStorage = new Map([["pad_access_token","sample-session"],["pad_active_role","university_president"]]); Object.defineProperty(window,"localStorage",{value:{getItem:(k)=>qaStorage.get(k)||null,setItem:(k,v)=>qaStorage.set(k,v),removeItem:(k)=>qaStorage.delete(k)}});</script>');
    response.setHeader('Content-Type', 'text/html');
    response.end(await vite.transformIndexHtml('/', html));
    return;
  }
  vite.middlewares(request, response, () => { response.statusCode = 404; response.end(); });
});
server.listen(5186, 'localhost', () => console.log('Presidential browser QA: http://localhost:5186/#president — invented records only'));
