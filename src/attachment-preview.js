export function attachmentKind(mime, filename = '') {
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)) return 'image';
  // Only infer a type when the server did not provide one. Never embed HTML/SVG.
  if (!type || type === 'application/octet-stream') {
    if (/\.pdf$/i.test(filename)) return 'pdf';
    if (/\.(?:jpe?g|png|gif|webp)$/i.test(filename)) return 'image';
  }
  return 'other';
}

export function createAttachmentPreview({ state, byId, loadFile, loadPdf = async (data) => (await import('./pdf-preview.js')).openPdf(data) }) {
  const element = byId('attachment-preview-modal');
  const modal = new bootstrap.Modal(element);
  const stage = byId('attachment-preview-stage');
  const status = byId('attachment-preview-status');
  const download = byId('attachment-preview-download');
  let current = null;
  let returnFocus = null;
  let resizeTimer;
  const active = (view) => current === view && view.token === state.token && view.role === state.activeRole;
  const toggle = (id, visible) => byId(id).classList.toggle('d-none', !visible);

  function message(title, detail = '') {
    status.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = title;
    status.appendChild(heading);
    if (detail) { const note = document.createElement('span'); note.textContent = detail; status.appendChild(note); }
    status.classList.remove('d-none');
  }

  function clear() {
    const previous = current; current = null;
    clearTimeout(resizeTimer);
    if (previous) {
      previous.controller.abort();
      previous.renderTask?.cancel();
      previous.loadingTask?.destroy()?.catch(() => {});
      if (previous.url) URL.revokeObjectURL(previous.url);
    }
    stage.replaceChildren(); download.disabled = true;
    toggle('attachment-preview-controls', false);
    toggle('attachment-preview-pages', false);
  }

  function controls(view) {
    if (!active(view)) return;
    byId('attachment-preview-zoom').textContent = `${Math.round(view.zoom * 100)}%`;
    byId('attachment-preview-zoom-out').disabled = view.zoom <= 0.5;
    byId('attachment-preview-zoom-in').disabled = view.zoom >= 3;
    if (view.pdf) {
      byId('attachment-preview-page').textContent = `Page ${view.page} of ${view.pdf.numPages}`;
      byId('attachment-preview-previous').disabled = view.page === 1;
      byId('attachment-preview-next').disabled = view.page === view.pdf.numPages;
    }
  }

  async function render(view) {
    if (!active(view)) return;
    const generation = ++view.generation;
    view.renderTask?.cancel();
    controls(view);
    const width = Math.max(160, stage.clientWidth - 32);
    const height = Math.max(160, stage.clientHeight - 32);
    if (view.image) {
      const fit = Math.min(1, width / view.image.naturalWidth, height / view.image.naturalHeight);
      view.image.style.width = `${Math.round(view.image.naturalWidth * fit * view.zoom)}px`;
      return;
    }
    if (!view.pdf) return;
    try {
      const pageNumber = view.page;
      const page = await view.pdf.getPage(pageNumber);
      if (!active(view) || generation !== view.generation) return;
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(width / original.width, height / original.height) * view.zoom;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${Math.round(viewport.width)}px`; canvas.style.height = `${Math.round(viewport.height)}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Page ${pageNumber} of ${view.pdf.numPages}: ${view.filename}`);
      view.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await view.renderTask.promise;
      if (!active(view) || generation !== view.generation) return;
      stage.replaceChildren(canvas); stage.scrollTop = 0; stage.scrollLeft = 0;
      status.classList.add('d-none');
    } catch (error) {
      if (active(view) && generation === view.generation && error.name !== 'RenderingCancelledException') {
        message('This page could not be displayed.', 'You can still download the original file.');
      }
    }
  }

  async function open(reference, filename = reference) {
    clear();
    returnFocus = document.activeElement;
    if (!state.token || !state.activeRole) return;
    const view = { reference, filename, token: state.token, role: state.activeRole, controller: new AbortController(), zoom: 1, page: 1, generation: 0 };
    current = view;
    byId('attachment-preview-filename').textContent = filename || reference;
    byId('attachment-preview-reference').textContent = reference;
    byId('attachment-preview-meta').textContent = 'Loading attachment';
    message('Opening your attachment…', 'The preview will appear here.');
    element.setAttribute('aria-busy', 'true');
    modal.show();
    try {
      const blob = await loadFile(reference, view.controller.signal);
      if (!active(view)) return;
      view.blob = blob;
      const kind = attachmentKind(blob.type, filename);
      const size = blob.size < 1048576 ? `${Math.max(1, Math.round(blob.size / 1024))} KB` : `${(blob.size / 1048576).toFixed(1)} MB`;
      byId('attachment-preview-meta').textContent = `${kind === 'pdf' ? 'PDF document' : kind === 'image' ? 'Image' : 'Document'} · ${size}`;
      download.disabled = false;
      if (kind === 'pdf') {
        const task = await loadPdf(new Uint8Array(await blob.arrayBuffer()));
        if (!active(view)) { task.destroy()?.catch(() => {}); return; }
        view.loadingTask = task;
        view.pdf = await task.promise;
        if (!active(view)) return;
        toggle('attachment-preview-controls', true); toggle('attachment-preview-pages', true);
        await render(view);
      } else if (kind === 'image') {
        view.url = URL.createObjectURL(blob);
        const image = document.createElement('img'); image.alt = filename; image.src = view.url;
        view.image = image;
        image.onload = () => {
          if (!active(view)) return;
          status.classList.add('d-none'); toggle('attachment-preview-controls', true); render(view);
        };
        image.onerror = () => { if (active(view)) message('This image could not be displayed.', 'You can still download the original file.'); };
        stage.replaceChildren(image);
      } else {
        message('Your attachment is ready.', 'Preview is available for images and PDFs. Download this file to open it in its application.');
      }
    } catch (error) {
      if (active(view) && error.name !== 'AbortError') {
        message('Unable to open this attachment.', view.blob ? 'The file could not be previewed. You can still download the original.' : error.message || 'Please close the preview and try again.');
        byId('attachment-preview-meta').textContent = view.blob ? 'Original file available' : 'Attachment unavailable';
      }
    } finally { if (active(view)) element.setAttribute('aria-busy', 'false'); }
  }

  download.addEventListener('click', () => {
    const view = current;
    if (!view?.blob || !active(view)) return;
    const url = URL.createObjectURL(view.blob);
    const link = document.createElement('a'); link.href = url; link.download = view.filename || view.reference;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const [id, update] of [
    ['previous', (view) => { view.page = Math.max(1, view.page - 1); }],
    ['next', (view) => { view.page = Math.min(view.pdf.numPages, view.page + 1); }],
    ['zoom-out', (view) => { view.zoom = Math.max(0.5, view.zoom - 0.25); }],
    ['zoom-in', (view) => { view.zoom = Math.min(3, view.zoom + 0.25); }],
    ['fit', (view) => { view.zoom = 1; }],
  ]) byId(`attachment-preview-${id}`).addEventListener('click', () => { if (current && active(current)) { update(current); render(current); } });
  element.addEventListener('shown.bs.modal', () => { if (current) render(current); });
  element.addEventListener('hide.bs.modal', clear);
  element.addEventListener('hidden.bs.modal', () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (current) render(current); }, 150); });
  return { open, reset() { clear(); modal.hide(); } };
}
