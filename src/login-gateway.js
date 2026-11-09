export function createLoginGateway({ byId, onOpen }) {
  const gateway = byId('auth-gateway');
  const seal = byId('auth-seal-button');
  const access = byId('auth-access');
  const cancel = byId('auth-cancel');
  let busy = false;

  function updateSealAccess() {
    seal.tabIndex = gateway.classList.contains('is-open') && window.innerWidth < 768 ? -1 : 0;
  }
  function setOpen(open, focus = true) {
    if (busy) return;
    gateway.classList.toggle('is-open', open);
    access.inert = !open;
    seal.setAttribute('aria-expanded', String(open));
    seal.setAttribute('aria-label', open ? 'Close sign-in panel' : 'Open sign-in panel');
    updateSealAccess();
    if (focus) (open ? access : seal).focus({ preventScroll: true });
    if (open) onOpen();
  }
  function updateViewport() {
    const viewport = window.visualViewport;
    if (viewport && Math.abs(viewport.scale - 1) > .01) return;
    const height = Math.round(viewport?.height ?? window.innerHeight);
    if (Number.isFinite(height)) {
      gateway.style.setProperty('--auth-height', height + 'px');
      gateway.classList.toggle('is-compact', height < 560);
    }
    updateSealAccess();
  }
  function setBusy(value) {
    busy = value;
    seal.disabled = value;
    cancel.disabled = value;
    byId('google-signin').inert = value;
    access.setAttribute('aria-busy', String(value));
  }

  seal.addEventListener('click', () => setOpen(!gateway.classList.contains('is-open')));
  cancel.addEventListener('click', () => setOpen(false));
  gateway.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gateway.classList.contains('is-open') && !busy) {
      event.preventDefault();
      setOpen(false);
    }
  });
  window.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  setOpen(false, false);
  updateViewport();
  return { setOpen, setBusy };
}
