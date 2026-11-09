// Locally bundled Lordicon FREE assets; source and license links live beside them.
const animatedIconAssets = {
  location: {file:'18-location-pin', state:'hover-jump', fallback:'bx-map'},
  clock: {file:'45-clock-time', state:'hover-oscillate', fallback:'bx-time-five'},
  globe: {file:'27-globe', state:'hover-rotate', fallback:'bx-globe'},
  completed: {file:'37-check', state:'hover-pinch', fallback:'bx-check-circle'},
  communication: {file:'177-envelope-send', state:'hover-flying', fallback:'bx-mail-send'},
  plan: {file:'12-layers', state:'hover-slide', fallback:'bx-layer'},
  document: {file:'56-file-text', state:'hover-swipe', fallback:'bx-file'},
  proposal: {file:'49-plus-circle', state:'hover-rotation', fallback:'bx-plus-circle'}
};

export function animatedIcon(name, target = 'button') {
  const icon = animatedIconAssets[name] || animatedIconAssets.document;
  return '<span class="animated-icon" aria-hidden="true"><i class="bx ' + icon.fallback + ' animated-icon-fallback"></i><lord-icon src="./assets/icons/lordicon/' + icon.file + '.json" state="' + icon.state + '" trigger="hover" target="' + target + '" current-color></lord-icon></span>';
}
