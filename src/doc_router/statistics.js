export function createStatistics({ state, api, byId, escapeHtml, formatDate }) {
  let request = 0;
  let filters = {};
  const count = (value) => Number(value || 0).toLocaleString('en-PH');
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const empty = '<p class="text-muted mb-0">No records for this selection.</p>';
  const table = (head, rows) => `<div class="table-responsive"><table class="table statistics-table"><thead><tr>${head.map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="text-muted text-center py-4">No records for this selection.</td></tr>`}</tbody></table></div>`;
  const duration = (metric) => metric?.seconds == null ? 'No completed samples' : `${(number(metric.seconds) / 86400).toLocaleString('en-PH', { maximumFractionDigits: 1 })} days`;

  function cards(items) {
    return items.map(([label, value, note, icon]) => `<div class="col-sm-6 col-xl-4 col-xxl-2"><div class="card statistics-metric h-100"><div class="card-body"><i class="bx ${icon} statistics-metric-icon" aria-hidden="true"></i><p class="small text-muted mb-2">${label}</p><h3 class="mb-2">${count(value)}</h3><small class="text-muted">${note}</small></div></div></div>`).join('');
  }

  function monthChart(rows) {
    if (!rows.some((row) => row.registered || row.acted)) return empty;
    const maximum = Math.max(1, ...rows.flatMap((row) => [number(row.registered), number(row.acted)]));
    const width = Math.max(540, rows.length * 66 + 60);
    const top = 24, height = 160, bottom = top + height;
    const bars = rows.map((row, index) => {
      const x = 46 + index * ((width - 60) / rows.length);
      const label = new Intl.DateTimeFormat('en-PH', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${row.month}-01T00:00:00Z`));
      return [['registered', 0], ['acted', 22]].map(([key, offset]) => {
        const value = number(row[key]);
        const barHeight = value / maximum * height;
        return `<g><title>${escapeHtml(label)} · ${key === 'registered' ? 'Registered' : 'Acted'}: ${count(value)}</title><rect class="statistics-chart-${key}" x="${x + offset}" y="${bottom - barHeight}" width="18" height="${barHeight}" rx="3"/><text x="${x + offset + 9}" y="${bottom - barHeight - 5}" text-anchor="middle">${count(value)}</text></g>`;
      }).join('') + `<text x="${x + 20}" y="${bottom + 24}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }).join('');
    return `<div class="statistics-chart-scroll"><svg viewBox="0 0 ${width} 222" style="min-width:${width}px" role="img" aria-label="Monthly registered and acted document counts. Exact counts are in the monthly table below."><line x1="35" x2="${width - 10}" y1="${bottom}" y2="${bottom}" stroke="#dce4e0"/>${bars}</svg></div><div class="statistics-legend"><span><i class="statistics-chart-registered"></i>Registered</span><span><i class="statistics-chart-acted"></i>Acted</span></div>`;
  }

  function render(report) {
    const global = report.scope === 'global';
    const office = report.office?.name || state.user?.office_name || 'Your office';
    byId('statistics-title').textContent = global ? 'OVP Statistics' : 'Office Statistics';
    byId('statistics-description').textContent = global ? 'Shared document statistics for OVP PAD and OVP Central Records across all offices.' : `Documents involving ${office}, including records tracked after they leave your office.`;
    byId('statistics-scope').textContent = global ? 'All offices · shared OVP report' : office;
    byId('statistics-updated').textContent = `Updated ${formatDate(report.server_time)}`;
    byId('statistics-start').value = report.filters.start_date;
    byId('statistics-end').value = report.filters.end_date;
    byId('statistics-type').innerHTML = '<option value="">All document types</option>' + report.document_types.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    byId('statistics-type').value = report.filters.document_type;
    byId('statistics-workload-office').textContent = office;
    const snapshot = report.snapshot;
    byId('statistics-snapshot').innerHTML = cards([
      ['Total documents', snapshot.total_documents, global ? 'Unique registered documents · all time' : 'Unique office-related documents · all time', 'bx-folder'],
      ['Awaiting receipt', snapshot.awaiting_receipt, global ? 'Outstanding handoffs across all offices' : 'Incoming to your office now', 'bx-time-five'],
      ['Pending action', snapshot.pending_action, global ? 'Held unfinished work across all offices' : 'Held unfinished work in your office', 'bx-hourglass'],
      ['Acted', report.milestones.acted, global ? 'Documents with a recorded Act · all time' : 'Documents acted by your office · all time', 'bx-check-circle'],
      ['Delivered', report.milestones.delivered, global ? 'Documents with recorded delivery · all time' : 'Delivery recorded by your office · all time', 'bx-package'],
      ['Oldest pending', snapshot.oldest_days, 'Calendar days since dispatch or office receipt', 'bx-calendar-exclamation'],
    ]);
    byId('statistics-period-label').textContent = `${report.filters.start_date} to ${report.filters.end_date} · Asia/Manila`;
    byId('statistics-period').innerHTML = [
      ['Registered', report.period.registered], ['Handoffs received', report.period.received], ['Acted', report.period.acted],
      ['Delivered', report.period.delivered], ['Completed', report.period.completed], ['Sent documents', report.period.sent],
      ['Returned documents', report.period.returned], ['Dispatch events', report.period.handoffs],
    ].map(([label, value]) => `<div class="statistics-period-item"><span>${label}</span><strong>${count(value)}</strong></div>`).join('');
    byId('statistics-monthly-chart').innerHTML = monthChart(report.monthly);
    byId('statistics-monthly-table').innerHTML = table(['Month', 'Registered', 'Received', 'Acted', 'Delivered', 'Dispatches'], report.monthly.map((row) => `<tr><td>${escapeHtml(row.month)}</td>${['registered', 'received', 'acted', 'delivered', 'handoffs'].map((key) => `<td>${count(row[key])}</td>`).join('')}</tr>`).join(''));
    byId('statistics-types').innerHTML = report.type_breakdown.length ? table(['Document type', 'Documents', 'Share'], report.type_breakdown.map((row) => `<tr><td>${escapeHtml(row.name)}<div class="statistics-share"><span style="width:${number(row.share)}%"></span></div></td><td>${count(row.documents)}</td><td>${number(row.share)}%</td></tr>`).join('')) : empty;
    const pending = number(snapshot.awaiting_receipt) + number(snapshot.pending_action);
    byId('statistics-aging').innerHTML = Object.entries(report.pending_age).map(([label, value]) => `<div class="statistics-age-row"><div class="d-flex justify-content-between"><span>${escapeHtml(label)}</span><strong>${count(value)}</strong></div><div class="statistics-share"><span style="width:${pending ? number(value) * 100 / pending : 0}%"></span></div></div>`).join('');
    byId('statistics-processing').innerHTML = `<div class="statistics-time"><span>Office receipt to next handling action</span><strong>${duration(report.processing_time.office_handling)}</strong><small>${count(report.processing_time.office_handling.samples)} finished office stays in this period</small></div>${global ? `<div class="statistics-time"><span>Registration to first Act</span><strong>${duration(report.processing_time.registration_to_act)}</strong><small>${count(report.processing_time.registration_to_act.samples)} registered documents in this period with an Act milestone</small></div><div class="statistics-time"><span>Act dispatch to owner receipt</span><strong>${duration(report.processing_time.act_to_delivery)}</strong><small>${count(report.processing_time.act_to_delivery.samples)} confirmed handoffs in this period</small></div>` : ''}`;
    byId('statistics-statuses').innerHTML = table(['Current recorded status', 'Documents'], Object.entries(report.current_statuses).map(([status, value]) => `<tr><td>${escapeHtml({ created: 'Registered', in_transit: 'In transit', received: 'Received', acted: 'Acted', completed: 'Completed', delivered: 'Delivered' }[status] || status)}</td><td>${count(value)}</td></tr>`).join(''));
    byId('statistics-office-workload').innerHTML = table(['Office', 'Awaiting receipt now', 'Pending action now', 'Oldest (days)', 'Received in period', 'Acted in period', 'Sent in period', 'Dispatch events'], report.office_workload.map((row) => `<tr><td>${escapeHtml(row.name)}${row.campus ? `<small class="d-block text-muted">${escapeHtml(row.campus)}</small>` : ''}</td><td>${count(row.awaiting_receipt)}</td><td>${count(row.pending_action)}</td><td>${count(row.oldest_days)}</td><td>${count(row.period_received)}</td><td>${count(row.period_acted)}</td><td>${count(row.period_sent)}</td><td>${count(row.period_handoffs)}</td></tr>`).join(''));
    byId('statistics-office-workload-title').textContent = global ? 'Office workload & activity' : 'My office workload & activity';
    byId('statistics-oldest').innerHTML = table(['File code / particular', 'Queue', 'Since', 'Days'], report.oldest_pending.map((row) => `<tr><td><button class="btn btn-link p-0 text-start" type="button" data-document="${escapeHtml(row.reference_no)}">${escapeHtml(row.reference_no)}</button><small class="d-block">${escapeHtml(row.subject)}</small></td><td>${escapeHtml(row.queue)}</td><td>${formatDate(row.since)}</td><td>${count(row.days)}</td></tr>`).join(''));
    byId('statistics-corrections').textContent = `${count(snapshot.returned_pending)} pending return handoffs / returned records · ${count(snapshot.correction_pending)} delivered correction results still requiring work.`;
    byId('statistics-report').classList.remove('d-none');
  }

  async function load() {
    if (!state.user || !state.activeRole) return;
    const current = ++request;
    const role = state.activeRole;
    const office = state.user.office_id;
    byId('statistics-error').classList.add('d-none');
    byId('statistics-form').setAttribute('aria-busy', 'true');
    byId('statistics-apply').disabled = true;
    byId('statistics-report').classList.add('d-none');
    try {
      const report = await api(`/api/routing/statistics?${new URLSearchParams(filters)}`);
      if (current !== request || role !== state.activeRole || office !== state.user?.office_id) return;
      render(report);
    } catch (error) {
      if (current !== request) return;
      byId('statistics-error').textContent = error.message;
      byId('statistics-error').classList.remove('d-none');
    } finally {
      if (current === request) {
        byId('statistics-form').setAttribute('aria-busy', 'false');
        byId('statistics-apply').disabled = false;
      }
    }
  }

  function reset() {
    request++;
    filters = {};
    byId('statistics-report').classList.add('d-none');
    byId('statistics-error').classList.add('d-none');
    byId('statistics-start').value = ''; byId('statistics-end').value = '';
    byId('statistics-type').innerHTML = '<option value="">All document types</option>';
    byId('statistics-scope').textContent = 'Loading statistics…';
    byId('statistics-updated').textContent = '';
  }

  function bind() {
    byId('statistics-form').addEventListener('submit', (event) => {
      event.preventDefault();
      filters = { start_date: byId('statistics-start').value, end_date: byId('statistics-end').value, document_type: byId('statistics-type').value };
      load();
    });
    byId('statistics-reset').addEventListener('click', () => { filters = {}; load(); });
  }
  return { load, reset, bind };
}
