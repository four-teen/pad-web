export function createRecordsManagement({ state, api, byId, escapeHtml, formatDate, changeSection, openDocument }) {
  const modal = new bootstrap.Modal(byId('record-edit-modal'));
  const titles = { documents: 'Document Particulars', personnel: 'Faculty / Personnel', sources: 'Document Sources' };
  let tab = 'documents';
  let rows = [];
  let page = 1;
  let pages = 1;
  let request = 0;
  let editRequest = 0;
  let pending = null;
  let saving = false;
  let timer;
  let catalogs = null;
  const allowed = () => state.activeRole === 'ovp_central_records' && state.user?.roles?.includes('ovp_central_records');
  const option = (id, name, selected) => `<option value="${escapeHtml(id)}"${selected ? ' selected' : ''}>${escapeHtml(name)}</option>`;
  const error = (id, message) => { byId(id).textContent = message; byId(id).classList.remove('d-none'); };

  function reset() {
    request++; editRequest++; clearTimeout(timer);
    modal.hide(); pending = null; rows = []; catalogs = null; page = 1;
    byId('management-search').value = '';
    byId('management-list').innerHTML = '';
    byId('record-edit-body').innerHTML = '';
  }

  function markNavigation() {
    document.querySelectorAll('[data-management-nav]').forEach((item) => {
      item.classList.toggle('active', item.dataset.managementNav === tab && !byId('section-management').classList.contains('d-none'));
    });
  }

  async function open(next = 'documents') {
    if (!allowed()) return;
    tab = titles[next] ? next : 'documents'; page = 1;
    byId('management-search').value = '';
    changeSection('management');
    window.history.replaceState(null, '', `#doc_router/management/${tab}`);
    byId('management-title').textContent = titles[tab];
    byId('management-description').textContent = tab === 'documents'
      ? 'Correct document particulars across all offices. Every correction retains the previous text and your reason.'
      : tab === 'personnel' ? 'Maintain personnel names, email addresses, positions, and campuses. Existing documents retain their recorded names.'
        : 'Maintain the names available during registration. Existing documents retain their recorded names. Deactivate entries that should no longer be selected.';
    byId('management-search').placeholder = tab === 'personnel' ? 'Search name, email, position, or campus' : 'Search file code or name';
    byId('management-add').classList.toggle('d-none', tab === 'documents');
    byId('management-status-wrap').classList.toggle('d-none', tab === 'documents');
    markNavigation();
    await load();
  }

  function renderCatalog() {
    const search = byId('management-search').value.trim().toLowerCase();
    const status = byId('management-status').value;
    const personnel = tab === 'personnel';
    const filtered = rows.filter((row) => [row.name, ...(personnel ? [row.email, row.position, row.campus] : [])].filter(Boolean).join(' ').toLowerCase().includes(search)
      && (!status || (status === 'active') === row.is_active));
    pages = Math.max(1, Math.ceil(filtered.length / 20)); page = Math.min(page, pages);
    const headings = personnel
      ? '<th>Name / email</th><th>Position / designation</th><th>Campus</th>'
      : '<th>Name</th>';
    const entries = filtered.slice((page - 1) * 20, page * 20).map((row) => {
      const identity = personnel
        ? `<strong class="identity-name management-personnel-name">${escapeHtml(String(row.name || ''))}</strong><small class="identity-email text-muted management-personnel-email">${escapeHtml(String(row.email || 'Not recorded').toLowerCase())}</small>`
        : escapeHtml(row.name);
      const details = personnel
        ? ['position', 'campus'].map((field) => `<td class="management-personnel-${field}">${row[field] ? escapeHtml(row[field]) : '<span class="text-muted">Not recorded</span>'}</td>`).join('')
        : '';
      const actionColumnClass = personnel ? '' : ' class="management-source-actions-column"';
      return `<tr><td>${identity}</td>${details}<td><span class="badge ${row.is_active ? 'bg-label-success' : 'bg-label-secondary'}">${row.is_active ? 'Active' : 'Inactive'}</span></td><td${actionColumnClass}><button class="btn btn-sm btn-outline-primary" type="button" data-edit-catalog="${row.id}">Edit</button></td></tr>`;
    }).join('');
    const actionHeadingClass = personnel ? '' : ' class="management-source-actions-column"';
    byId('management-list').innerHTML = `<div class="table-responsive"><table class="table table-hover align-middle"><thead><tr>${headings}<th>Status</th><th${actionHeadingClass}>Actions</th></tr></thead><tbody>${entries || `<tr><td colspan="${personnel ? 5 : 3}" class="text-center text-muted py-4">No matching entries.</td></tr>`}</tbody></table></div>`;
    pagination(filtered.length);
  }

  function pagination(total) {
    byId('management-count').textContent = `${total} ${tab === 'documents' ? 'records' : 'entries'} · Page ${page} of ${pages}`;
    byId('management-prev').disabled = page <= 1;
    byId('management-next').disabled = page >= pages;
  }

  function documentRow(row) {
    const statuses = { created: 'Registered', in_transit: 'In transit', received: 'Received', acted: 'Acted', completed: 'Completed', delivered: 'Delivered' };
    const status = String(row.status || '');
    const statusClass = Object.hasOwn(statuses, status) ? status : 'created';
    const statusLabel = statuses[status] || status.replaceAll('_', ' ') || 'Unknown status';
    const reference = escapeHtml(row.reference_no || '');
    return `<tr>
      <td class="management-document-summary">
        <div class="management-document-name">${escapeHtml(String(row.subject || 'Untitled document'))}</div>
        <div class="management-document-meta">
          <span class="reference-number management-document-code"><span class="visually-hidden">File code </span>${escapeHtml(String(row.reference_no || ''))}</span>
          <span class="badge-status badge-${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
      </td>
      <td class="management-document-actions-column"><div class="management-document-actions">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-document="${reference}"><i class="bx bx-show" aria-hidden="true"></i> View</button>
        ${row.permissions?.edit_particulars ? `<button type="button" class="btn btn-sm btn-outline-primary" data-edit-document="${reference}" data-edit-kind="particulars"><i class="bx bx-edit-alt" aria-hidden="true"></i> Edit particulars</button>` : ''}
      </div></td>
    </tr>`;
  }

  async function load() {
    if (!allowed()) return;
    const current = ++request;
    byId('management-error').classList.add('d-none');
    byId('management-list').innerHTML = '<div class="p-5 text-center text-muted" role="status">Loading records…</div>';
    byId('management-prev').disabled = true; byId('management-next').disabled = true;
    try {
      if (tab !== 'documents') {
        const response = await api(`/api/routing/management/${tab}`);
        if (current !== request || !allowed()) return;
        rows = response.data; renderCatalog(); return;
      }
      const query = new URLSearchParams({ queue: 'all', office_id: 'all', page: String(page), search: byId('management-search').value.trim() });
      const response = await api(`/api/routing/workspace?${query}`);
      if (current !== request || !allowed()) return;
      pages = response.pagination.pages;
      byId('management-list').innerHTML = `<div class="table-responsive"><table class="table table-hover align-middle management-document-table"><thead><tr><th scope="col">Document</th><th scope="col" class="management-document-actions-column">Actions</th></tr></thead><tbody>${response.data.map(documentRow).join('') || '<tr><td colspan="2" class="text-center text-muted py-4">No matching documents.</td></tr>'}</tbody></table></div>`;
      pagination(response.pagination.total);
    } catch (err) {
      if (current !== request || !allowed()) return;
      byId('management-list').innerHTML = '';
      error('management-error', err.message);
    }
  }

  function showEditor(title, html) {
    byId('record-edit-title').textContent = title;
    byId('record-edit-error').classList.add('d-none');
    byId('record-edit-body').innerHTML = html;
    byId('record-edit-reason').value = '';
    byId('record-edit-submit').disabled = false;
    modal.show();
  }

  function editCatalog(id) {
    if (!allowed() || saving) return;
    const row = id ? rows.find((item) => item.id === Number(id)) : null;
    if (id && !row) return;
    pending = { catalog: tab, row };
    const personnel = tab === 'personnel';
    const suggestions = (field) => [...new Set([...rows.map((item) => item[field]), ...(field === 'campus' ? state.offices.map((office) => office.campus) : [])])]
      .filter((value) => value && !['unknown', 'n/a', 'na'].includes(value.trim().toLowerCase())).sort((a, b) => a.localeCompare(b))
      .map((value) => option(value, value, false)).join('');
    showEditor(`${row ? 'Edit' : 'Add'} ${tab === 'personnel' ? 'faculty / personnel' : 'document source'}`,
      `<label class="form-label" for="record-catalog-name">${personnel ? 'Full name' : 'Name'} *</label><input id="record-catalog-name" name="name" class="form-control mb-3" maxlength="${personnel ? 160 : 255}" required value="${escapeHtml(row?.name || '')}" />
      ${personnel ? `<div class="row g-3 mb-3"><div class="col-12"><label class="form-label" for="record-personnel-email">Email address *</label><input id="record-personnel-email" name="email" type="email" autocomplete="email" class="form-control" maxlength="191" required value="${escapeHtml(row?.email || '')}" /><small class="form-text">Enter the person's actual email address.</small></div>
      <div class="col-md-6"><label class="form-label" for="record-personnel-position">Position / designation *</label><input id="record-personnel-position" name="position" class="form-control" maxlength="255" required list="record-position-options" value="${escapeHtml(row?.position || '')}" /><datalist id="record-position-options">${suggestions('position')}</datalist></div>
      <div class="col-md-6"><label class="form-label" for="record-personnel-campus">Campus *</label><input id="record-personnel-campus" name="campus" class="form-control" maxlength="80" required list="record-campus-options" value="${escapeHtml(row?.campus && !['unknown', 'n/a', 'na'].includes(row.campus.trim().toLowerCase()) ? row.campus : '')}" /><datalist id="record-campus-options">${suggestions('campus')}</datalist></div></div><p class="small text-muted">Personnel details are for document records. Login access is managed in User accounts.</p>` : ''}
      <div class="form-check"><input id="record-catalog-active" class="form-check-input" type="checkbox"${!row || row.is_active ? ' checked' : ''} /><label for="record-catalog-active" class="form-check-label">Active — available for new selections</label></div>`);
  }

  function ownerFields(data, options) {
    const types = [...options.document_types];
    if (data.document_type_id && !types.some((item) => String(item.id) === String(data.document_type_id))) types.push({ id: data.document_type_id, name: data.document_type, details_kind: data.travel_details ? 'travel_order' : 'personnel' });
    const sources = [...options.source_divisions];
    if (data.source_division_id && !sources.some((item) => String(item.id) === String(data.source_division_id))) sources.push({ id: data.source_division_id, name: data.external_sender });
    const people = new Map(options.personnel.map((item) => [String(item.id), item]));
    for (const person of data.personnel || []) people.set(String(person.id), person);
    const selected = new Set((data.personnel || []).map((item) => String(item.id)));
    catalogs = { ...options, document_types: types };
    const travel = data.travel_details || {};
    return `<p class="text-muted">${escapeHtml(data.reference_no)} · ${escapeHtml(data.subject)}</p><p class="small text-muted">The originating office can edit the fields below during preparation or correction. Central Records handles particulars corrections.</p>
      <div class="row g-3"><div class="col-md-6"><label class="form-label" for="record-document-type">Document type *</label><select id="record-document-type" name="document_type_id" class="form-select" required>${option('', 'Select document type', !data.document_type_id)}${types.map((item) => option(item.id, item.name, String(item.id) === String(data.document_type_id))).join('')}</select></div>
      <div class="col-md-6"><label class="form-label" for="record-document-source">Document source</label><select id="record-document-source" name="source_division_id" class="form-select"${data.source_division_id ? ' required' : ''}>${option('', 'Original office source', !data.source_division_id)}${sources.map((item) => option(item.id, item.name, String(item.id) === String(data.source_division_id))).join('')}</select></div>
      <div class="col-12"><label class="form-label" for="record-document-people">Faculty / personnel involved</label><select id="record-document-people" name="personnel_ids" class="form-select" multiple size="6">${[...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => option(item.id, item.name, selected.has(String(item.id)))).join('')}</select><small class="form-text">Travel Orders require at least one traveler.</small></div>
      <div class="col-12" id="record-travel-wrap"><fieldset id="record-travel-fields" class="border rounded p-3"><legend class="float-none w-auto px-2 fs-6">Travel Order details</legend><div class="row g-3">
      ${[['destination', 'Destination', 2000], ['purpose', 'Purpose', 2000], ['remarks', 'Remarks', 10000]].map(([key, label, limit]) => `<div class="col-12"><label class="form-label" for="record-travel-${key}">${label}${key !== 'remarks' ? ' *' : ''}</label><textarea id="record-travel-${key}" name="travel_${key}" class="form-control" maxlength="${limit}"${key !== 'remarks' ? ' required' : ''}>${escapeHtml(travel[key] || '')}</textarea></div>`).join('')}
      ${[['order_date', 'Order date'], ['departure_date', 'Departure date'], ['return_date', 'Return date']].map(([key, label]) => `<div class="col-md-4"><label class="form-label" for="record-travel-${key}">${label} *</label><input id="record-travel-${key}" name="travel_${key}" type="date" class="form-control" required value="${escapeHtml(travel[key] || '')}" /></div>`).join('')}
      ${[['type', 'Travel type', ['Official Time', 'Official Business'], travel.travel_type], ['vehicle_requirement', 'Vehicle requirement', ['Yes', 'Not Necessary'], travel.vehicle_requirement]].map(([key, label, values, value]) => `<div class="col-md-6"><label class="form-label" for="record-travel-${key}">${label} *</label><select id="record-travel-${key}" name="travel_${key}" class="form-select" required>${option('', 'Select ' + label.toLowerCase(), !value)}${values.map((item) => option(item, item, item === value)).join('')}</select></div>`).join('')}
      </div></fieldset></div></div>`;
  }

  function travelFields() {
    const type = catalogs?.document_types.find((item) => String(item.id) === byId('record-document-type')?.value);
    const travel = type?.details_kind === 'travel_order';
    byId('record-travel-wrap').classList.toggle('d-none', !travel);
    byId('record-travel-fields').disabled = !travel;
  }

  async function editDocument(reference, kind) {
    if (saving || !state.user || !['particulars', 'details'].includes(kind)) return;
    if (kind === 'particulars' && !allowed()) return;
    const current = ++editRequest;
    const role = state.activeRole;
    pending = null;
    showEditor('Loading document…', '<p class="text-muted" role="status">Loading editable details…</p>');
    byId('record-edit-submit').disabled = true;
    try {
      const { data } = await api(`/api/documents/${encodeURIComponent(reference)}`);
      if (current !== editRequest || state.activeRole !== role) return;
      if (!data.permissions?.[kind === 'particulars' ? 'edit_particulars' : 'edit_details']) throw new Error('This document cannot be edited in the selected role or workflow stage.');
      let html;
      if (kind === 'particulars') html = `<p class="text-muted">${escapeHtml(data.reference_no)}</p><label class="form-label" for="record-particulars">Particulars / document name *</label><textarea id="record-particulars" name="description" class="form-control" rows="6" maxlength="10000" required>${escapeHtml(data.description || data.subject)}</textarea><small class="form-text">The document heading and search results will use the corrected text.</small>`;
      else {
        const options = await api('/api/routing/registration-options');
        if (current !== editRequest || state.activeRole !== role) return;
        html = ownerFields(data, options);
      }
      pending = { reference, kind, data, role };
      showEditor(kind === 'particulars' ? 'Correct document particulars' : 'Edit document details', html);
      if (kind === 'details') {
        travelFields();
        byId('record-document-type').addEventListener('change', travelFields);
        const jquery = window.jQuery;
        if (jquery?.fn?.select2) {
          for (const id of ['record-document-people', 'record-document-source']) jquery(byId(id)).select2({ dropdownParent: jquery(byId('record-edit-modal')), width: '100%', closeOnSelect: id !== 'record-document-people' });
        }
      }
    } catch (err) { if (current === editRequest && state.activeRole === role) error('record-edit-error', err.message); }
  }

  async function save(event) {
    event.preventDefault();
    if (!pending || saving) return;
    const edit = pending;
    const role = state.activeRole;
    const current = editRequest;
    if (edit.catalog ? !allowed() : role !== edit.role) return;
    saving = true; byId('record-edit-submit').disabled = true;
    byId('record-edit-error').classList.add('d-none');
    try {
      let payload;
      let path;
      if (edit.catalog) {
        payload = { name: byId('record-catalog-name').value, is_active: byId('record-catalog-active').checked, reason: byId('record-edit-reason').value };
        if (edit.catalog === 'personnel') for (const field of ['email', 'position', 'campus']) payload[field] = byId('record-personnel-' + field).value;
        if (edit.row) payload.version = edit.row.version;
        path = `/api/routing/management/${edit.catalog}${edit.row ? '/' + edit.row.id : ''}`;
      } else {
        const form = new FormData(byId('record-edit-form'));
        payload = { version: edit.data.edit_version, reason: byId('record-edit-reason').value };
        if (edit.kind === 'particulars') payload.description = form.get('description');
        else {
          for (const [key, value] of form) if (key !== 'personnel_ids' && key !== 'reason') payload[key] = value;
          payload.personnel_ids = form.getAll('personnel_ids');
          if (byId('record-travel-fields').disabled) for (const key of ['destination', 'purpose', 'order_date', 'departure_date', 'return_date', 'type', 'vehicle_requirement', 'remarks']) payload['travel_' + key] = '';
        }
        path = `/api/documents/${encodeURIComponent(edit.reference)}/${edit.kind}`;
      }
      await api(path, { method: edit.catalog && !edit.row ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (current !== editRequest || role !== state.activeRole) return;
      pending = null; modal.hide();
      if (!byId('section-management').classList.contains('d-none') && allowed()) await load();
      else if (edit.reference) await openDocument(edit.reference);
    } catch (err) { if (current === editRequest && role === state.activeRole) error('record-edit-error', err.message); }
    finally { saving = false; if (current === editRequest) byId('record-edit-submit').disabled = false; }
  }

  function handleClick(event) {
    const nav = event.target.closest('[data-management-nav]');
    if (nav) { event.preventDefault(); open(nav.dataset.managementNav); }
    const edit = event.target.closest('[data-edit-document]');
    if (edit) { event.preventDefault(); editDocument(edit.dataset.editDocument, edit.dataset.editKind); }
    const catalog = event.target.closest('[data-edit-catalog]');
    if (catalog) editCatalog(catalog.dataset.editCatalog);
  }

  function bind() {
    byId('management-add').addEventListener('click', () => editCatalog());
    byId('management-refresh').addEventListener('click', load);
    byId('management-status').addEventListener('change', () => { page = 1; renderCatalog(); });
    byId('management-search').addEventListener('input', () => {
      clearTimeout(timer); page = 1; request++;
      if (tab !== 'documents') renderCatalog(); else timer = setTimeout(load, 250);
    });
    for (const [id, direction] of [['management-prev', -1], ['management-next', 1]]) byId(id).addEventListener('click', () => {
      page += direction; if (tab === 'documents') load(); else renderCatalog();
    });
    byId('record-edit-form').addEventListener('submit', save);
    byId('record-edit-modal').addEventListener('hidden.bs.modal', () => {
      editRequest++; pending = null;
      const jquery = window.jQuery;
      for (const id of ['record-document-people', 'record-document-source']) {
        const select = byId(id);
        if (select && jquery?.fn?.select2 && jquery(select).hasClass('select2-hidden-accessible')) jquery(select).select2('destroy');
      }
    });
  }

  return { open, reset, bind, handleClick, markNavigation };
}
