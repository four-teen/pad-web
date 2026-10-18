// Invented records shared by isolated unit and browser tests.
export const presidentOffices = [
  { id: 1, name: 'Office of the University President', code: 'OP', campus: 'ACCESS', is_active: 1 },
  { id: 2, name: 'OVP Central Records', code: 'RECORDS', campus: 'ACCESS', is_active: 1 },
  { id: 3, name: 'College of Computer Studies', code: 'CCS', campus: 'ISULAN', is_active: 1 },
  { id: 4, name: 'Office of Research and Development', code: 'ORD', campus: 'ACCESS', is_active: 1 },
  { id: 5, name: 'Former Extension Office', code: 'EXT', campus: 'TACURONG', is_active: 0 },
];
export function presidentReport() {
  return { scope: 'global', server_time: '2026-10-11T08:00:00Z', filters: { start_date: '2026-01-01', end_date: '2026-10-11', document_type: '' },
    document_types: ['Memorandum', 'Travel Order', 'Request Letter', 'Special Order'],
    snapshot: { total_documents: 1486, pending_action: 78, awaiting_receipt: 18, oldest_days: 21, correction_pending: 4 },
    period: { registered: 1236, received: 1048, acted: 982, delivered: 956 },
    monthly: [104, 128, 112, 147, 119, 138, 152, 143, 121, 72].map((value, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, registered: value, acted: Math.round(value * .78), delivered: Math.round(value * .75) })),
    pending_age: { '0–3 days': 46, '4–7 days': 26, '8–15 days': 17, '16+ days': 7 },
    processing_time: { registration_to_act: { seconds: 232416, samples: 982 } },
    type_breakdown: [{ name: 'Memorandum', documents: 482, share: 39 }, { name: 'Travel Order', documents: 347, share: 28.1 }, { name: 'Request Letter', documents: 261, share: 21.1 }, { name: 'Special Order', documents: 146, share: 11.8 }],
    recorded_type_breakdown: [{ name: 'Memorandum', documents: 600 }, { name: 'Request Letter', documents: 300 }, { name: 'Special Order', documents: 186 }, { name: 'Travel Order', documents: 400 }, { name: 'Unacted Type', documents: 0 }],
    acted_type_breakdown: [{ name: 'Memorandum', documents: 382 }, { name: 'Request Letter', documents: 221 }, { name: 'Special Order', documents: 99 }, { name: 'Travel Order', documents: 280 }, { name: 'Unacted Type', documents: 0 }],
    office_workload: presidentOffices.map((office, i) => ({ ...office, pending_action: [0, 24, 18, 21, 15][i], awaiting_receipt: [0, 6, 3, 8, 1][i], oldest_days: [0, 12, 8, 21, 17][i], period_acted: [0, 524, 189, 164, 105][i], period_handoffs: [0, 1024, 216, 291, 187][i] })).sort((a, b) => (b.pending_action + b.awaiting_receipt) - (a.pending_action + a.awaiting_receipt)),
    oldest_pending: [{ reference_no: 'PAD-2026-000124', subject: 'Research partnership endorsement', office_name: 'Office of Research and Development', queue: 'Pending action', days: 21 }, { reference_no: 'PAD-2026-000128', subject: 'Community extension program report', office_name: 'Former Extension Office', queue: 'Pending action', days: 17 }, { reference_no: 'PAD-2026-000131', subject: 'Annual procurement plan endorsement', office_name: 'OVP Central Records', queue: 'Pending action', days: 12 }] };
}
export const presidentDocuments = Array.from({ length: 25 }, (_, index) => {
  const titles = ['Research partnership endorsement', 'Community extension program report', 'Annual procurement plan endorsement', 'Authority to conduct faculty development training', 'Campus infrastructure maintenance request', 'Travel authority for research fieldwork'];
  const office = presidentOffices[1 + index % 4];
  return { reference_no: `PAD-2026-${String(124 + index).padStart(6, '0')}`, subject: titles[index % titles.length] + (index > 5 ? ` · Batch ${Math.floor(index / 6) + 1}` : ''),
    document_type: ['Memorandum', 'Travel Order', 'Request Letter'][index % 3], status: ['received', 'in_transit', 'delivered', 'acted'][index % 4],
    current_office_id: office.id, current_office_name: office.name, source_office_name: 'College of Computer Studies',
    pending_office_id: index % 4 === 1 ? 2 : null, pending_office_name: index % 4 === 1 ? 'OVP Central Records' : null,
    created_at: '2026-09-20 00:00:00', updated_at: '2026-10-11 05:30:00', file_name: null,
    description: 'Sample document for isolated browser verification.', permissions: { receive: false, route: false, delete: false },
    history: [{ id: 1, action: 'created', destination_office_name: 'College of Computer Studies', acted_by_name: 'Sample Records Staff', created_at: '2026-09-20 00:00:00', notes: 'Document registered.' },
      { id: 2, action: 'routed', origin_office_name: 'College of Computer Studies', destination_office_name: office.name, acted_by_name: 'Sample Records Staff', created_at: '2026-09-20 01:00:00', notes: 'For review and appropriate action.' },
      { id: 3, action: 'received', origin_office_name: 'College of Computer Studies', destination_office_name: office.name, acted_by_name: 'Sample Office Staff', created_at: '2026-09-20 02:00:00' }] };
});
