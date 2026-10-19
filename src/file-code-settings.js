export function createFileCodeSettings({ api, byId, escapeHtml, isAdministrator }) {
  let settings = null;
  let generation = 0;
  let saving = false;

  function error(message = '') {
    byId('file-code-error').textContent = message;
    byId('file-code-error').classList.toggle('d-none', !message);
  }

  function preview() {
    const year = Number(byId('file-code-year').value);
    const next = Number(byId('file-code-next').value);
    const valid = settings && year === settings.selected.year && Number.isInteger(next)
      && next >= settings.selected.next_number && next <= 4294967295 && settings.selected.next_number !== null;
    byId('file-code-preview').textContent = valid ? `${String(year).slice(-2)}-${String(next).padStart(5, '0')}` : '—';
    byId('file-code-save').disabled = saving || !valid;
  }

  function render(data) {
    settings = data;
    const selected = data.selected;
    byId('file-code-year').value = String(selected.year);
    byId('file-code-next').value = selected.next_number === null ? '' : String(selected.next_number);
    byId('file-code-next').min = String(selected.next_number ?? 4294967295);
    byId('file-code-next').disabled = selected.next_number === null;
    byId('file-code-minimum').textContent = selected.next_number === null
      ? 'This annual series is exhausted.' : `The next number must be at least ${selected.next_number.toLocaleString()}.`;
    byId('file-code-current-year').textContent = String(data.current_year);
    byId('file-code-series').innerHTML = data.series.map((row) => `<tr><td>${escapeHtml(row.year)}${row.year === data.current_year ? ' <span class="badge bg-label-success">Current year</span>' : ''}</td><td>${escapeHtml(row.last_number.toLocaleString())}</td><td class="reference-number">${escapeHtml(row.preview || 'Series exhausted')}</td></tr>`).join('');
    preview();
  }

  async function load() {
    if (!isAdministrator() || saving) return;
    const current = ++generation;
    settings = null;
    byId('file-code-save').disabled = true;
    byId('file-code-success').classList.add('d-none');
    error();
    const value = byId('file-code-year').value;
    if (value && (!Number.isInteger(Number(value)) || Number(value) < 2000 || Number(value) > 2099)) {
      error('Enter a year from 2000 to 2099.');
      preview();
      return;
    }
    try {
      const response = await api('/api/admin/file-codes' + (value ? `?year=${encodeURIComponent(value)}` : ''));
      if (current !== generation || !isAdministrator()) return;
      render(response.data);
    } catch (failure) {
      if (current === generation && isAdministrator()) { error(failure.message); preview(); }
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!isAdministrator() || saving || !settings || byId('file-code-save').disabled) return;
    const current = generation;
    const payload = { year: settings.selected.year, next_number: Number(byId('file-code-next').value), expected_next_number: settings.selected.next_number };
    saving = true;
    byId('file-code-save').disabled = true;
    byId('file-code-year').disabled = true;
    byId('file-code-next').disabled = true;
    byId('file-code-refresh').disabled = true;
    byId('file-code-success').classList.add('d-none');
    error();
    try {
      const response = await api('/api/admin/file-codes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (current !== generation || !isAdministrator()) return;
      render(response.data);
      byId('file-code-success').textContent = `File code settings saved. Next code for ${payload.year}: ${response.data.selected.preview}.`;
      byId('file-code-success').classList.remove('d-none');
    } catch (failure) {
      if (current === generation && isAdministrator()) {
        // A failed or stale edit must be refreshed before another save.
        settings = null;
        error(failure.message);
      }
    } finally {
      if (current === generation) {
        saving = false;
        byId('file-code-year').disabled = false;
        byId('file-code-next').disabled = settings?.selected.next_number === null;
        byId('file-code-refresh').disabled = false;
        preview();
      }
    }
  }

  function reset() {
    generation++;
    settings = null;
    saving = false;
    byId('file-code-year').value = '';
    byId('file-code-next').value = '';
    byId('file-code-year').disabled = false;
    byId('file-code-next').disabled = false;
    byId('file-code-refresh').disabled = false;
    byId('file-code-series').innerHTML = '';
    byId('file-code-minimum').textContent = '';
    byId('file-code-current-year').textContent = '—';
    byId('file-code-success').classList.add('d-none');
    error();
    preview();
  }

  function bind() {
    byId('file-code-form').addEventListener('submit', submit);
    byId('file-code-year').addEventListener('change', load);
    byId('file-code-next').addEventListener('input', preview);
    byId('file-code-refresh').addEventListener('click', load);
  }

  return { load, reset, bind };
}
