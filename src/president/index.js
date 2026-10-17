// A separate, read-only workspace. All figures come from the monitoring API.
export function createPresidentView({ state, api, byId, escapeHtml: esc, formatDate, downloadDocument, signOut, switchRole }) {
  let generation = 0;
  let reportRequest = 0;
  let documentRequest = 0;
  let detailRequest = 0;
  let report = null;
  let tab = 'overview';
  let page = 1;
  let mounted = false;
  let searchTimer;
  const active = () => state.activeRole === 'university_president' && Boolean(state.token);
  const number = (value) => new Intl.NumberFormat('en-PH').format(Number(value) || 0);
  const statusTitles = { created: 'Registered', in_transit: 'Awaiting receipt', received: 'Receipt confirmed', acted: 'Acted', delivered: 'Delivered', completed: 'Completed' };
  const eventTitles = { created: 'Registered', externally_received: 'External document received', received: 'Receipt confirmed', routed: 'Sent to next office', returned: 'Returned', acted: 'Acted and released', completed: 'Completed', delivered: 'Delivered', file_uploaded: 'File attached', approved: 'Approved', disapproved: 'Disapproved', returned_for_correction: 'Returned for correction' };
  const empty = (message) => `<div class="pres-empty"><i class="bx bx-folder-open" aria-hidden="true"></i><p>${esc(message)}</p></div>`;
  const loading = (message) => `<div class="pres-loading" role="status"><span class="pres-loading-dot"></span>${esc(message)}</div>`;
  const status = (value) => `<span class="pres-status pres-status--${esc(value)}">${esc(statusTitles[value] || value)}</span>`;
  const officeName = (d) => d.pending_office_name || d.current_office_name || 'Office not recorded';

  function mount() {
    if (mounted) return;
    byId('president-view').innerHTML = `
      <a class="pres-skip" href="#president-panel-title">Skip to monitoring content</a>
      <aside class="pres-sidebar" aria-label="Presidential workspace">
        <div class="pres-brand"><span class="pres-brand-mark" aria-hidden="true"><i class="bx bxs-institution"></i></span><span><strong>SKSU</strong><small>Presidential Action Desk</small></span></div>
        <div class="pres-sidebar-label">UNIVERSITY PRESIDENT</div>
        <nav class="pres-nav" aria-label="Presidential monitoring">
          <button type="button" data-president-tab="overview"><i class="bx bx-grid-alt" aria-hidden="true"></i><span>Overview</span></button>
          <button type="button" data-president-tab="offices"><i class="bx bx-buildings" aria-hidden="true"></i><span>Office workload</span></button>
          <button type="button" data-president-tab="documents"><i class="bx bx-file-find" aria-hidden="true"></i><span>Document monitor</span></button>
        </nav>
        <div class="pres-sidebar-note"><span class="pres-aura-dot"></span><strong>Visibility across the university</strong><p>Follow documents, office workload, and recorded actions in one view.</p><span class="pres-readonly"><i class="bx bx-show" aria-hidden="true"></i> Monitoring only</span></div>
        <div class="pres-sidebar-bottom">SULTAN KUDARAT<br>STATE UNIVERSITY</div>
      </aside>
      <div class="pres-main">
        <header class="pres-topbar"><div><span class="pres-eyebrow">PRESIDENTIAL VIEW</span><p>Office of the University President</p></div><div class="pres-account"><div class="pres-account-copy"><strong id="president-user-name"></strong><small>University President</small></div><button id="president-switch-role" class="pres-icon-button d-none" type="button" aria-label="Switch account role" title="Switch account role"><i class="bx bx-transfer-alt" aria-hidden="true"></i></button><button id="president-signout" class="pres-icon-button" type="button" aria-label="Sign out" title="Sign out"><i class="bx bx-log-out" aria-hidden="true"></i></button></div></header>
        <div class="pres-content">
          <div id="president-page-heading" class="pres-page-heading"><div id="president-page-copy"><span class="pres-eyebrow" id="president-panel-kicker">UNIVERSITY AT A GLANCE</span><h1 id="president-panel-title" tabindex="-1">Executive overview</h1><p id="president-panel-description">A clear view of document flow across every office.</p></div><button id="president-refresh" class="pres-button pres-button--secondary" type="button"><i class="bx bx-refresh" aria-hidden="true"></i> Refresh</button></div>
          <button id="president-filter-toggle" class="pres-filter-toggle" type="button" aria-expanded="false" aria-controls="president-report-controls"><span><strong>Reporting period</strong><small id="president-period-preview">This year</small></span><i class="bx bx-slider-alt" aria-hidden="true"></i></button>
          <div id="president-report-controls" class="pres-filter-card"><form id="president-report-form" class="pres-report-form"><label>From<input id="president-start" type="date" required></label><label>To<input id="president-end" type="date" required></label><label class="pres-type-filter">Document type<select id="president-type"><option value="">All document types</option></select></label><button id="president-apply" class="pres-button" type="submit">Apply period <i class="bx bx-right-arrow-alt" aria-hidden="true"></i></button><button id="president-year" class="pres-text-button" type="button">This year</button></form><div class="pres-report-meta"><span>Period activity uses the selected dates. Current workload includes older records.</span><span id="president-updated"></span></div></div>
          <div id="president-notice" class="pres-error d-none" role="alert"></div>
          <div id="president-report-error" class="pres-error d-none" role="alert"></div>
          <div id="president-report-loading" class="d-none"></div>
          <section id="president-overview" aria-labelledby="president-panel-title"><div id="president-overview-content"></div></section>
          <section id="president-offices" class="d-none" aria-labelledby="president-panel-title"><div class="pres-office-tools"><label class="pres-search-label"><i class="bx bx-search" aria-hidden="true"></i><input id="president-office-search" type="search" placeholder="Find an office or campus" aria-label="Find an office or campus" maxlength="255"></label><span id="president-office-count"></span></div><div id="president-office-list" class="pres-office-grid" aria-live="polite"></div></section>
          <section id="president-documents" class="d-none" aria-labelledby="president-panel-title">
            <div id="president-document-list-panel"><div class="pres-filter-card"><form id="president-document-form" class="pres-document-form"><label class="pres-search-label"><i class="bx bx-search" aria-hidden="true"></i><input id="president-document-search" type="search" placeholder="Find a document, file code, or office" aria-label="Search documents" maxlength="255"></label><label>Status<select id="president-status"><option value="">All statuses</option>${Object.entries(statusTitles).map(([value, title]) => `<option value="${value}">${title}</option>`).join('')}</select></label><label>Office participation<select id="president-office"><option value="all">All offices</option></select></label><button class="pres-button" type="submit">Search</button></form><p class="pres-filter-note">All registration dates. Office participation includes previous handoffs. Acted includes documents with a recorded Act, even after delivery.</p></div><div id="president-document-error" class="pres-error d-none" role="alert"></div><div id="president-document-list" class="pres-card pres-documents-list" aria-live="polite"></div><div class="pres-pagination"><span id="president-document-count"></span><div><button id="president-prev" class="pres-button pres-button--secondary" type="button" disabled>Previous</button><button id="president-next" class="pres-button pres-button--secondary" type="button" disabled>Next</button></div></div></div>
            <div id="president-detail-panel" class="d-none"><button id="president-back" class="pres-text-button pres-back" type="button"><i class="bx bx-left-arrow-alt" aria-hidden="true"></i> Back to document monitor</button><div id="president-detail" aria-live="polite"></div></div>
          </section>
          <footer class="pres-footer"><span>PAD <span aria-hidden="true">/</span> Presidential Action Desk</span><span><i class="bx bx-show" aria-hidden="true"></i> Monitoring only <span aria-hidden="true">·</span> Manila time</span></footer>
        </div>
      </div>`;
    byId('president-view').addEventListener('click', handleClick);
    byId('president-report-form').addEventListener('submit', (event) => { event.preventDefault(); loadReport(); });
    byId('president-document-form').addEventListener('submit', (event) => { event.preventDefault(); page = 1; loadDocuments(); });
    byId('president-office-search').addEventListener('input', renderOffices);
    byId('president-document-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; loadDocuments(); }, 300); });
    ['president-status', 'president-office'].forEach((id) => byId(id).addEventListener('change', () => { page = 1; loadDocuments(); }));
    mounted = true;
  }

  function renderReport(data) {
    const { period: p } = data;
    const metric = (icon, value, label, note, accent = '') => `<article class="pres-metric ${accent}"><span class="pres-metric-icon"><i class="bx ${icon}" aria-hidden="true"></i></span><small>${esc(label)}</small><strong>${number(value)}</strong><p>${esc(note)}</p></article>`;
    const actedTypes = data.acted_type_breakdown;
    const actedSummary = actedTypes.filter((type) => Number(type.documents) > 0);
    const processing = data.processing_time.registration_to_act;
    const average = processing.seconds === null ? '—' : `${number(Math.round(processing.seconds / 8640) / 10)} days`;
    const rows = data.office_workload.slice(0, 4);
    byId('president-overview-content').innerHTML = `
      <div class="pres-metrics" role="region" aria-label="Acted documents by document type">${actedTypes.length ? actedTypes.map((type, index) => metric('bx-check-circle', type.documents, type.name, 'Acted documents · selected period', index === 0 ? 'pres-metric--orange' : '')).join('') : empty('No document types available.')}</div>
      <div class="pres-overview-grid"><section class="pres-card"><div class="pres-card-heading"><div><span class="pres-eyebrow">MOMENTUM</span><h2>Document flow</h2></div><span class="pres-muted">${esc(data.filters.start_date)} — ${esc(data.filters.end_date)}</span></div><div class="pres-flow">${[['registered', 'Registered'], ['received', 'Received'], ['acted', 'Acted'], ['delivered', 'Delivered']].map(([key, label]) => `<div><span>${esc(label)}</span><strong>${number(p[key])}</strong></div>`).join('')}</div><p class="pres-card-note">Unique documents per activity. A document can appear in more than one activity.</p></section>
      <section class="pres-card"><div class="pres-card-heading"><div><span class="pres-eyebrow">ACTED DOCUMENTS</span><h2>Acted by document type</h2></div></div><div class="pres-type-list">${actedSummary.length ? actedSummary.map((t) => `<div class="pres-type-row"><div><strong>${esc(t.name)}</strong><span>${number(t.documents)}</span></div></div>`).join('') : empty('No documents acted in this period.')}</div><p class="pres-card-note">Unique documents with a recorded Act in the selected period. Later delivery keeps the Act count.</p><div class="pres-processing"><i class="bx bx-timer" aria-hidden="true"></i><div><small>Average registration to first Act</small><strong>${average}</strong><span>${processing.samples ? `${number(processing.samples)} recorded samples · registration cohort` : 'No completed samples in this registration period'}</span></div></div></section></div>
      <div class="pres-overview-grid"><section class="pres-card"><div class="pres-card-heading"><div><span class="pres-eyebrow">OFFICE PULSE</span><h2>Workload across offices</h2></div><button class="pres-text-button" type="button" data-president-tab="offices">View all <i class="bx bx-right-arrow-alt" aria-hidden="true"></i></button></div><div class="pres-pulse-list">${rows.length ? rows.map((o) => `<button class="pres-pulse-row" type="button" data-president-office="${Number(o.id)}"><span class="pres-office-icon"><i class="bx bx-buildings" aria-hidden="true"></i></span><span><strong>${esc(o.name)}</strong><small>${esc(o.campus || 'Campus not recorded')}</small></span><span class="pres-pulse-value">${number(o.pending_action + o.awaiting_receipt)}<small>pending</small></span><i class="bx bx-chevron-right" aria-hidden="true"></i></button>`).join('') : empty('No office workload or activity to show.')}</div></section>
      <section class="pres-card"><div class="pres-card-heading"><div><span class="pres-eyebrow">ATTENTION INDICATORS</span><h2>Oldest pending documents</h2></div><span class="pres-muted">Current stage</span></div><div class="pres-attention-list">${data.oldest_pending.length ? data.oldest_pending.slice(0, 4).map((d) => `<button class="pres-attention-row" type="button" data-president-document="${esc(d.reference_no)}"><span class="pres-age">${number(d.days)}<small>days</small></span><span><strong>${esc(d.subject)}</strong><small>${esc(d.reference_no)} · ${esc(d.office_name || d.queue)}</small></span><i class="bx bx-chevron-right" aria-hidden="true"></i></button>`).join('') : empty('No pending documents to show.')}</div><p class="pres-card-note">Age is an attention indicator; no deadline or overdue policy is applied.</p></section></div>`;
    renderOffices();
  }

  function renderOffices() {
    if (!report) return;
    const search = byId('president-office-search').value.toLowerCase().trim();
    const rows = report.office_workload.filter((o) => `${o.name} ${o.campus || ''}`.toLowerCase().includes(search));
    byId('president-office-count').textContent = `${number(rows.length)} offices with workload or period activity`;
    byId('president-office-list').innerHTML = rows.length ? rows.map((o) => `<article class="pres-card pres-office-card"><div class="pres-office-card-top"><span class="pres-office-icon"><i class="bx bx-buildings" aria-hidden="true"></i></span><span class="pres-campus">${esc(o.campus || 'Campus not recorded')}</span></div><h2>${esc(o.name)}</h2><div class="pres-office-numbers"><div><strong>${number(o.pending_action)}</strong><span>Awaiting action</span></div><div><strong>${number(o.awaiting_receipt)}</strong><span>Awaiting receipt</span></div><div><strong>${number(o.oldest_days)}<small> d</small></strong><span>Oldest pending</span></div></div><div class="pres-office-activity"><span>Selected period</span><strong>${number(o.period_acted)} acted <span>·</span> ${number(o.period_handoffs)} dispatches</strong></div><button type="button" class="pres-text-button" data-president-office="${Number(o.id)}">View office timeline <i class="bx bx-right-arrow-alt" aria-hidden="true"></i></button></article>`).join('') : empty('No offices match this search.');
  }

  async function loadReport(resetDates = false) {
    if (!active()) return;
    const current = ++reportRequest;
    const session = generation;
    byId('president-report-error').classList.add('d-none');
    byId('president-report-error').textContent = '';
    byId('president-overview-content').classList.add('d-none');
    byId('president-office-list').classList.add('d-none');
    byId('president-office-count').textContent = '';
    byId('president-updated').textContent = '';
    byId('president-report-loading').innerHTML = loading('Updating university monitoring…');
    byId('president-report-loading').classList.remove('d-none');
    byId('president-apply').disabled = true;
    byId('president-report-controls').setAttribute('aria-busy', 'true');
    const params = new URLSearchParams();
    if (!resetDates) ['start_date', 'end_date', 'document_type'].forEach((key, index) => { const value = byId(['president-start', 'president-end', 'president-type'][index]).value; if (value) params.set(key, value); });
    try {
      const data = await api('/api/president/statistics?' + params);
      if (!active() || current !== reportRequest || session !== generation) return;
      report = data;
      byId('president-start').value = data.filters.start_date;
      byId('president-end').value = data.filters.end_date;
      const periodDate = (value) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
      byId('president-period-preview').textContent = periodDate(data.filters.start_date) + ' – ' + periodDate(data.filters.end_date) + (data.filters.document_type ? ' · ' + data.filters.document_type : '');
      byId('president-type').innerHTML = '<option value="">All document types</option>' + data.document_types.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
      byId('president-type').value = data.filters.document_type;
      byId('president-updated').textContent = 'Updated ' + formatDate(data.server_time);
      byId('president-updated').classList.remove('d-none');
      renderReport(data);
      byId('president-overview-content').classList.remove('d-none');
      byId('president-office-list').classList.remove('d-none');
    } catch (error) {
      if (!active() || current !== reportRequest || session !== generation) return;
      report = null;
      byId('president-report-error').textContent = error.message;
      byId('president-report-error').classList.toggle('d-none', tab === 'documents');
    } finally {
      if (current === reportRequest && session === generation && active()) {
        byId('president-report-loading').classList.add('d-none');
        byId('president-apply').disabled = false;
        byId('president-report-controls').setAttribute('aria-busy', 'false');
      }
    }
  }

  async function loadDocuments() {
    if (!active()) return;
    const current = ++documentRequest;
    const session = generation;
    detailRequest++;
    byId('president-document-list-panel').classList.remove('d-none');
    byId('president-detail-panel').classList.add('d-none');
    byId('president-document-error').classList.add('d-none');
    byId('president-document-error').textContent = '';
    byId('president-document-list').innerHTML = loading('Loading document monitor…');
    byId('president-document-list').setAttribute('aria-busy', 'true');
    byId('president-document-count').textContent = '';
    byId('president-prev').disabled = true;
    byId('president-next').disabled = true;
    const params = new URLSearchParams({ page: String(page), search: byId('president-document-search').value.trim(), status: byId('president-status').value, office_id: byId('president-office').value || 'all' });
    try {
      const data = await api('/api/president/documents?' + params);
      if (!active() || current !== documentRequest || session !== generation) return;
      const rows = data.data;
      byId('president-document-list').innerHTML = rows.length ? `<div class="pres-table-scroll"><table class="pres-document-table"><caption class="visually-hidden">Monitored documents</caption><thead><tr><th scope="col">Document</th><th scope="col">Current stage</th><th scope="col">Location / destination</th><th scope="col">Last updated</th><th scope="col"><span class="visually-hidden">View document</span></th></tr></thead><tbody>${rows.map((d) => `<tr><td><button class="pres-document-title" type="button" data-president-document="${esc(d.reference_no)}">${esc(d.subject)}</button><small>${esc(d.reference_no)} · ${esc(d.document_type)}</small></td><td>${status(d.status)}</td><td><strong>${esc(officeName(d))}</strong><small>${d.pending_office_id ? 'Awaiting receipt at destination' : 'Current recorded office'}</small></td><td>${esc(formatDate(d.updated_at))}</td><td><button class="pres-icon-button" type="button" data-president-document="${esc(d.reference_no)}" aria-label="View ${esc(d.reference_no)}"><i class="bx bx-right-arrow-alt" aria-hidden="true"></i></button></td></tr>`).join('')}</tbody></table></div><div class="pres-mobile-documents">${rows.map((d) => `<article><div class="pres-mobile-document-top"><small>${esc(d.reference_no)}</small>${status(d.status)}</div><button class="pres-document-title" type="button" data-president-document="${esc(d.reference_no)}">${esc(d.subject)}</button><p>${esc(d.document_type)}</p><div class="pres-mobile-location"><i class="bx bx-buildings" aria-hidden="true"></i><span>${esc(officeName(d))}</span></div><div class="pres-mobile-document-bottom"><small>${esc(formatDate(d.updated_at))}</small><button class="pres-text-button" type="button" data-president-document="${esc(d.reference_no)}">View <i class="bx bx-right-arrow-alt" aria-hidden="true"></i><span class="visually-hidden"> ${esc(d.reference_no)}</span></button></div></article>`).join('')}</div>` : empty('No documents match these filters.');
      page = data.pagination.page;
      byId('president-document-count').textContent = `${number(data.pagination.total)} documents · Page ${number(page)} of ${number(data.pagination.pages)}`;
      byId('president-prev').disabled = page <= 1;
      byId('president-next').disabled = page >= data.pagination.pages;
    } catch (error) {
      if (!active() || current !== documentRequest || session !== generation) return;
      byId('president-document-list').innerHTML = '';
      byId('president-document-error').textContent = error.message;
      byId('president-document-error').classList.remove('d-none');
    } finally {
      if (current === documentRequest && session === generation && active()) byId('president-document-list').setAttribute('aria-busy', 'false');
    }
  }

  async function openDocument(reference) {
    if (!active()) return;
    clearTimeout(searchTimer);
    navigate('documents', false);
    documentRequest++;
    const current = ++detailRequest;
    const session = generation;
    byId('president-document-list-panel').classList.add('d-none');
    byId('president-detail-panel').classList.remove('d-none');
    byId('president-detail').innerHTML = loading('Loading document journey…');
    window.history.replaceState(null, '', '#president/document/' + encodeURIComponent(reference));
    try {
      const { data: d } = await api('/api/president/documents/' + encodeURIComponent(reference));
      if (!active() || current !== detailRequest || session !== generation || tab !== 'documents') return;
      const history = [...(d.history || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id) - Number(a.id));
      const field = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`;
      byId('president-detail').innerHTML = `<article class="pres-card pres-document-detail"><div class="pres-detail-top"><span class="pres-eyebrow">${esc(d.reference_no)}</span>${status(d.status)}</div><h2 tabindex="-1" id="president-document-heading">${esc(d.subject)}</h2><p class="pres-detail-description">${esc(d.description || 'No additional description recorded.')}</p><dl class="pres-detail-fields">${field('Document type', d.document_type)}${field('Source', d.external_sender || d.source_office_name)}${field('Current recorded office', d.current_office_name)}${field('Awaiting receipt at', d.pending_office_name)}${field('Registered', formatDate(d.created_at))}${field('Last updated', formatDate(d.updated_at))}${field('PAD decision', d.pad_decision ? eventTitles[d.pad_decision] || d.pad_decision : 'No decision recorded')}</dl>${d.pad_decision_notes ? `<div class="pres-record-note"><strong>Recorded PAD decision notes</strong><p>${esc(d.pad_decision_notes)}</p></div>` : ''}${d.travel_details ? `<details class="pres-record-extra"><summary>Travel order details</summary><dl class="pres-detail-fields">${Object.entries(d.travel_details).map(([key, value]) => field(key.replace(/_/g, ' '), value)).join('')}</dl></details>` : ''}${d.personnel?.length ? `<p class="pres-card-note"><strong>Personnel:</strong> ${d.personnel.map((person) => esc(person.name)).join(', ')}</p>` : ''}<div class="pres-attachment"><span><i class="bx bx-paperclip" aria-hidden="true"></i> ${esc(d.file_name || 'No file attached')}</span>${d.file_name ? `<button class="pres-button pres-button--secondary" type="button" data-president-download="${esc(d.reference_no)}" data-file-name="${esc(d.file_name)}"><i class="bx bx-download" aria-hidden="true"></i> Download file</button>` : ''}</div></article><section class="pres-card pres-journey"><div class="pres-card-heading"><div><span class="pres-eyebrow">CHAIN OF CUSTODY</span><h2>Document journey</h2></div><span class="pres-muted">Latest activity first · Manila time</span></div>${history.length ? `<ol class="pres-journey-list">${history.map((h, index) => `<li><span class="pres-journey-node${index === 0 ? ' pres-journey-node--latest' : ''}"><i class="bx ${index === 0 ? 'bx-radio-circle-marked' : 'bx-check'}" aria-hidden="true"></i></span><div><div class="pres-event-heading"><strong>${esc(eventTitles[h.action] || h.action.replace(/_/g, ' '))}</strong><span>${esc(formatDate(h.created_at))}</span></div><p>${esc(h.origin_office_name || 'Registration')}${h.destination_office_name ? ` <i class="bx bx-right-arrow-alt" aria-hidden="true"></i> ${esc(h.destination_office_name)}` : ''}</p>${h.acted_by_name ? `<small>Recorded by ${esc(h.acted_by_name)}</small>` : ''}${h.notes ? `<div class="pres-event-note">${esc(h.notes)}</div>` : ''}</div></li>`).join('')}</ol>` : empty('No recorded journey events.')}</section>`;
      byId('president-document-heading')?.focus();
    } catch (error) {
      if (!active() || current !== detailRequest || session !== generation || tab !== 'documents') return;
      byId('president-detail').innerHTML = `<div class="pres-error" role="alert">${esc(error.message)}</div>`;
    }
  }

  function navigate(next, load = true) {
    if (!active() || !['overview', 'offices', 'documents'].includes(next)) return;
    tab = next;
    byId('president-page-heading').classList.toggle('pres-page-heading--overview', tab === 'overview');
    byId('president-page-copy').classList.toggle('visually-hidden', tab === 'overview');
    byId('president-refresh').classList.toggle('d-none', tab === 'overview');
    detailRequest++;
    clearTimeout(searchTimer);
    ['overview', 'offices', 'documents'].forEach((name) => byId('president-' + name).classList.toggle('d-none', name !== tab));
    byId('president-view').querySelectorAll('[data-president-tab]').forEach((button) => {
      const selected = button.dataset.presidentTab === tab;
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    const titles = { overview: ['UNIVERSITY AT A GLANCE', 'Executive overview', 'A clear view of document flow across every office.'], offices: ['ACROSS THE UNIVERSITY', 'Office workload', 'Current pending work and recorded activity by performing office.'], documents: ['UNIVERSITY DOCUMENT REGISTRY', 'Document monitor', 'Follow any document from registration through its recorded journey.'] };
    ['president-panel-kicker', 'president-panel-title', 'president-panel-description'].forEach((id, index) => { byId(id).textContent = titles[tab][index]; });
    byId('president-report-controls').classList.toggle('d-none', tab !== 'offices');
    ['president-report-error', 'president-report-loading'].forEach((id) => byId(id).classList.toggle('d-none', tab === 'documents' || (id === 'president-report-error' && !byId(id).textContent) || (id === 'president-report-loading' && !byId('president-apply').disabled)));
    byId('president-filter-toggle').classList.toggle('d-none', tab !== 'offices');
    window.history.replaceState(null, '', '#president' + (tab === 'overview' ? '' : '/' + tab));
    if (load) {
      byId('president-panel-title').focus();
      if (tab === 'documents') loadDocuments(); else if (!report) loadReport();
    }
  }

  async function enter(hash = '') {
    if (!active()) return;
    mount();
    byId('president-user-name').textContent = state.user.name;
    byId('president-switch-role').classList.toggle('d-none', (state.user.roles || []).length < 2);
    byId('president-view').classList.remove('d-none');
    const session = generation;
    const target = hash.split('/')[1];
    navigate(['offices', 'documents', 'document'].includes(target) ? target === 'document' ? 'documents' : target : 'overview', false);
    const officeLoad = api('/api/president/offices').then((data) => {
      if (!active() || session !== generation) return;
      const selected = byId('president-office').value || 'all';
      byId('president-office').innerHTML = '<option value="all">All offices</option>' + data.data.map((o) => `<option value="${Number(o.id)}">${esc(o.name)}${o.campus ? ' · ' + esc(o.campus) : ''}${Number(o.is_active) === 0 ? ' (inactive)' : ''}</option>`).join('');
      byId('president-office').value = selected;
    }).catch((error) => {
      if (!active() || session !== generation) return;
      byId('president-document-error').textContent = 'Office filter could not load. ' + error.message;
      byId('president-document-error').classList.remove('d-none');
    });
    await Promise.all([officeLoad, tab === 'documents' ? target === 'document' && hash.split('/')[2] ? openDocument(decodeURIComponent(hash.split('/')[2])) : loadDocuments() : loadReport()]);
  }

  function handleClick(event) {
    if (!active()) return;
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.presidentTab) { navigate(button.dataset.presidentTab); return; }
    if (button.dataset.presidentDocument) { openDocument(button.dataset.presidentDocument); return; }
    if (button.dataset.presidentOffice) {
      byId('president-office').value = button.dataset.presidentOffice;
      byId('president-status').value = '';
      byId('president-document-search').value = '';
      page = 1; navigate('documents'); return;
    }
    if (button.dataset.presidentDownload) { downloadDocument(button.dataset.presidentDownload, button.dataset.fileName); return; }
    if (button.id === 'president-signout') { signOut(); return; }
    if (button.id === 'president-switch-role') { switchRole(); return; }
    if (button.id === 'president-year') { loadReport(true); return; }
    if (button.id === 'president-filter-toggle') {
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      byId('president-view').classList.toggle('pres-filters-open', open);
      return;
    }
    if (button.id === 'president-refresh') { if (tab === 'documents') navigate('documents'); else loadReport(); return; }
    if (button.id === 'president-back') { navigate('documents'); return; }
    if (button.id === 'president-prev' || button.id === 'president-next') { page += button.id === 'president-prev' ? -1 : 1; loadDocuments(); }
  }

  function reset() {
    generation++; reportRequest++; documentRequest++; detailRequest++;
    clearTimeout(searchTimer);
    report = null; tab = 'overview'; page = 1;
    byId('president-view').classList.add('d-none');
    byId('president-view').classList.remove('pres-filters-open');
    if (!mounted) return;
    byId('president-filter-toggle').setAttribute('aria-expanded', 'false');
    ['president-overview-content', 'president-office-list', 'president-document-list', 'president-detail'].forEach((id) => { byId(id).innerHTML = ''; });
    ['president-start', 'president-end', 'president-type', 'president-office-search', 'president-document-search', 'president-status'].forEach((id) => { byId(id).value = ''; });
    ['president-notice', 'president-report-error', 'president-document-error', 'president-updated'].forEach((id) => { byId(id).textContent = ''; byId(id).classList.add('d-none'); });
    byId('president-apply').disabled = false;
    byId('president-office').value = 'all';
  }

  function notice(message) {
    byId('president-notice').textContent = message;
    byId('president-notice').classList.remove('d-none');
    byId('president-notice').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  return { enter, reset, navigate, loadReport, loadDocuments, openDocument, notice };
}
