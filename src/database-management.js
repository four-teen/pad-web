export function createDatabaseManagement({ state, api, byId, escapeHtml, formatDate, isAdministrator, refreshAdmin, downloadBackup }) {
  const modal = new bootstrap.Modal(byId('database-clear-modal'));
  let generation = 0;
  let review = null;
  let clearing = false;
  const number = (value) => Number(value || 0).toLocaleString('en-PH');
  const impact = (counts) => Object.entries(counts).map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${number(count)}</td></tr>`).join('');
  const groups = [
    { key: 'preparation', label: 'PREPARATION', description: 'Offices, officials, document types, sources, and personnel used to prepare registration and routing.' },
    { key: 'operations', label: 'OPERATIONS', description: 'Document registry, routing history, PAD reviews, personnel links, and travel details. New, returned, and completed documents share the same registry.' },
    { key: 'system', label: 'SYSTEM & ACCESS', description: 'Login accounts, numbering, the administrative operation log, and other protected tables.' },
  ];

  function render(data) {
    byId('database-setup-notice').classList.toggle('d-none', data.audit_ready);
    const document = data.tables.find((table) => table.name === 'documents');
    byId('database-document-count').textContent = number(document?.count);
    byId('database-clear-documents').disabled = !data.audit_ready || !document?.can_clear;
    const tableRow = (table) => {
      const related = Object.entries(table.affected_counts).filter(([name]) => name !== table.name && name !== 'documents');
      const status = table.blocked_reasons.length ? table.blocked_reasons.join(' ') : table.count || related.some(([, count]) => count) ? 'Available to clear after review.' : 'Empty';
      const action = table.name === 'documents' ? 'Clear all document records' : 'Clear content';
      return `<tr><td><strong>${escapeHtml(table.label)}</strong><small class="d-block text-muted">${escapeHtml(table.name)}</small></td><td class="text-end">${number(table.count)}</td><td><span class="small ${table.blocked_reasons.length ? 'text-muted' : 'text-success'}">${escapeHtml(status)}</span>${related.length ? `<small class="d-block text-muted mt-1">Also clears: ${related.map(([name, count]) => `${escapeHtml(name)} (${number(count)})`).join(', ')}</small>` : ''}</td><td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-database-clear="${escapeHtml(table.name)}" ${!data.audit_ready || !table.can_clear ? 'disabled' : ''}>${action}</button></td></tr>`;
    };
    byId('database-tables').innerHTML = groups.map((group) => {
      const tables = data.tables.filter((table) => (table.group || 'system') === group.key);
      if (!tables.length) return '';
      return `<tr class="table-light"><td colspan="4" class="py-3"><div class="d-flex flex-wrap justify-content-between gap-2"><strong>${escapeHtml(group.label)}</strong><span class="small text-muted">${number(tables.length)} tables · ${number(tables.reduce((sum, table) => sum + Number(table.count), 0))} stored rows</span></div><small class="d-block text-muted mt-1">${escapeHtml(group.description)}</small></td></tr>${tables.map(tableRow).join('')}`;
    }).join('');
    byId('database-events').innerHTML = data.events.map((event) => {
      let counts = {}; try { counts = JSON.parse(event.cleared_counts); } catch { /* old/unavailable log metadata */ }
      return `<tr><td>${formatDate(event.created_at)}</td><td>${escapeHtml(event.actor_email)}</td><td>${escapeHtml(event.target_table)}<small class="d-block text-muted">${Object.entries(counts).map(([name, count]) => `${escapeHtml(name)}: ${number(count)}`).join(' · ')}</small></td><td>${escapeHtml(event.reason)}</td><td><button type="button" class="btn btn-sm btn-outline-secondary" data-database-backup="${Number(event.id)}">Download backup</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="text-center text-muted py-4">No table-clear operations recorded.</td></tr>';
  }

  async function load() {
    if (!isAdministrator()) return;
    const current = ++generation;
    byId('database-error').classList.add('d-none');
    byId('database-tables').innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Loading table counts…</td></tr>';
    byId('database-clear-documents').disabled = true;
    try {
      const data = await api('/api/admin/database');
      if (current !== generation || !isAdministrator()) return;
      render(data);
    } catch (error) {
      if (current !== generation) return;
      byId('database-error').textContent = error.message;
      byId('database-error').classList.remove('d-none');
      byId('database-tables').innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Table counts could not be loaded.</td></tr>';
    }
  }

  function updateConfirmation() {
    ['database-confirmation', 'database-reason', 'database-acknowledged'].forEach((id) => { byId(id).disabled = clearing; });
    byId('database-clear-modal').querySelectorAll('[data-bs-dismiss="modal"]').forEach((button) => { button.disabled = clearing; });
    byId('database-clear-submit').disabled = clearing || !review || byId('database-confirmation').value !== review.confirmation
      || !byId('database-acknowledged').checked || byId('database-reason').value.trim().length < 3;
  }

  async function open(table) {
    if (!isAdministrator() || clearing) return;
    const current = ++generation;
    review = null;
    byId('database-clear-form').reset();
    byId('database-clear-error').classList.add('d-none');
    byId('database-clear-title').textContent = 'Review table-clear operation';
    byId('database-clear-impact').innerHTML = '<tr><td colspan="2">Checking affected records…</td></tr>';
    byId('database-confirmation-phrase').textContent = '';
    byId('database-clear-total').textContent = '';
    updateConfirmation();
    modal.show();
    try {
      const response = await api('/api/admin/database/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table }) });
      if (current !== generation || !isAdministrator()) return;
      if (!response?.counts || !response.label || !response.token || response.confirmation !== `CLEAR ${table}`) {
        throw new Error('The operation review could not be loaded. Refresh counts and try again.');
      }
      review = response;
      byId('database-clear-title').textContent = `Clear ${response.label}`;
      byId('database-clear-impact').innerHTML = impact(response.counts);
      byId('database-confirmation-phrase').textContent = response.confirmation;
      byId('database-clear-total').textContent = `${number(response.total_records)} rows across ${Object.keys(response.counts).length} table(s). Review expires in 10 minutes.`;
      updateConfirmation();
    } catch (error) {
      if (current !== generation) return;
      byId('database-clear-error').textContent = error.message;
      byId('database-clear-error').classList.remove('d-none');
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!isAdministrator() || clearing || byId('database-clear-submit').disabled || !review) return;
    clearing = true;
    const current = generation;
    updateConfirmation();
    byId('database-clear-error').classList.add('d-none');
    try {
      const result = await api('/api/admin/database/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        token: review.token, confirmation: byId('database-confirmation').value, acknowledged: byId('database-acknowledged').checked, reason: byId('database-reason').value.trim(),
      }) });
      if (current !== generation || !isAdministrator()) return;
      review = null;
      modal.hide();
      byId('database-success').textContent = result.message;
      byId('database-success').classList.remove('d-none');
      await Promise.all([load(), refreshAdmin()]);
    } catch (error) {
      if (current !== generation) return;
      review = null; // A failed operation requires a fresh review, including after an unknown network outcome.
      byId('database-clear-error').textContent = `${error.message} Close this dialog and review the operation again.`;
      byId('database-clear-error').classList.remove('d-none');
    } finally { clearing = false; updateConfirmation(); }
  }

  function reset() {
    generation++;
    review = null;
    modal.hide();
    byId('database-tables').innerHTML = ''; byId('database-events').innerHTML = '';
    byId('database-success').classList.add('d-none');
    byId('database-clear-error').classList.add('d-none');
  }

  function bind() {
    byId('database-clear-form').addEventListener('submit', submit);
    byId('database-confirmation').addEventListener('input', updateConfirmation);
    byId('database-reason').addEventListener('input', updateConfirmation);
    byId('database-acknowledged').addEventListener('change', updateConfirmation);
    byId('database-refresh').addEventListener('click', load);
    byId('database-clear-documents').addEventListener('click', () => open('documents'));
    byId('database-clear-modal').addEventListener('hidden.bs.modal', () => { if (!clearing) { generation++; review = null; } });
  }

  function handleClick(event) {
    const clear = event.target.closest('[data-database-clear]');
    if (clear && !clear.disabled) open(clear.dataset.databaseClear);
    const backup = event.target.closest('[data-database-backup]');
    if (backup && isAdministrator()) downloadBackup(Number(backup.dataset.databaseBackup));
  }
  return { load, reset, bind, handleClick };
}
