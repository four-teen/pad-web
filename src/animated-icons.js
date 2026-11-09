// Load animation support only when the interface actually adds an icon.
// Login stays on the smaller application bundle; static fallbacks remain visible
// until the locally hosted player and animation data are ready.
document.addEventListener('ready', event => {
  if (event.target.localName === 'lord-icon') event.target.parentElement?.classList.add('is-ready');
}, true);

function loadPlayer() {
  import('@lordicon/element').then(({defineElement}) => defineElement()).catch(() => {
    // The static icons still identify each control if the player is unavailable.
  });
}
if (document.querySelector('lord-icon')) loadPlayer();
else {
  const observer = new MutationObserver(records => {
    if (!records.some(record => Array.from(record.addedNodes).some(node =>
      node.nodeType === 1 && (node.matches('lord-icon') || node.querySelector('lord-icon'))))) return;
    observer.disconnect();
    loadPlayer();
  });
  observer.observe(document.body, {childList:true, subtree:true});
}
