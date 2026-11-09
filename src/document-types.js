const knownDocumentTypeColors = new Map(Object.entries({
  'ACTIVITY DESIGN': '#6244a3', 'EMAIL': '#2459a6', 'HAND CARRY': '#16744b',
  'LOCAL COMMUNICATION': '#9a600d', 'OUTGOING COMMUNICATION': '#a3421f',
  'PROJECT PROPOSAL': '#aa304c', 'TRAVEL ORDER': '#08758a',
  'MEMORANDUM': '#536c26', 'GENERAL DOCUMENT': '#56616f'
}));

export function normalizeDocumentType(name) {
  return String(name || 'General document').trim().replace(/\s+/g, ' ').toUpperCase() || 'GENERAL DOCUMENT';
}

export function getDocumentTypeColor(name) {
  const type = normalizeDocumentType(name);
  if (knownDocumentTypeColors.has(type)) return knownDocumentTypeColors.get(type);
  let hash = 0;
  for (const character of type) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return 'hsl(' + hash % 360 + ' 60% 32%)';
}

export function isTravelOrderType(name) {
  return normalizeDocumentType(name) === 'TRAVEL ORDER';
}

export function getDocumentTypeIcon(name) {
  const type = normalizeDocumentType(name);
  if (type === 'TRAVEL ORDER') return 'globe';
  if (type === 'HAND CARRY') return 'location';
  if (type === 'EMAIL' || type.includes('COMMUNICATION')) return 'communication';
  if (type.includes('ACTIVITY DESIGN')) return 'plan';
  if (type.includes('PROJECT PROPOSAL')) return 'proposal';
  return 'document';
}
