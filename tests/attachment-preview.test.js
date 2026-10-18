import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/attachment-preview.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function preview(loadFile, loadPdf) {
  const elements = new Map(); const created = []; const revoked = []; const urls = [];
  function node(tag) {
    const classes = new Set();
    return { tag, style: {}, children: [], attributes: {}, listeners: {}, clientWidth: 800, clientHeight: 600,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) },
      addEventListener(event, callback) { this.listeners[event] = callback; },
      replaceChildren(...children) { this.children = children; }, appendChild(child) { this.children.push(child); },
      setAttribute(key, value) { this.attributes[key] = value; }, getContext() { return {}; },
      click() { this.clicked = true; }, remove() {}, focus() {},
    };
  }
  const byId = (id) => { if (!elements.has(id)) elements.set(id, node(id)); return elements.get(id); };
  const context = vm.createContext({ AbortController, Uint8Array, setTimeout: () => 1, clearTimeout() {},
    URL: { createObjectURL(blob) { urls.push(blob); return `blob:local-${urls.length}`; }, revokeObjectURL(url) { revoked.push(url); } },
    bootstrap: { Modal: class { constructor(element) { this.element = element; } show() { this.element.visible = true; } hide() { this.element.visible = false; this.element.listeners['hide.bs.modal']?.(); } } },
    window: { devicePixelRatio: 1, addEventListener() {} },
    document: { activeElement: null, body: node('body'), createElement(tag) { const element = node(tag); created.push(element); return element; } },
  });
  vm.runInContext(source, context);
  const state = { token: 'private-session', activeRole: 'ovp_central_records' };
  return { view: context.createAttachmentPreview({ state, byId, loadFile, loadPdf }), state, byId, created, revoked, urls,
    click: (id) => byId(`attachment-preview-${id}`).listeners.click(), kind: context.attachmentKind };
}

test('opening an image does not save a file; only the explicit Download action does', async () => {
  let requests = 0;
  const p = preview(async () => { requests++; return new Blob(['image'], { type: 'image/jpeg' }); });
  await p.view.open('25-06769', 'scan.jpg');
  const image = p.created.find((n) => n.tag === 'img'); image.naturalWidth = 1200; image.naturalHeight = 1600; image.onload();
  assert.equal(p.byId('attachment-preview-status').classList.contains('d-none'), true);
  assert.equal(p.created.filter((n) => n.tag === 'a').length, 0);
  p.click('download');
  const link = p.created.find((n) => n.tag === 'a');
  assert.equal(link.download, 'scan.jpg'); assert.equal(link.clicked, true); assert.equal(requests, 1);
  p.view.reset();
  assert.ok(p.revoked.includes(image.src));
  assert.equal(p.byId('attachment-preview-stage').children.length, 0);
  assert.equal(p.byId('attachment-preview-download').disabled, true);
});

test('closing an in-flight preview aborts it and prevents late content or download', async () => {
  const pending = deferred(); let signal;
  const p = preview((_reference, abortSignal) => { signal = abortSignal; return pending.promise; });
  const opening = p.view.open('25-1', 'old.jpg');
  p.view.reset(); assert.equal(signal.aborted, true);
  pending.resolve(new Blob(['image'], { type: 'image/jpeg' })); await opening;
  assert.equal(p.urls.length, 0); assert.equal(p.byId('attachment-preview-download').disabled, true);
});

test('a newer preview wins and old content cannot be exposed after a role change', async () => {
  const old = deferred(); const p = preview((ref) => ref === 'OLD' ? old.promise : Promise.resolve(new Blob(['image'], { type: 'image/png' })));
  const first = p.view.open('OLD', 'old.png'); await p.view.open('NEW', 'new.png');
  old.resolve(new Blob(['old'], { type: 'image/png' })); await first;
  assert.equal(p.byId('attachment-preview-filename').textContent, 'new.png'); assert.equal(p.urls.length, 1);
  p.state.activeRole = 'ovp_pad'; p.click('download');
  assert.equal(p.created.filter((n) => n.tag === 'a').length, 0);
  p.view.reset();
});

test('PDF page navigation renders in the modal and never invokes a file download', async () => {
  const pages = [];
  const task = { promise: Promise.resolve({ numPages: 2, async getPage(n) { pages.push(n); return {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }),
  }; } }), destroy: () => Promise.resolve() };
  const p = preview(async () => new Blob(['pdf'], { type: 'application/pdf' }), async () => task);
  await p.view.open('25-6776', 'two-pages.pdf');
  assert.equal(p.byId('attachment-preview-page').textContent, 'Page 1 of 2');
  assert.equal(p.byId('attachment-preview-previous').disabled, true);
  p.click('next'); await flush();
  assert.deepEqual(pages, [1, 2]); assert.equal(p.byId('attachment-preview-next').disabled, true);
  assert.match(p.byId('attachment-preview-stage').children[0].attributes['aria-label'], /Page 2 of 2/);
  assert.equal(p.created.filter((n) => n.tag === 'a').length, 0);
});

test('unpreviewable formats remain download-only and HTML cannot masquerade as an image', async () => {
  const p = preview(async () => new Blob(['<script>untrusted</script>'], { type: 'text/html' }));
  await p.view.open('25-1', 'misleading.jpg');
  assert.equal(p.kind('text/html', 'misleading.jpg'), 'other');
  assert.equal(p.created.some((n) => ['img', 'iframe', 'object', 'canvas'].includes(n.tag)), false);
  assert.match(p.byId('attachment-preview-status').children[1].textContent, /Download this file/);
  assert.equal(p.byId('attachment-preview-download').disabled, false);
});

test('missing or inaccessible attachments show the API error and cannot be downloaded', async () => {
  const p = preview(async () => { throw new Error('The stored document could not be found.'); });
  await p.view.open('25-1', 'missing.pdf');
  assert.equal(p.byId('attachment-preview-download').disabled, true);
  assert.match(p.byId('attachment-preview-status').children[1].textContent, /could not be found/);
});
