import {readFileSync} from 'node:fs';
import {animatedIcon} from '../src/icons.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTravelOverview,formatTravelDate} from '../src/travel-overview.js';
import {getDocumentTypeColor,getDocumentTypeIcon,normalizeDocumentType,isTravelOrderType} from '../src/document-types.js';
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const summary={today:'2026-11-06',tomorrow:'2026-11-07',counts:{ongoing:5,today:3,tomorrow:4,incoming:12,completed:8,total:33,unscheduled:1}};
function page(){
 const elements=new Map();const byId=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{innerHTML:'',textContent:'',classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)},setAttribute(name,value){this[name]=value;}});}return elements.get(id);};
 return {byId,view:createTravelOverview({byId,escapeHtml,formatDate:value=>value,statusBadge:()=>'<span>Recorded</span>'})};
}
test('all five travel cards use server totals and identify the selected date window',()=>{
 const app=page();app.view.render(summary,[],'tomorrow');const html=app.byId('travel-summary-cards').innerHTML;
 for(const label of ['On travel','Traveling today','Traveling tomorrow','Incoming travels','Total Travels'])assert(html.includes(label));
 assert.match(html,/data-travel-window="tomorrow" aria-pressed="true"/);assert.match(html,/>8<\/strong>/);
 assert.match(app.byId('travel-summary-date').textContent,/Nov 6, 2026/);assert.match(app.byId('travel-summary-note').textContent,/1 order has no valid schedule/);
});
test('each travel order renders every employee and both dates with complete itinerary fields',()=>{
 const app=page();app.view.render(summary,[{reference_no:'26-12345',subject:'Research training',status:'completed',personnel:[{name:'Ana Santos'},{name:'Juan Dela Cruz'},{name:'Maya Reyes'}],travel_details:{departure_date:'2026-11-05',return_date:'2026-11-09',destination:'Davao City',purpose:'Faculty workshop',travel_type:'Official Business',vehicle_requirement:'Not Necessary',order_date:'2026-11-01',remarks:'Bring approval copy'}}]);
 const html=app.byId('travel-records-list').innerHTML;
 for(const name of ['Ana Santos','Juan Dela Cruz','Maya Reyes','Davao City','Faculty workshop','Official Business','Not Necessary','Bring approval copy'])assert(html.includes(name));
 assert.match(html,/Departure/);assert.match(html,/Return/);assert.match(html,/Nov 5, 2026/);assert.match(html,/Nov 9, 2026/);assert.match(html,/data-document="26-12345"/);
});
test('legacy orders show missing names and dates without fabricating employees or schedules',()=>{
 const app=page();app.view.render(summary,[{reference_no:'LEGACY-1',subject:'Old travel order',personnel:[],travel_details:null}]);
 assert.match(app.byId('travel-records-list').innerHTML,/Employee names not recorded/);assert.match(app.byId('travel-records-list').innerHTML,/Not recorded/);
 app.view.render({...summary,counts:{today:0,tomorrow:0,incoming:0,total:0}},[],'today');assert.match(app.byId('travel-records-list').innerHTML,/No matching travels/);
});
test('employee names, itinerary text and reference attributes remain safely escaped',()=>{
 const app=page();app.view.render(summary,[{reference_no:'<file>',subject:'<script>alert(1)</script>',personnel:[{name:'<img src=x>'}],travel_details:{destination:'<script>bad</script>',purpose:'<b>purpose</b>'}}]);
 const html=app.byId('travel-records-list').innerHTML;assert.doesNotMatch(html,/<script>|<img src=x>|<b>purpose/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/data-document="&lt;file&gt;"/);
});
test('loading and retry never display stale employees and reset hides travel content',()=>{
 const app=page();app.view.render(summary,[{reference_no:'TRAVEL-1',personnel:[{name:'Previous employee'}]}]);app.view.setLoading(true,true,'today');
 assert.doesNotMatch(app.byId('travel-records-list').innerHTML,/Previous employee/);assert.equal(app.byId('travel-records-list')['aria-busy'],'true');
 app.view.fail();assert.match(app.byId('travel-records-list').innerHTML,/data-retry-documents/);app.view.reset();assert.equal(app.byId('travel-overview').classList.contains('d-none'),true);
});
test('travel calendar dates are stable across timezone changes and reject invalid dates',()=>{
 assert.equal(formatTravelDate('2026-11-06'),'Nov 6, 2026');assert.equal(formatTravelDate('2026-02-31'),'Not recorded');assert.equal(formatTravelDate(null),'Not recorded');
});
test('sidebar and Records reuse exactly the same normalized document-type colors',()=>{
 assert.equal(getDocumentTypeColor('Travel Order'),'#08758a');assert.equal(getDocumentTypeColor('  TRAVEL   ORDER '),'#08758a');assert.equal(getDocumentTypeColor('Memorandum'),'#536c26');
 assert.equal(getDocumentTypeColor('Custom Type'),getDocumentTypeColor('CUSTOM TYPE'));assert.equal(isTravelOrderType('travel order'),true);assert.equal(isTravelOrderType('Travel Order Reply'),false);assert.equal(normalizeDocumentType('  Project  Proposal '),'PROJECT PROPOSAL');
});

test('Lordicon selections have local animation files, valid hover states and free source attribution',()=>{
 const sources=JSON.parse(readFileSync(new URL('../public/assets/icons/lordicon/sources.json',import.meta.url),'utf8'));
 for(const name of ['location','clock','globe','completed','communication','plan','document','proposal']){
  const html=animatedIcon(name);const path=html.match(/src="\.\/([^"]+)"/)[1];const state=html.match(/ state="([^"]+)"/)[1];
  const animation=JSON.parse(readFileSync(new URL('../public/'+path,import.meta.url),'utf8'));
  assert(animation.markers.some(marker=>marker.cm.replace(/^default:/,'')===state),'Missing animation state for '+name);
  assert.equal(sources.assets.find(asset=>path.endsWith('/'+asset.file)).plan,'FREE');
  assert.match(html,/trigger="hover" target="button" current-color/);
 }
});
test('document types choose functional icons with the same color palette',()=>{
 assert.equal(getDocumentTypeIcon('Travel Order'),'globe');assert.equal(getDocumentTypeIcon('EMAIL'),'communication');assert.equal(getDocumentTypeIcon('Outgoing Communication'),'communication');assert.equal(getDocumentTypeIcon('Activity Design'),'plan');assert.equal(getDocumentTypeIcon('Project Proposal for Institutional Development'),'proposal');assert.equal(getDocumentTypeIcon('Memorandum'),'document');
});
test('travel rows keep every employee and dates visible while extra itinerary details are expandable',()=>{
 const app=page();app.view.render(summary,[{reference_no:'TRAVEL-1',personnel:[{name:'Ana Santos'},{name:'Maya Reyes'}],travel_details:{departure_date:'2026-11-01',return_date:'2026-11-09',purpose:'Regional training'}}],'ongoing');
 const html=app.byId('travel-records-list').innerHTML;const detailStart=html.indexOf('<details');
 assert(html.indexOf('Ana Santos')<detailStart&&html.indexOf('Maya Reyes')<detailStart);assert(html.indexOf('Departure')<detailStart&&html.indexOf('Return')<detailStart);
 assert.match(html,/<details class="travel-record-details"><summary>Travel details/);assert(html.indexOf('Regional training')>detailStart);assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
});
