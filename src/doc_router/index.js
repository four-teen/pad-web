// The API's offset-free routing timestamps are UTC, regardless of browser timezone.
function routingTime(value) {
  if (!value) return NaN;
  const timestamp = String(value).trim().replace(' ', 'T');
  return new Date(timestamp + (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? '' : 'Z')).getTime();
}

function officeDuration(start, end) {
  const seconds = Math.floor((routingTime(end) - routingTime(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return 'Duration unavailable';
  let remaining = seconds;
  const parts = [];
  for (const [size, singular, plural] of [[86400, 'day', 'days'], [3600, 'hr', 'hrs'], [60, 'min', 'mins'], [1, 'sec', 'secs']]) {
    const count = Math.floor(remaining / size);
    if (count) parts.push(`${count} ${count === 1 ? singular : plural}`);
    remaining %= size;
  }
  return parts.join(' ') || '0 secs';
}

function custodyTimeline(data) {
  const events = (data.history || []).map((event, index) => ({ ...event, sequence: index }));
  events.sort((a, b) => (routingTime(a.created_at) - routingTime(b.created_at) || Number(a.id || 0) - Number(b.id || 0) || a.sequence - b.sequence));
  const finalAct = data.status === 'acted' ? events.filter((event) => event.action === 'acted').at(-1) : null;
  let stay = null;
  const matchesOffice = (event) => stay && (event.from_office_id && stay.officeId
    ? Number(event.from_office_id) === Number(stay.officeId)
    : event.origin_office_name === stay.officeName);
  for (const [index, event] of events.entries()) {
    const deliveryContinues = event.action === 'delivered' && ((data.is_owner_release && data.pad_decision === 'returned_for_correction')
      || events.slice(index + 1).some((next) => next.dispatched_at && Number(next.from_office_id) === Number(event.from_office_id)));
    if (['created', 'externally_received', 'received'].includes(event.action)) {
      stay = { officeId: event.to_office_id, officeName: event.destination_office_name,
        startedAt: event.received_at || event.created_at, startAction: event.action, endedAt: null, endAction: null };
      event.officeStay = stay;
    } else if ((['routed', 'returned', 'completed', 'delivered'].includes(event.action) && !deliveryContinues)
      || (event.action === 'acted' && event.dispatched_at) || event === finalAct) {
      if (matchesOffice(event) && !stay.endedAt) {
        stay.endedAt = event.dispatched_at || event.created_at;
        stay.endAction = event.action;
        event.officeStay = stay;
      }
      if (['routed', 'returned'].includes(event.action) || (event.action === 'acted' && event.dispatched_at)) {
        event.transit = { startedAt: event.dispatched_at || event.created_at, endedAt: event.received_at };
      }
    } else if (matchesOffice(event) && !stay.endedAt) {
      // Actions/uploads do not restart a stay or include a later transit interval.
      event.officeStay = { ...stay, observedAt: event.created_at };
    }
  }
  return { events: events.reverse(), currentStay: stay && !stay.endedAt && !data.pending_office_id
    && (!['in_transit', 'acted', 'completed', 'delivered'].includes(data.status)
      || (data.status === 'delivered' && data.is_owner_release && data.pad_decision === 'returned_for_correction')) ? stay : null };
}

export function createDocRouter({ state, api, byId, escapeHtml, formatDate, showNotice, apiState, changeSection, uploadModal, refreshAdmin, resetStatistics }) {
  const prefix = () => ['ovp_pad', 'ovp_central_records', 'sksu_officials', 'router'].includes(state.activeRole) ? 'doc_router' : 'routing';
  const receivingOffices = () => state.offices.filter((office) => String(office.code || '').toUpperCase() !== 'OP' && office.can_receive_documents !== false);
  const queues = {
    attention: { title: 'Received documents needing attention', description: 'Received documents awaiting action in your office, including correction results still requiring work.', overviewOnly: true },
    my_documents: { title: 'My Document', description: 'Documents encoded by your office and ready to send. Sent documents move to Outgoing; their destination confirms receipt.', icon: 'bx-file', color: 'forest' },
    incoming: { title: 'Awaiting Receipt', description: 'Existing documents sent to this office. Confirm the hard-copy handoff; the document keeps its file code.', icon: 'bx-download', color: 'orange' },
    for_approval: { title: 'For Approval', description: 'Documents received from Central Records and awaiting a PAD decision. Record the decision and send them back to Central Records.', icon: 'bx-edit-alt', color: 'orange', role: 'ovp_pad' },
    pad_results: { title: 'Returned from PAD', description: 'Documents sent back by PAD. View the timeline, or Act to confirm Records\' hard-copy receipt and send the result to its owner.', icon: 'bx-check-shield', color: 'info', role: 'ovp_central_records' },
    received: { title: 'Received', description: 'Documents your office has received from another office or an outside source. Documents encoded by your own office appear in My Document.', icon: 'bx-check-circle', color: 'success' },
    outgoing: { title: 'Outgoing', description: 'Documents your office sent onward, with their current progress.', icon: 'bx-send', color: 'forest' },
    returned: { title: 'Returned', description: 'Documents returned to this office. Open the timeline to read the reason.', icon: 'bx-undo', color: 'danger' },
    acted: { title: 'Acted', description: 'Records\' actions and dispatches to document owners. The owner confirms the final hard-copy delivery separately.', icon: 'bx-task', color: 'info' },
    delivered: { title: 'Delivered / completed', description: 'Delivered means the owner confirmed the final hard-copy handoff. Completed means processing was closed without a delivery handoff.', icon: 'bx-check-shield', color: 'success' },
    all: { title: 'All Timeline', description: 'Every document your office registered, sent, or received.', icon: 'bx-history', color: 'muted' }
  };
  const actions = {
    route: { title: 'Send document', description: 'Select the next receiving office. The destination must confirm receipt before taking action.', label: 'Send document' },
    receive: { title: 'Confirm hard-copy receipt', description: 'Confirm that the hard copy has physically arrived at this office. This records the handoff on the existing PAD document number; it does not create another document record.', label: 'Confirm receipt' },
    return: { title: 'Return document', description: 'Return this document to the office that last sent it. A reason is required.', label: 'Return document', required: true },
    act: { title: 'Act & send to owner', description: 'Confirm that Records has the hard copy from PAD, record the action taken, and send the attached document to its owner in one step. The owner confirms delivery when the hard copy arrives.', label: 'Act & send to owner', required: true },
    delete: { title: 'Delete unsent document', description: 'Delete this unsent document and its attachment. This cannot be undone. Its file code will not be reused.', label: 'Delete document' },
    complete: { title: 'Complete document', description: 'Close processing for this document. It will remain available in the timeline.', label: 'Mark completed' },
    deliver: { title: 'Record delivery', description: 'Record the recipient and delivery details. This finishes the document routing process.', label: 'Record delivery', required: true }
  };
  const routing = { queue: 'all', page: 1, scope: '', counts: {}, pagination: { page: 1, pages: 1, total: 0 }, workspace: {}, detail: null };
  actions.decide = { title: 'Record PAD decision & return', description: 'Record the actual PAD decision and send the existing document back to Central Records. Central Records must confirm the hard-copy receipt.', label: 'Record decision & return' };
  const decisionLabels = { approved: 'Approved', disapproved: 'Disapproved', returned_for_correction: 'Returned for correction' };
  const senderRoles = { ovp_pad: 'OVP PAD', ovp_central_records: 'OVP Central Records', sksu_officials: 'SKSU Officials' };
  const receiptRemarks = ['Hard copy received.', 'Received for review.', 'Received for appropriate action.', 'Received for approval.', 'Received for signature.', 'Received for filing.'];
  const documentTypeColors = new Map(Object.entries({
    'ACTIVITY DESIGN': '#6244a3', 'EMAIL': '#2459a6', 'HAND CARRY': '#16744b',
    'LOCAL COMMUNICATION': '#9a600d', 'OUTGOING COMMUNICATION': '#a3421f',
    'PROJECT PROPOSAL': '#aa304c', 'TRAVEL ORDER': '#08758a',
    'MEMORANDUM': '#536c26', 'GENERAL DOCUMENT': '#56616f'
  }));
  const availableQueues = () => Object.entries(queues).filter(([, queue]) => !queue.role || queue.role === state.activeRole);
  const actionModal = new bootstrap.Modal(byId('routing-action-modal'));
  let request = 0;
  let detailRequest = 0;
  let actionPending = null;
  let submissionKey = null;
  let searchTimer;
  let saving = false;
  let acting = false;
  let uploadingFile = false;
  let registrationRequest = 0;
  let registrationOptions = { document_types: [], personnel: [], source_divisions: [] };

  function statusBadge(document) {
    const labels = { created: 'My Document', in_transit: document.movement_type === 'return' ? 'Returning · awaiting receipt' : 'Awaiting receipt', acted: 'Acted', completed: 'Completed', delivered: 'Delivered' };
    const label = document.status === 'received'
      ? (document.last_receipt_action === 'received' ? 'Handoff received'
        : document.is_my_document ? 'My Document' : document.last_receipt_action === 'externally_received' ? 'Outside intake' : 'Receipt confirmed')
      : labels[document.status] || document.status;
    const releaseLabel = document.is_owner_release && document.status === 'in_transit' ? 'Awaiting owner receipt'
      : document.is_owner_release && document.status === 'delivered' ? 'Delivered to owner' : label;
    const acted = document.is_owner_release ? '<span class="badge-status badge-acted me-1">Acted</span>' : '';
    return `${acted}<span class="badge-status badge-${escapeHtml(document.status)}">${escapeHtml(releaseLabel)}</span>`;
  }

  function officeName(name, campus) {
    return `<strong class="d-block routing-office-label">${escapeHtml(name || '—')}</strong>${campus ? `<small class="text-muted">${escapeHtml(campus)}</small>` : ''}`;
  }

  function actionButton(document, action, label, style = 'outline-primary') {
    return `<button type="button" class="btn btn-${style}" data-routing-action="${action}" data-reference="${escapeHtml(document.reference_no)}">${label}</button>`;
  }

  function reviewBadge(document) {
    if (document.awaiting_pad_decision) return '<span class="badge-status badge-pad-review">For approval</span>';
    if (decisionLabels[document.pad_decision]) return `<span class="badge-status badge-pad-${escapeHtml(document.pad_decision)}">${decisionLabels[document.pad_decision]}</span>`;
    if (document.pad_result_unrecorded) return '<span class="badge-status badge-created">Decision not recorded</span>';
    return '';
  }

  function senderLabel(document) {
    const name = document.last_from_office_name;
    if (!name) return '';
    const role = document.last_sender_role === 'sksu_officials' ? '' : senderRoles[document.last_sender_role];
    return `${role ? `${role} · ` : ''}${name}`;
  }

  function sourceName(document) {
    return document.source_division_id ? document.external_sender : document.source_office_name || document.external_sender;
  }

  function documentDate(document) {
    if (document.pending_office_id && document.last_dispatched_at) {
      return `<small class="d-block text-muted mt-1">Sent ${formatDate(document.last_dispatched_at)}</small>`;
    }
    const action = document.last_receipt_action;
    const actor = document.last_received_by_name ? ` ${escapeHtml(document.last_received_by_name)}` : '';
    const byline = action === 'received' ? `Received by${actor}` : action ? `Encoded by${actor}` : '';
    return `<small class="d-block text-muted mt-1">${document.is_my_document ? 'Encoded' : 'Received'} ${formatDate(document.last_received_at || document.created_at)}</small>${byline ? `<small class="d-block text-muted">${byline}</small>` : ''}`;
  }

  function senderCell(document) {
    const sender = senderLabel(document) || sourceName(document) || 'Outside document';
    const campus = document.last_from_office_name ? document.last_from_office_campus : document.source_division_id ? null : document.source_office_campus;
    const source = sourceName(document);
    if (routing.queue === 'received' && document.source_division_id) {
      const handoff = document.last_from_office_name
        ? `<small class="d-block text-muted mt-1">Last sent by: ${escapeHtml(document.last_from_office_name)}</small>` : '';
      return `${officeName(source, null)}${handoff}`;
    }
    const originalSource = document.last_from_office_name && source && source !== document.last_from_office_name
      ? `<small class="d-block text-muted mt-1">${escapeHtml(source)}</small>` : '';
    return `${officeName(sender, campus)}${originalSource}`;
  }

  function documentTypeBadge(document) {
    const type = String(document.document_type || 'General document').trim().replace(/\s+/g, ' ').toUpperCase() || 'GENERAL DOCUMENT';
    if (!documentTypeColors.has(type)) {
      let hash = 0;
      for (const character of type) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
      let hue = hash % 360;
      let color = `hsl(${hue} 60% 32%)`;
      while ([...documentTypeColors.values()].includes(color)) {
        hue = (hue + 137.508) % 360;
        color = `hsl(${hue.toFixed(3)} 60% 32%)`;
      }
      documentTypeColors.set(type, color);
    }
    return `<span class="routing-document-type" style="--document-type-color: ${documentTypeColors.get(type)}">${escapeHtml(type)}</span>`;
  }

  function actionButtons(document, layout = 'horizontal') {
    const permissions = document.permissions || {};
    const viewLabel = routing.queue === 'all' ? 'Show Time Line' : 'View';
    const buttons = document.is_my_document && permissions.delete ? [] : [`<button type="button" class="btn btn-outline-secondary" data-document="${escapeHtml(document.reference_no)}">${viewLabel}</button>`];
    if (document.stored_file_name) buttons.push(`<button type="button" class="btn routing-attachment-button" data-preview-attachment="${escapeHtml(document.reference_no)}" data-file-name="${escapeHtml(document.file_name || document.reference_no)}" aria-label="Preview attachment for ${escapeHtml(document.reference_no)}" title="${escapeHtml(document.file_name || 'Preview attachment')}"><i class="bx bx-paperclip" aria-hidden="true"></i><span>Attachment</span></button>`);
    const padReturn = routing.queue === 'pad_results' || document.is_pad_return;
    if (permissions.receive && !padReturn) buttons.push(actionButton(document, 'receive', 'Receive'));
    if (permissions.decide) buttons.push(actionButton(document, 'decide', 'Record decision & return'));
    if (permissions.route && !padReturn) buttons.push(actionButton(document, 'route', 'Send'));
    if (permissions.act) buttons.push(actionButton(document, 'act', 'Act'));
    if (permissions.delete) buttons.push(actionButton(document, 'delete', 'Delete', 'outline-danger'));
    if (permissions.return && !padReturn) buttons.push(actionButton(document, 'return', 'Return', 'outline-danger'));
    const layoutClass = layout === 'stack' ? ' routing-action-stack' : '';
    return `<div class="btn-group btn-group-sm${layoutClass}" role="group" aria-label="Document actions">${buttons.join('')}</div>`;
  }

  function receivedCard(document) {
    const subject = String(document.subject || 'No Particular').toUpperCase();
    const source = sourceName(document) || 'Outside document';
    const lastSender = senderLabel(document)
      ? `<div><strong>Sent by:</strong> ${escapeHtml(senderLabel(document))}</div>` : '';
    return `<article class="routing-received-card">
      <div class="routing-received-main">
        <h5 class="routing-received-title">${document.is_my_document ? `<a href="#${prefix()}/document/${encodeURIComponent(document.reference_no)}" data-document="${escapeHtml(document.reference_no)}">${escapeHtml(subject)}</a>` : escapeHtml(subject)}</h5>
        <div class="routing-received-meta">
          <div><strong>File Code:</strong> ${escapeHtml(document.reference_no || '—')}</div>
          <div><strong>Division:</strong> ${escapeHtml(source)}</div>
          ${lastSender}
        </div>
        <div class="routing-received-tags">${documentTypeBadge(document)}${reviewBadge(document)}${statusBadge(document)}</div>
      </div>
      <div class="routing-received-actions">${actionButtons(document, 'stack')}</div>
    </article>`;
  }

  function row(document) {
    const subject = String(document.subject || 'No Particular').toUpperCase();
    return `<tr><td class="routing-file-column"><span class="reference-number">${escapeHtml(document.reference_no)}</span><div class="routing-file-type">${documentTypeBadge(document)}</div>${documentDate(document)}</td>
      <td class="routing-particular-column"><div class="document-subject fw-semibold" title="${escapeHtml(subject)}">${document.is_my_document ? `<a href="#${prefix()}/document/${encodeURIComponent(document.reference_no)}" data-document="${escapeHtml(document.reference_no)}">${escapeHtml(subject)}</a>` : escapeHtml(subject)}</div><div class="routing-document-sender">${senderCell(document)}</div></td>
      ${routing.queue === 'incoming' ? '' : `<td>${officeName(document.current_office_name, document.current_office_campus)}${document.pending_office_id ? `<small class="d-block routing-pending mt-1"><i class="bx bx-right-arrow-alt"></i> ${escapeHtml(document.pending_office_name)} <span class="text-muted">· awaiting receipt</span></small>` : ''}</td>`}
      <td class="routing-status-column"><div class="routing-received-tags routing-status-badges mt-0">${reviewBadge(document)}${statusBadge(document)}</div></td><td class="admin-actions-column">${actionButtons(document, 'stack')}</td></tr>`;
  }

  function render() {
    const workspace = routing.workspace;
    const counts = routing.counts;
    document.querySelectorAll('[data-queue-count]').forEach((element) => { element.textContent = counts[element.dataset.queueCount] || 0; });
    const deskCounts = workspace.desk_counts || counts;
    byId('routing-stats').innerHTML = availableQueues().filter(([, queue]) => !queue.overviewOnly).map(([key, queue]) => `<div class="col-sm-6 col-lg-4 col-xxl-3"><button type="button" class="card routing-stat w-100 text-start" data-open-queue="${key}" data-own-scope><div class="card-body d-flex align-items-center gap-3"><span class="metric-icon ${queue.color} mb-0"><i class="bx ${queue.icon}"></i></span><div><small class="text-muted d-block mb-1">${queue.title}</small><span class="routing-stat-value">${deskCounts[key] || 0}</span></div><i class="bx bx-chevron-right ms-auto text-muted"></i></div></button></div>`).join('');
    const office = workspace.office;
    const label = office ? office.name : workspace.can_monitor ? 'All offices' : 'Office assignment pending';
    byId('routing-office-name').textContent = label;
    byId('routing-office-campus').textContent = office?.campus || '';
    byId('routing-office-campus').classList.toggle('d-none', !office?.campus);
    byId('routing-queue-office').textContent = label + (office?.campus ? ` · ${office.campus}` : '');
    byId('routing-monitor-wrap').classList.toggle('d-none', !workspace.can_monitor);
    byId('routing-assignment-notice').classList.toggle('d-none', Boolean(state.user?.office_id));
    byId('routing-assignment-notice').textContent = state.activeRole === 'admin'
      ? 'Assign your account to an office in User accounts to send or receive office documents. You can monitor all offices and register outside documents through Records.'
      : 'Your account needs an office assignment before you can register, send, or receive office documents. Ask your administrator to assign your office.';
    const title = queues[routing.queue];
    byId('routing-queue-title').textContent = title.title;
    byId('routing-queue-description').textContent = title.description;
    const isReceivedQueue = ['attention', 'my_documents', 'received', 'for_approval', 'pad_results'].includes(routing.queue);
    byId('document-table-wrap').classList.toggle('d-none', isReceivedQueue);
    byId('received-card-list').classList.toggle('d-none', !isReceivedQueue);
    const showLocation = routing.queue !== 'incoming';
    byId('document-table-head').innerHTML = `<th class="routing-file-column">File code / date</th><th class="routing-particular-column">Particular</th>${showLocation ? '<th>Current location / destination</th>' : ''}<th class="routing-status-column">Status</th><th class="admin-actions-column">Actions</th>`;
    const rows = state.documents.map(row).join('') || `<tr><td colspan="${showLocation ? 5 : 4}" class="text-center text-muted py-5"><i class="bx bx-folder-open fs-2 d-block mb-2"></i>No documents in this queue.</td></tr>`;
    byId('document-list').innerHTML = rows;
    const cards = state.documents.map(receivedCard).join('') || '<div class="text-center text-muted py-5"><i class="bx bx-folder-open fs-2 d-block mb-2"></i>No documents in this queue.</div>';
    byId('received-card-list').innerHTML = cards;
    const { page, pages, total } = routing.pagination;
    if (routing.queue === 'attention') {
      byId('overview-office').textContent = state.user?.office_name || label;
      byId('overview-documents').innerHTML = state.documents.map(receivedCard).join('') || '<div class="text-center text-muted py-5"><i class="bx bx-check-circle fs-2 d-block mb-2"></i>No received documents need attention in your office.</div>';
      byId('overview-document-count').textContent = total ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total} documents · Page ${page} of ${pages}` : 'No received documents awaiting action';
      byId('overview-prev').disabled = page <= 1;
      byId('overview-next').disabled = page >= pages;
    }
    byId('routing-document-count').textContent = total ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total} documents · Page ${page} of ${pages}` : 'No matching documents';
    byId('routing-prev').disabled = page <= 1;
    byId('routing-next').disabled = page >= pages;
    updateNavigation();
  }

  function updateNavigation() {
    const visible = !byId('section-documents').classList.contains('d-none') || !byId('section-track').classList.contains('d-none');
    byId('routing-review-nav-group').classList.toggle('d-none', !availableQueues().some(([, queue]) => queue.role));
    document.querySelectorAll('[data-routing-queue]').forEach((item) => {
      const queue = queues[item.dataset.routingQueue];
      item.classList.toggle('d-none', Boolean(queue?.role && queue.role !== state.activeRole));
      item.classList.toggle('active', visible && item.dataset.routingQueue === routing.queue);
    });
  }

  function officeOptions() {
    const options = state.offices.map((office) => `<option value="${office.id}">${escapeHtml(office.name + (office.campus ? ` · ${office.campus}` : ''))}</option>`).join('');
    byId('routing-office-filter').innerHTML = '<option value="all">All offices</option>' + options;
    byId('routing-office-filter').value = routing.scope || (state.user?.office_id ? String(state.user.office_id) : 'all');
  }

  async function refresh() {
    const overviewVisible = !byId('section-dashboard').classList.contains('d-none');
    if (overviewVisible) { routing.queue = 'attention'; routing.scope = ''; }
    if (!availableQueues().some(([key]) => key === routing.queue)) routing.queue = 'all';
    const current = ++request;
    const params = new URLSearchParams({ queue: routing.queue, page: String(routing.page), search: overviewVisible ? byId('overview-search').value || '' : byId('document-search').value || '', status: overviewVisible ? '' : byId('status-filter').value || '' });
    if (routing.scope) params.set('office_id', routing.scope);
    byId('document-list').setAttribute('aria-busy', 'true');
    if (overviewVisible) {
      byId('overview-documents').setAttribute('aria-busy', 'true');
      byId('overview-documents').innerHTML = '<div class="text-center text-muted py-5">Loading received documents…</div>';
      byId('overview-prev').disabled = true; byId('overview-next').disabled = true;
    }
    try {
      const [offices, workspace] = await Promise.all([api('/api/offices'), api(`/api/routing/workspace?${params}`)]);
      if (current !== request || !state.user) return;
      state.offices = offices.data;
      state.documents = workspace.data;
      routing.workspace = workspace;
      routing.counts = workspace.counts || {};
      routing.pagination = workspace.pagination || { page: 1, pages: 1, total: state.documents.length };
      routing.page = routing.pagination.page;
      officeOptions();
      render();
      apiState(true);
    } catch (error) {
      if (current !== request) return;
      apiState(false);
      showNotice(error.message);
      if (overviewVisible) byId('overview-documents').innerHTML = '<div class="text-center text-muted py-5">Received documents could not be loaded. Open Overview to try again.</div>';
    } finally {
      if (current === request) {
        byId('document-list').setAttribute('aria-busy', 'false');
        byId('overview-documents').setAttribute('aria-busy', 'false');
      }
    }
  }

  function clearFilters() { byId('document-search').value = ''; byId('status-filter').value = ''; routing.page = 1; }

  async function showQueue(queue) {
    if (!availableQueues().some(([key]) => key === queue)) queue = 'all';
    clearFilters();
    routing.queue = queue;
    changeSection('documents');
    window.history.replaceState(null, '', `#${prefix()}/${queue}`);
    updateNavigation();
    await refresh();
  }

  function overview() { clearFilters(); byId('overview-search').value = ''; routing.scope = ''; routing.queue = 'attention'; return refresh(); }

  function additionalDetails(data) {
    const travel = data.travel_details;
    const people = (data.personnel || []).map((person) => `<li>${escapeHtml(person.name)}</li>`).join('');
    const fields = travel ? Object.entries({ destination: 'Destination', purpose: 'Purpose', order_date: 'Order date', departure_date: 'Departure date',
      return_date: 'Return date', travel_type: 'Travel type', vehicle_requirement: 'Vehicle requirement', remarks: 'Travel remarks' })
      .filter(([key]) => travel[key]).map(([key, label]) => `<div class="col-md-6"><dt class="small text-muted fw-normal">${label}</dt><dd class="routing-remarks mb-0">${escapeHtml(travel[key])}</dd></div>`).join('') : '';
    return people || travel ? `<section class="border rounded p-3 mb-4"><h6>${travel ? 'Travel Order details' : 'Additional document information'}</h6>
      ${people ? `<p class="small text-muted mb-1">${travel ? 'Travelers / faculty / personnel' : 'Faculty / personnel involved'}</p><ul class="mb-3">${people}</ul>` : ''}
      ${fields ? `<dl class="row g-3 mb-0">${fields}</dl>` : ''}</section>` : '';
  }

  function documentFile(data) {
    const download = data.stored_file_name ? `<button type="button" class="btn routing-attachment-button btn-sm" data-preview-attachment="${escapeHtml(data.reference_no)}" data-file-name="${escapeHtml(data.file_name || data.reference_no)}"><i class="bx bx-paperclip" aria-hidden="true"></i><span>Preview ${escapeHtml(data.file_name || 'attachment')}</span></button>`
      : '<p class="small text-muted mb-0">No document file uploaded yet. It can be attached later.</p>';
    const upload = data.permissions?.upload_file ? `<form id="document-attachment-form" data-reference="${escapeHtml(data.reference_no)}" class="mt-3">
      <div id="document-attachment-error" class="alert alert-danger d-none" role="alert"></div>
      <label class="form-label" for="document-attachment-file">${data.stored_file_name ? 'Upload an updated / signed copy' : 'Upload document file'}</label>
      <div class="d-flex flex-wrap gap-2"><input id="document-attachment-file" name="file" class="form-control flex-grow-1 w-auto" type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" aria-describedby="document-attachment-help" /><button type="submit" class="btn btn-primary">${data.stored_file_name ? 'Update file' : 'Upload file'}</button></div>
      <small id="document-attachment-help" class="form-text d-block">${data.stored_file_name ? 'This replaces the current attached file. ' : ''}${['completed', 'delivered'].includes(data.status) ? 'You can upload the signed copy even after completion.' : 'Attach the final copy before marking the document Acted.'} PDF, Word, Excel, JPG or PNG · max 10 MB.</small></form>` : '';
    return download + upload;
  }

  async function uploadAttachment(event) {
    const form = event.target;
    if (form.id !== 'document-attachment-form') return;
    event.preventDefault();
    if (uploadingFile) return;
    uploadingFile = true;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = byId('document-attachment-error');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Uploading…';
    errorBox.classList.add('d-none');
    try {
      const response = await api(`/api/documents/${encodeURIComponent(form.dataset.reference)}/file`, { method: 'POST', body: new FormData(form) });
      await refresh();
      await openDocument(response.reference_no);
      showNotice(response.message, 'success');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('d-none');
    } finally { uploadingFile = false; button.disabled = false; button.textContent = label; }
  }

  function stayDetails(event, asOf) {
    const stay = event.officeStay;
    const endLabels = { routed: 'Sent', returned: 'Returned', acted: 'Acted', completed: 'Completed', delivered: 'Delivered' };
    const office = stay ? `<div class="border rounded bg-light p-3 mt-2">
      <small class="text-muted d-block">Time in office · ${escapeHtml(stay.officeName || 'Recorded office')}</small>
      <strong class="d-block text-primary">${officeDuration(stay.startedAt, stay.endedAt || stay.observedAt || asOf)}</strong>
      <small class="d-block text-muted">${stay.startAction === 'received' ? 'Received' : 'Registered'}: ${formatDate(stay.startedAt)}</small>
      <small class="d-block text-muted">${stay.endedAt ? `${endLabels[stay.endAction]}: ${formatDate(stay.endedAt)}`
        : stay.observedAt ? `Elapsed at this action: ${formatDate(stay.observedAt)}` : `Still in office · As of ${formatDate(asOf)}`}</small></div>` : '';
    const transit = event.transit ? `<small class="d-block text-muted mt-2">Transit time: ${officeDuration(event.transit.startedAt, event.transit.endedAt || asOf)}
      · ${event.transit.endedAt ? `Receipt confirmed ${formatDate(event.transit.endedAt)}` : 'Awaiting confirmed receipt'}</small>` : '';
    return office + transit;
  }

  function custodySummary(data, currentStay, asOf) {
    const current = currentStay
      ? `<small class="text-muted d-block">Time in current office</small><strong class="text-primary d-block">${officeDuration(currentStay.startedAt, asOf)}</strong><small>${escapeHtml(currentStay.officeName || data.current_office_name || 'Recorded office')}</small>`
      : `<small class="text-muted d-block">Current custody</small><strong>${data.pending_office_id || data.status === 'in_transit' ? 'In transit · awaiting receipt' : ['acted', 'completed', 'delivered'].includes(data.status) ? 'Processing finished' : 'Receipt time unavailable'}</strong>`;
    return `<section class="journey-custody" aria-label="Registration and office stay">
      <div><small>Registered</small><strong>${formatDate(data.created_at)}</strong></div>
      <div>${current}</div><div><small>Duration calculated as of</small><strong>${formatDate(asOf)}</strong></div></section>`;
  }

  function journeyTimeline(data, timeline, asOf) {
    const events = timeline.events;
    const icons = { created: 'bx-file', externally_received: 'bx-file', routed: 'bx-send', received: 'bx-check', returned: 'bx-undo',
      acted: 'bx-task', pad_decided: 'bx-edit-alt', completed: 'bx-check-shield', delivered: 'bx-check-double', file_uploaded: 'bx-upload' };
    const steps = events.map((event, index) => {
      const latest = index === 0;
      const stepNumber = events.length - index;
      const labels = { created: 'Document registered', externally_received: 'Outside document registered', routed: 'Sent to another office', received: 'Hard copy received',
        returned: 'Returned', acted: event.dispatched_at ? 'Acted & sent to owner' : event.officeStay?.endAction === 'acted' ? 'Final action by Central Records' : 'Action taken',
        pad_decided: 'PAD decision recorded', completed: 'Completed', delivered: 'Delivered', file_uploaded: 'Document file uploaded' };
      const origin = event.origin_office_name || (event.action === 'externally_received' ? data.external_sender : '');
      const destination = event.destination_office_name || origin || 'Recorded office';
      const route = origin && origin !== destination ? `<span class="journey-origin">${escapeHtml(origin)}</span><i class="bx bx-right-arrow-alt" aria-hidden="true"></i>` : '';
      const extra = event.notes || event.officeStay || event.transit;
      const timestamp = routingTime(event.created_at);
      const datetime = Number.isFinite(timestamp) ? ` datetime="${new Date(timestamp).toISOString()}"` : '';
      return `<li role="listitem" aria-label="Step ${stepNumber}: ${escapeHtml(labels[event.action] || event.action)}" class="journey-step journey-step--${icons[event.action] ? event.action : 'other'}${latest ? ' journey-step--latest' : ''}">
        <span class="journey-node" aria-hidden="true"><i class="bx ${icons[event.action] || 'bx-history'}"></i><span class="journey-number">${stepNumber}</span></span>
        <article class="journey-event">
          <div class="journey-event-top"><span class="journey-step-label">Step ${stepNumber}</span>${latest ? '<span class="journey-latest">Latest event</span>' : ''}</div>
          <time class="journey-date"${datetime}>${formatDate(event.created_at)}</time>
          <h6 class="journey-event-title">${escapeHtml(labels[event.action] || event.action)}</h6>
          <div class="journey-office">${route}<strong>${escapeHtml(destination)}</strong></div>
          <p class="journey-actor"><i class="bx bx-user" aria-hidden="true"></i> ${escapeHtml(event.acted_by_name || 'Recorded staff')}</p>
          ${extra ? `<details class="journey-extra"><summary>Remarks & duration <i class="bx bx-chevron-down" aria-hidden="true"></i></summary>
            ${event.notes ? `<p class="routing-remarks journey-note">${escapeHtml(event.notes)}</p>` : ''}${stayDetails(event, asOf)}</details>` : ''}
        </article></li>`;
    }).join('');
    return `<section class="document-journey" aria-label="Document journey">
      <div class="journey-heading"><div><h5>Document journey <span class="journey-count">${events.length} ${events.length === 1 ? 'event' : 'events'}</span></h5>
        <p>Latest activity first <span aria-hidden="true">&middot;</span> Asia/Manila (UTC+08:00)</p></div>
        <div class="journey-controls">${events.length ? '<button type="button" class="btn btn-sm btn-outline-primary" data-journey-position="latest"><i class="bx bx-left-arrow-alt me-1" aria-hidden="true"></i> Latest event</button><button type="button" class="btn btn-sm btn-outline-secondary" data-journey-position="first">First step <i class="bx bx-right-arrow-alt ms-1" aria-hidden="true"></i></button>' : ''}
          <button type="button" class="btn btn-sm btn-outline-secondary" data-document="${escapeHtml(data.reference_no)}"><i class="bx bx-refresh me-1" aria-hidden="true"></i> Refresh timeline</button></div></div>
      ${events.length ? `<p class="journey-hint"><i class="bx bx-move-horizontal" aria-hidden="true"></i> Latest to earliest. Scroll across to see more; expand an event for remarks and office stay.</p>
        <div id="journey-scroll" class="journey-scroll" tabindex="0" role="region" aria-label="Document events, scroll horizontally"><ol class="journey-track" role="list">${steps}</ol></div>`
        : '<div class="journey-empty"><i class="bx bx-history" aria-hidden="true"></i><p>No recorded movements.</p></div>'}</section>`;
  }

  async function openDocument(reference) {
    const current = ++detailRequest;
    changeSection('track');
    window.history.replaceState(null, '', `#${prefix()}/document/${encodeURIComponent(reference)}`);
    updateNavigation();
    byId('document-detail').className = 'card document-timeline';
    byId('document-detail').innerHTML = '<div class="card-body text-center py-5 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading document timeline…</div>';
    try {
      const { data } = await api(`/api/documents/${encodeURIComponent(reference)}`);
      if (current !== detailRequest || !state.user) return;
      routing.detail = data;
      const asOf = data.server_time || new Date().toISOString();
      const timeline = custodyTimeline(data);
      const buttons = [];
      for (const [key, label] of Object.entries({ receive: 'Receive', decide: 'Record decision & return', route: 'Send', return: 'Return', act: 'Act', delete: 'Delete', complete: 'Complete', deliver: 'Record delivery' })) {
        if ((data.is_pad_return || routing.queue === 'pad_results') && key !== 'act') continue;
        if (data.permissions?.[key]) buttons.push(actionButton(data, key, label, ['return', 'delete'].includes(key) ? 'outline-danger' : 'outline-primary'));
      }
      byId('document-detail').innerHTML = `<div class="card-body p-4"><div class="journey-document-heading"><div><p class="reference-number mb-2">${escapeHtml(data.reference_no)}</p><h4 class="routing-timeline-title">${escapeHtml(String(data.subject || 'No Particular').toUpperCase())}</h4>
        <div class="routing-received-tags">${documentTypeBadge(data)}${statusBadge(data)}${reviewBadge(data)}</div></div></div>
        ${data.description && data.description !== data.subject ? `<p class="routing-remarks text-muted mb-4">${escapeHtml(data.description)}</p>` : ''}
        <details class="journey-overview"><summary><span><i class="bx bx-buildings" aria-hidden="true"></i> Offices & custody details</span>
          <span class="journey-overview-location">${escapeHtml(data.pending_office_id ? `Awaiting receipt at ${data.pending_office_name || 'destination office'}` : data.current_office_name || 'Recorded office')} <i class="bx bx-chevron-down" aria-hidden="true"></i></span></summary>
          <div class="row g-3 journey-offices"><div class="col-md-4"><small class="text-muted d-block">Origin</small>${officeName(sourceName(data), data.source_division_id ? null : data.source_office_campus)}</div><div class="col-md-4"><small class="text-muted d-block">Current holding office</small>${officeName(data.current_office_name, data.current_office_campus)}</div><div class="col-md-4"><small class="text-muted d-block">${data.pending_office_id ? 'Awaiting receipt at' : 'Intended final office'}</small>${officeName(data.pending_office_name || data.recipient_office_name, data.pending_office_campus)}</div></div>
          ${custodySummary(data, timeline.currentStay, asOf)}</details>${journeyTimeline(data, timeline, asOf)}
        <section class="journey-document-tools" aria-label="Document file and actions"><h6>Document file & actions</h6>${documentFile(data)}
        ${buttons.length ? `<div class="routing-detail-actions mb-4"><div class="btn-group btn-group-sm" role="group" aria-label="Document actions">${buttons.join('')}</div></div>` : `<div class="alert alert-light border small mb-4">${data.pending_office_id ? 'Awaiting receipt by ' + escapeHtml(data.pending_office_name) + '. The destination office confirms receipt.' : ['acted', 'completed', 'delivered'].includes(data.status) ? 'This document is finished. Its full history is recorded in the journey above.' : 'Your office can follow this document through its timeline.'}</div>`}
        <div class="small text-muted mb-3">${documentDate(data)}${senderLabel(data) ? `<div>Sent by: ${escapeHtml(senderLabel(data))}</div>` : ''}</div>
        ${data.last_route_notes ? `<div class="border rounded p-3 mb-4"><strong>Latest routing notes · ${escapeHtml(senderLabel(data))}</strong><p class="routing-remarks mb-0 mt-2">${escapeHtml(data.last_route_notes)}</p></div>` : ''}${padReviewDetails(data)}${additionalDetails(data)}</section></div>`;
    } catch (error) {
      if (current === detailRequest) byId('document-detail').innerHTML = `<div class="card-body text-center text-danger py-5">${escapeHtml(error.message)}</div>`;
    }
  }

  function padReviewDetails(data) {
    if (data.pad_result_unrecorded) return '<div class="alert alert-info mt-3">No PAD decision has been recorded for this return. Check the timeline or send it to PAD for review.</div>';
    const reviews = (data.pad_reviews || []).filter((review) => decisionLabels[review.decision]);
    if (!reviews.length) return '';
    return `<div class="pad-review-history mt-3"><h6>PAD decisions</h6>${reviews.map((review, index) => `<div class="border rounded p-3 mb-2"><strong>Review ${index + 1}: ${decisionLabels[review.decision]}</strong><small class="d-block text-muted">Recorded by ${escapeHtml(review.decided_by_name || 'PAD staff')} &middot; ${escapeHtml(formatDate(review.decided_at))}</small>${review.decision_notes ? `<p class="routing-remarks mb-0 mt-2">${escapeHtml(review.decision_notes)}</p>` : ''}</div>`).join('')}</div>`;
  }

  async function openAction(action, reference) {
    const settings = actions[action];
    if (!settings || acting) return;
    try {
      const { data } = await api(`/api/documents/${encodeURIComponent(reference)}`);
      if (!data.permissions?.[action]) throw new Error('This action is no longer available for your office. Refresh the document.');
      if (action === 'act' && data.act_blockers?.length) throw new Error(data.act_blockers.join(' '));
      actionPending = { action, reference };
      byId('routing-action-form').reset();
      byId('routing-action-error').classList.add('d-none');
      byId('routing-action-reference').textContent = reference;
      byId('routing-action-title').textContent = settings.title;
      byId('routing-action-description').textContent = settings.description + (action === 'return' ? ` Destination: ${data.last_from_office_name}.` : action === 'decide' ? ` Returning to: ${data.pad_return_office_name}.` : '');
      if (action === 'receive' && data.is_owner_release) byId('routing-action-description').textContent = 'Confirm that the released hard copy has arrived at the owner office. This records delivery and moves the document to Delivered / completed. Records keeps its action in Acted.';
      byId('routing-decision-wrap').classList.toggle('d-none', action !== 'decide');
      byId('routing-decision').required = action === 'decide';
      byId('routing-decision').value = '';
      const sending = ['route', 'act'].includes(action);
      byId('routing-destination-wrap').classList.toggle('d-none', !sending);
      byId('routing-destination-label').textContent = action === 'act' ? 'Owner office *' : 'Receiving office *';
      byId('routing-destination-help').textContent = action === 'act'
        ? 'Select the office that owns the document. Delivery is recorded when that office confirms receipt.'
        : 'The receiving office confirms the hard-copy handoff.';
      byId('routing-act-receipt-wrap').classList.toggle('d-none', action !== 'act');
      byId('routing-act-received').disabled = action !== 'act';
      byId('routing-act-received').required = action === 'act';
      byId('routing-act-received').checked = false;
      const destination = byId('routing-destination');
      const jquery = window.jQuery;
      const destinationSelect = jquery?.(destination);
      if (destinationSelect?.hasClass('select2-hidden-accessible')) destinationSelect.select2('destroy');
      destination.required = sending;
      const sendingOffice = action === 'act' ? state.user?.office_id : data.current_office_id;
      destination.innerHTML = '<option value="">Choose an office</option>' + receivingOffices().filter((office) => Number(office.id) !== Number(sendingOffice)).map((office) => `<option value="${office.id}">${escapeHtml(office.name + (office.campus ? ` · ${office.campus}` : ''))}</option>`).join('');
      destination.value = '';
      if (action === 'act') {
        const owner = !data.source_division_id ? data.source_office_id : null;
        if (owner && Number(owner) !== Number(sendingOffice) && receivingOffices().some((office) => Number(office.id) === Number(owner))) destination.value = String(owner);
      }
      if (sending && jquery?.fn?.select2) {
        destinationSelect.select2({
          dropdownParent: jquery(byId('routing-action-modal')),
          width: '100%',
          placeholder: action === 'act' ? 'Search owner offices' : 'Search receiving offices',
          allowClear: true,
          minimumResultsForSearch: 0
        });
      }
      byId('routing-receipt-remark-wrap').classList.toggle('d-none', action !== 'receive');
      byId('routing-receipt-remark').disabled = action !== 'receive';
      byId('routing-receipt-remark').innerHTML = '<option value="">Select a remark (optional)</option>'
        + receiptRemarks.map((remark) => `<option value="${escapeHtml(remark)}">${escapeHtml(remark)}</option>`).join('')
        + '<option value="custom">Other / custom remark</option>';
      byId('routing-receipt-remark').value = '';
      byId('routing-notes').value = '';
      byId('routing-notes-wrap').classList.toggle('d-none', action === 'delete');
      byId('routing-notes').disabled = action === 'delete';
      byId('routing-notes').required = Boolean(settings.required);
      byId('routing-notes-label').textContent = action === 'deliver' ? 'Recipient and delivery details *' : action === 'return' ? 'Reason for return *' : settings.required ? 'Action taken *' : 'Remarks (optional)';
      if (action === 'receive') updateReceiptRemark();
      byId('routing-action-submit').textContent = settings.label;
      byId('routing-action-submit').classList.toggle('btn-danger', action === 'delete');
      byId('routing-action-submit').classList.toggle('btn-primary', action !== 'delete');
      actionModal.show();
    } catch (error) { showNotice(error.message); }
  }

  function updateReceiptRemark() {
    if (actionPending?.action !== 'receive') return;
    const custom = byId('routing-receipt-remark').value === 'custom';
    byId('routing-notes-wrap').classList.toggle('d-none', !custom);
    byId('routing-notes').disabled = !custom;
    byId('routing-notes').required = custom;
    byId('routing-notes-label').textContent = 'Custom remark *';
  }

  async function submitAction(event) {
    event.preventDefault();
    if (!actionPending || acting) return;
    acting = true;
    const { action, reference } = actionPending;
    const button = byId('routing-action-submit');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const payload = { notes: byId('routing-notes').value.trim() };
      if (action === 'receive') {
        const remark = byId('routing-receipt-remark').value;
        if (remark === 'custom') {
          if (!payload.notes) throw new Error('Enter a custom receipt remark.');
        } else {
          if (remark && !receiptRemarks.includes(remark)) throw new Error('Select a receipt remark from the list.');
          payload.notes = remark;
        }
      }
      if (action === 'route') payload.to_office_id = Number(byId('routing-destination').value);
      if (action === 'act') {
        if (!byId('routing-act-received').checked) throw new Error('Confirm that Records has received the hard copy from PAD.');
        payload.owner_office_id = Number(byId('routing-destination').value);
        if (!Number.isInteger(payload.owner_office_id) || payload.owner_office_id <= 0) throw new Error('Select the owner office.');
        if (!payload.notes) throw new Error('Record the action taken before sending to the owner.');
        payload.hard_copy_received = true;
      }
      if (action === 'decide') {
        payload.decision = byId('routing-decision').value;
        if (!decisionLabels[payload.decision]) throw new Error('Select the PAD decision.');
        if (payload.decision !== 'approved' && !payload.notes) throw new Error('Enter the reason or correction instructions.');
      }
      const response = action === 'delete'
        ? await api(`/api/documents/${encodeURIComponent(reference)}`, { method: 'DELETE' })
        : await api(`/api/documents/${encodeURIComponent(reference)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      actionModal.hide();
      actionPending = null;
      await refresh();
      if (action === 'act') { routing.detail = null; await showQueue('acted'); }
      else if (action === 'receive' && response.delivery_confirmed) { routing.detail = null; await showQueue('delivered'); }
      else if (action === 'delete') { routing.detail = null; await showQueue('my_documents'); }
      else if (!byId('section-track').classList.contains('d-none')) await openDocument(reference);
      showNotice(response.message, 'success');
    } catch (error) {
      byId('routing-action-error').textContent = error.message;
      byId('routing-action-error').classList.remove('d-none');
    } finally { acting = false; button.disabled = false; button.textContent = actions[action].label; }
  }

  function documentSource() {
    const selected = byId('origin-type').value;
    const source = registrationOptions.source_divisions.find((item) => `division:${item.id}` === selected);
    byId('document-origin-value').value = source && routing.workspace.can_register_external ? 'external' : 'office';
    byId('document-source-division').value = source ? String(source.id) : '';
  }

  function sourceOptions() {
    const selected = byId('origin-type').value;
    const sources = registrationOptions.source_divisions;
    const options = sources.map((source) => `<option value="division:${escapeHtml(source.id)}">${escapeHtml(source.name)}</option>`).join('');
    byId('origin-type').innerHTML = '<option value="">Select document source</option>'
      + '<option value="my_office">My Office</option>'
      + (options || '<option value="" disabled>No other offices / agencies available</option>');
    byId('origin-type').value = selected || '';
    documentSource();
  }

  function initializeSource() {
    const jquery = window.jQuery;
    if (!jquery?.fn?.select2) return;
    const select = jquery(byId('origin-type'));
    if (!select.hasClass('select2-hidden-accessible')) {
      select.select2({ dropdownParent: jquery(byId('upload-modal')), width: '100%',
        placeholder: 'Select document source' });
      select.on('change', documentSource);
    }
    select.trigger('change');
  }

  function documentType() {
    const type = registrationOptions.document_types.find((item) => String(item.id) === byId('document-type').value);
    const travel = type?.details_kind === 'travel_order';
    byId('travel-order-section').classList.toggle('d-none', !travel);
    byId('travel-order-fields').disabled = !travel;
    byId('document-personnel-field').classList.toggle('d-none', !type);
    byId('document-personnel').disabled = !type;
    byId('document-personnel').setAttribute('aria-required', travel ? 'true' : 'false');
    window.jQuery?.(byId('document-personnel')).trigger('change.select2');
    byId('document-personnel-label').textContent = travel ? 'Travelers / faculty / personnel *' : 'Faculty / personnel involved (optional)';
    byId('document-personnel-help').textContent = travel ? 'Select at least one person traveling under this order.' : 'Link the people involved in this document, if applicable.';
  }

  function initializePersonnel() {
    const jquery = window.jQuery;
    if (!jquery?.fn?.select2) return;
    const select = jquery(byId('document-personnel'));
    if (!select.hasClass('select2-hidden-accessible')) {
      select.select2({ dropdownParent: jquery(byId('upload-modal')), width: '100%', closeOnSelect: false,
        placeholder: 'Search and select faculty / personnel', maximumSelectionLength: 100 });
      select.on('change', personnelSelection);
    }
    select.trigger('change');
  }

  function personnelSelection() {
    const count = byId('document-personnel').selectedOptions?.length || 0;
    byId('personnel-selection-count').textContent = count ? `${count} ${count === 1 ? 'name' : 'names'} selected.` : 'No names selected.';
  }

  async function openUpload() {
    if (saving) return;
    if (state.activeRole === 'university_president' || String(state.user?.office_code || '').toUpperCase() === 'OP') {
      showNotice('The Office of the University President is monitoring only. Document registration is unavailable.', 'warning');
      return;
    }
    if (!state.user?.office_id && state.activeRole !== 'admin') { showNotice('Ask your administrator to assign your account to an office before registering documents.', 'warning'); return; }
    const current = ++registrationRequest;
    byId('upload-form').reset();
    byId('upload-error').classList.add('d-none');
    submissionKey = window.crypto?.randomUUID ? window.crypto.randomUUID() : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    registrationOptions = { document_types: [], personnel: [], source_divisions: [] };
    byId('origin-type').innerHTML = '<option value="">Loading document sources…</option>';
    byId('origin-type').disabled = true;
    window.jQuery?.(byId('origin-type')).trigger('change.select2');
    documentSource();
    byId('document-type').innerHTML = '<option value="">Loading document types…</option>';
    byId('document-type').disabled = true;
    byId('upload-submit').disabled = true;
    byId('document-personnel').innerHTML = '';
    window.jQuery?.(byId('document-personnel')).trigger('change');
    documentType();
    personnelSelection();
    byId('travel-order-date').value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date());
    byId('travel-return-date').min = '';
    uploadModal.show();
    try {
      const options = await api('/api/routing/registration-options');
      if (current !== registrationRequest || !state.user) return;
      if (!options.document_types?.length) throw new Error('No document types are available. Ask your administrator to set up the document type list.');
      registrationOptions = { document_types: options.document_types, personnel: options.personnel || [], source_divisions: options.source_divisions || [] };
      byId('origin-type').disabled = false;
      byId('origin-type').value = '';
      sourceOptions();
      initializeSource();
      byId('document-type').innerHTML = '<option value="">Select a document type</option>' + options.document_types.map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.name)}</option>`).join('');
      byId('document-type').disabled = false;
      byId('upload-submit').disabled = false;
      byId('document-personnel').innerHTML = registrationOptions.personnel.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('');
      initializePersonnel();
      documentType();
    } catch (error) {
      if (current !== registrationRequest || !state.user) return;
      byId('upload-error').textContent = error.message;
      byId('upload-error').classList.remove('d-none');
    }
  }

  async function uploadDocument(event) {
    event.preventDefault();
    if (saving || byId('upload-submit').disabled) return;
    saving = true;
    const button = byId('upload-submit');
    button.disabled = true;
    button.textContent = 'Registering…';
    byId('upload-error').classList.add('d-none');
    try {
      const form = new FormData(event.currentTarget);
      const type = registrationOptions.document_types.find((item) => String(item.id) === form.get('document_type_id'));
      if (!type) throw new Error('Select a type of document from the list.');
      const selectedSource = form.get('document_source');
      const source = registrationOptions.source_divisions.find((item) => `division:${item.id}` === selectedSource);
      if (selectedSource === 'my_office') {
        form.set('origin_type', 'office');
        form.set('source_division_id', '');
      } else {
        if (!source) throw new Error('Select a document source from the list.');
        form.set('origin_type', routing.workspace.can_register_external ? 'external' : 'office');
        form.set('source_division_id', String(source.id));
      }
      form.delete('document_source');
      if (type.details_kind === 'travel_order' && !form.getAll('personnel_ids[]').length) throw new Error('Select at least one faculty / personnel for the travel order.');
      form.set('submission_key', submissionKey);
      const response = await api('/api/documents', { method: 'POST', body: form });
      uploadModal.hide();
      await refresh();
      await refreshAdmin();
      await showQueue(form.get('origin_type') === 'office' ? 'my_documents' : 'received');
      showNotice(`Document registered as ${response.reference_no}.`, 'success');
    } catch (error) {
      byId('upload-error').textContent = error.message;
      byId('upload-error').classList.remove('d-none');
    } finally { saving = false; button.disabled = false; button.innerHTML = '<i class="bx bx-save me-1"></i> Register document'; }
  }

  function reset() {
    request++; detailRequest++; registrationRequest++; clearTimeout(searchTimer);
    resetStatistics?.();
    byId('overview-search').value = '';
    byId('overview-documents').innerHTML = '<div class="text-center text-muted py-5">Loading received documents…</div>';
    byId('overview-document-count').textContent = ''; byId('overview-office').textContent = '';
    registrationOptions = { document_types: [], personnel: [], source_divisions: [] };
    routing.queue = 'all'; routing.page = 1; routing.scope = ''; routing.detail = null; routing.workspace = {}; routing.counts = {};
    actionPending = null; submissionKey = null; actionModal.hide();
  }

  function handleClick(event) {
    const attentionPage = event.target.closest('[data-attention-page]');
    if (attentionPage && !attentionPage.disabled) { routing.page += Number(attentionPage.dataset.attentionPage); refresh(); return; }
    const ownQueue = event.target.closest('[data-own-scope]');
    if (ownQueue) { event.preventDefault(); routing.scope = ''; showQueue(ownQueue.dataset.openQueue); return; }
    const journeyPosition = event.target.closest('[data-journey-position]');
    if (journeyPosition) {
      const scroll = byId('journey-scroll');
      scroll.scrollTo({ left: journeyPosition.dataset.journeyPosition === 'latest' ? 0 : scroll.scrollWidth, behavior: 'smooth' });
      return;
    }
    const sidebar = event.target.closest('[data-routing-queue]');
    const shortcut = event.target.closest('[data-open-queue]');
    if (sidebar || shortcut) { event.preventDefault(); showQueue(sidebar ? sidebar.dataset.routingQueue : shortcut.dataset.openQueue); }
    const action = event.target.closest('[data-routing-action]');
    if (action) openAction(action.dataset.routingAction, action.dataset.reference);
    const page = event.target.closest('[data-routing-page]');
    if (page && !page.disabled) { routing.page += Number(page.dataset.routingPage); refresh(); }
    if (event.target.closest('[data-back-to-queue]')) {
      if (routing.queue === 'attention') { changeSection('dashboard'); overview(); }
      else showQueue(routing.queue);
    }
  }

  function bind() {
    byId('overview-search').addEventListener('input', search);
    byId('routing-receipt-remark').addEventListener('change', updateReceiptRemark);
    byId('routing-decision').addEventListener('change', () => {
      const required = ['disapproved', 'returned_for_correction'].includes(byId('routing-decision').value);
      byId('routing-notes').required = required;
      byId('routing-notes-label').textContent = required ? 'Reason / correction instructions *' : 'Remarks (optional)';
    });
    byId('routing-action-form').addEventListener('submit', submitAction);
    byId('document-detail').addEventListener('submit', uploadAttachment);
    byId('routing-office-filter').addEventListener('change', (event) => { routing.scope = event.target.value; clearFilters(); refresh(); });
    byId('document-type').addEventListener('change', documentType);
    byId('document-personnel').addEventListener('change', personnelSelection);
    byId('travel-departure-date').addEventListener('change', () => { byId('travel-return-date').min = byId('travel-departure-date').value; });
  }

  function search() { clearTimeout(searchTimer); routing.page = 1; searchTimer = setTimeout(refresh, 250); }

  return { refresh, render, row, openDocument, openUpload, uploadDocument, reset, handleClick, bind, search, documentSource, overview, showQueue, updateNavigation,
    currentQueue: () => routing.queue, setQueue: (queue) => { if (availableQueues().some(([key]) => key === queue)) routing.queue = queue; } };
}
