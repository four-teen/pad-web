import {animatedIcon} from './icons.js';

const travelPeriods = [
  {key:'ongoing', title:'On travel', icon:'location', note:'Departed before today'},
  {key:'today', title:'Traveling today', icon:'clock', note:'Departing today'},
  {key:'tomorrow', title:'Traveling tomorrow', icon:'clock', note:'Departing tomorrow'},
  {key:'incoming', title:'Incoming travels', icon:'globe', note:'Departing after tomorrow'},
  {key:'completed', title:'Total Travels', icon:'completed', note:'Completed travels only'}
];

export function formatTravelDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 'Not recorded';
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-PH', {dateStyle:'medium', timeZone:'UTC'}).format(date);
}

export function createTravelOverview({byId, escapeHtml, statusBadge}) {
  let summary = null;
  let selectedWindow = 'ongoing';
  const number = value => value == null ? '\u2014' : Number(value).toLocaleString('en-PH');
  const titles = {ongoing:'On travel',today:'Departing today',tomorrow:'Departing tomorrow',incoming:'Upcoming departures',completed:'Completed travels'};
  function setVisible(visible) {
    byId('travel-overview').classList.toggle('d-none', !visible);
    byId('travel-records-list').classList.toggle('d-none', !visible);
  }
  function cards() {
    byId('travel-summary-cards').innerHTML = travelPeriods.map(period => '<button type="button" class="travel-summary-card travel-tone-' + period.key + '" data-travel-window="' + period.key + '" aria-pressed="' + (period.key === selectedWindow) + '"><span class="travel-card-top"><span class="travel-card-icon">' + animatedIcon(period.icon, '.travel-summary-card') + '</span><i class="bx bx-right-arrow-alt" aria-hidden="true"></i></span><span class="travel-card-label">' + period.title + '</span><strong>' + number(summary?.counts?.[period.key]) + '</strong><small>' + period.note + '</small></button>').join('');
    byId('travel-list-heading').textContent = titles[selectedWindow];
    byId('travel-summary-date').textContent = summary ? formatTravelDate(summary.today) + ' \u00b7 Asia/Manila' : 'Schedules use Asia/Manila dates';
    byId('travel-summary-note').textContent = 'Counts are travel orders. On travel includes the return date. Total Travels counts only orders with a return date before today.' + (summary?.counts?.unscheduled ? ' ' + number(summary.counts.unscheduled) + (Number(summary.counts.unscheduled) === 1 ? ' order has no valid schedule and is excluded.' : ' orders have no valid schedule and are excluded.') : '');
  }
  function record(document) {
    const travel = document.travel_details;
    const people = document.personnel || [];
    const reference = escapeHtml(document.reference_no);
    const names = people.map(person => '<li>' + escapeHtml(person.name) + '</li>').join('');
    const field = (label, value) => '<div><dt>' + label + '</dt><dd>' + escapeHtml(value || 'Not recorded') + '</dd></div>';
    const timeline = '<button type="button" class="btn btn-sm btn-outline-primary travel-icon-action" data-document="' + reference + '" aria-label="View timeline for ' + reference + '" title="View timeline"><i class="bx bx-history" aria-hidden="true"></i></button>';
    const attachment = document.stored_file_name ? '<button type="button" class="btn btn-sm btn-outline-secondary travel-icon-action" data-preview-attachment="' + reference + '" data-file-name="' + escapeHtml(document.file_name || document.reference_no) + '" aria-label="Preview attachment for ' + reference + '" title="Preview attachment"><i class="bx bx-paperclip" aria-hidden="true"></i></button>' : '';
    return '<article class="travel-order-card"><div class="travel-order-row"><header class="travel-order-heading"><h3 title="' + escapeHtml(document.subject || 'Travel order') + '">' + escapeHtml(document.subject || 'Travel order') + '</h3></header><section class="travel-employees" aria-label="Employees on this travel order"><div class="travel-section-label"><i class="bx bx-group" aria-hidden="true"></i>Employees <span>' + people.length + '</span></div>' + (names ? '<ul>' + names + '</ul>' : '<p class="travel-missing">Employee names not recorded.</p>') + '</section><div class="travel-date-range"><div><span><i class="bx bx-calendar-event" aria-hidden="true"></i>Departure</span><strong>' + formatTravelDate(travel?.departure_date) + '</strong></div><div><span><i class="bx bx-calendar-check" aria-hidden="true"></i>Return</span><strong>' + formatTravelDate(travel?.return_date) + '</strong></div></div><div class="travel-destination"><span class="travel-section-label"><i class="bx bx-map" aria-hidden="true"></i>Destination</span><p title="' + escapeHtml(travel?.destination || 'Not recorded') + '">' + escapeHtml(travel?.destination || 'Not recorded') + '</p></div><div class="travel-row-actions">' + attachment + timeline + '</div></div><details class="travel-record-details"><summary>Travel details <i class="bx bx-chevron-down" aria-hidden="true"></i></summary><div class="travel-record-details-body"><div class="travel-record-meta"><span class="reference-number">' + reference + '</span><div class="routing-received-tags">' + statusBadge(document) + '</div></div><dl class="travel-facts">' + field('Document title', document.subject || 'Travel order') + field('Destination', travel?.destination) + field('Purpose', travel?.purpose) + field('Travel arrangement', travel?.travel_type) + field('Vehicle required', travel?.vehicle_requirement) + field('Origin office', document.source_office_name || document.external_sender) + field('Order date', travel?.order_date ? formatTravelDate(travel.order_date) : '') + '</dl>' + (travel?.remarks ? '<div class="travel-remarks"><strong>Travel remarks</strong><p>' + escapeHtml(travel.remarks) + '</p></div>' : '') + '</div></details></article>';
  }
  function render(nextSummary, documents, selected = 'ongoing') {
    summary = nextSummary;
    selectedWindow = selected;
    setVisible(true);
    cards();
    byId('travel-records-list').innerHTML = documents.length ? documents.map(record).join('') : '<div class="travel-empty"><i class="bx bx-calendar-check" aria-hidden="true"></i><h3>No matching travels</h3><p>No travel orders match this period and the current filters.</p></div>';
  }
  function setLoading(visible, busy, selected = 'ongoing') {
    setVisible(visible);
    if (!visible) return;
    selectedWindow = selected;
    cards();
    byId('travel-overview').setAttribute('aria-busy', String(busy));
    byId('travel-records-list').setAttribute('aria-busy', String(busy));
    if (busy) byId('travel-records-list').innerHTML = '<div class="routing-load-state" role="status"><span class="spinner-border spinner-border-sm text-primary" aria-hidden="true"></span><span>Loading travel orders and employees...</span></div>';
  }
  function fail() {
    byId('travel-records-list').innerHTML = '<div class="routing-load-state flex-column" role="alert"><span>Travel orders could not be loaded.</span><button type="button" class="btn btn-sm btn-outline-primary" data-retry-documents>Try again</button></div>';
  }
  function reset() {summary = null; selectedWindow = 'ongoing'; setVisible(false); byId('travel-records-list').innerHTML = '';}
  return {render, setLoading, fail, reset};
}
