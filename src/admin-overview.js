import { getDocumentTypeColor, getDocumentTypeIcon } from './document-types.js';
import { animatedIcon } from './icons.js';

const moduleOfficeKey = role => role === 'sksu_officials' || role === 'university_president' ? 'office_id' : role + '_office_id';
const active = record => Number(record.is_active) === 1;
const receiver = office => active(office) && String(office.code || '').toUpperCase() !== 'OP' && office.can_receive_documents !== false;
const count = value => Number.isFinite(Number(value)) && value !== null && value !== undefined ? Math.max(0, Number(value)) : null;
const loginTime = value => {
  if (!value) return NaN;
  const text = String(value).trim().replace(' ', 'T');
  return Date.parse(text + (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? '' : 'Z'));
};

export function accountAssignmentIssues(account, offices, rolesFor) {
  if (!active(account)) return [];
  return rolesFor(account).filter(role => role !== 'admin').filter(role => {
    const office = offices.find(item => Number(item.id) === Number(account[moduleOfficeKey(role)]));
    if (!office || !active(office)) return true;
    if (['ovp_pad', 'ovp_central_records'].includes(role) && String(office.code || '').toUpperCase() === 'OP') return true;
    return role === 'sksu_officials' && String(office.code || '').toUpperCase() !== 'OP' && !(office.officials || []).length;
  });
}

export function summarizeAdministration({ accounts = [], offices = [], overview = {} }, rolesFor, now = Date.now()) {
  const enabled = accounts.filter(active);
  const activeOffices = offices.filter(active);
  const coverage = new Map(offices.map(office => [Number(office.id), new Set()]));
  enabled.forEach(account => rolesFor(account).filter(role => role !== 'admin').forEach(role => {
    const officeId = Number(account[moduleOfficeKey(role)]);
    const office = offices.find(item => Number(item.id) === officeId);
    if (office && active(office) && (!['ovp_pad', 'ovp_central_records'].includes(role) || String(office.code || '').toUpperCase() !== 'OP')) coverage.get(officeId).add(account.id);
  }));
  const uncovered = activeOffices.filter(office => receiver(office) && !coverage.get(Number(office.id))?.size);
  const noOfficials = activeOffices.filter(office => !(office.officials || []).length);
  const needsAssignment = enabled.filter(account => accountAssignmentIssues(account, offices, rolesFor).length);
  const waiting = enabled.filter(account => !account.last_login_at);
  const signedIn = enabled.filter(account => Boolean(account.last_login_at));
  const disabled = accounts.filter(account => !active(account));
  const roleNames = {admin:'Administrator',ovp_pad:'OVP PAD',ovp_central_records:'OVP Central Records',sksu_officials:'SKSU Officials',university_president:'University President'};
  const roles = Object.entries(roleNames).map(([role,label]) => ({role,label,total:accounts.filter(account=>rolesFor(account).includes(role)).length,enabled:enabled.filter(account=>rolesFor(account).includes(role)).length}));
  const campuses = new Map();
  activeOffices.forEach(office => {
    const label = String(office.campus || '').trim() || 'Campus not specified';
    const key = String(office.campus || '').trim() || '__unspecified';
    if (!campuses.has(key)) campuses.set(key,{key,label,total:0,covered:0,officials:0});
    const row=campuses.get(key);row.total++;if(coverage.get(Number(office.id))?.size)row.covered++;row.officials+=(office.officials||[]).length;
  });
  return {total:count(overview.users)??accounts.length,enabledTotal:count(overview.active_users)??enabled.length,officeTotal:count(overview.offices)??activeOffices.length,documents:count(overview.documents),
    enabled,signedIn,waiting,disabled,uncovered,noOfficials,needsAssignment,coverage,roles,
    campuses:[...campuses.values()].sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label)),
    recent:accounts.filter(account=>Number.isFinite(loginTime(account.last_login_at))).sort((a,b)=>loginTime(b.last_login_at)-loginTime(a.last_login_at)).slice(0,5),
    signedInWeek:enabled.filter(account=>{const time=loginTime(account.last_login_at);return time<=now&&time>=now-7*86400000;}).length,
    covered:activeOffices.filter(office=>coverage.get(Number(office.id))?.size).length, activeOffices};
}

export function createAdminOverview({ state, byId, escapeHtml, accountRoles, formatDate }) {
  const number = value => value === null ? '—' : new Intl.NumberFormat('en-PH').format(value);
  const safeId = value => /^\d+$/.test(String(value)) ? String(value) : '';
  let snapshot = null;
  let request = 0;
  let cached = null;
  let cachedAccounts, cachedOffices, cachedOverview;
  function model() {
    if (!cached || cachedAccounts !== state.admin.accounts || cachedOffices !== state.admin.offices || cachedOverview !== state.admin.overview) {
      cached = summarizeAdministration(state.admin, accountRoles);
      cachedAccounts = state.admin.accounts;
      cachedOffices = state.admin.offices;
      cachedOverview = state.admin.overview;
    }
    return cached;
  }
  function setLoading() {
    const current=++request;
    byId('admin-overview-content').setAttribute('aria-busy','true');
    byId('admin-overview-refresh').disabled=true;
    if (!snapshot) byId('admin-document-types-list').innerHTML = '<li class="admin-document-types-message">Document types could not load. <button type="button" data-admin-types-retry>Retry</button></li>';
    byId('admin-overview-status').textContent=snapshot?'Updating overview...':'Loading administration data...';
    return current;
  }
  function renderDocumentTypes(types) {
    const target = byId('admin-document-types-list');
    if (!Array.isArray(types)) {
      target.innerHTML = '<li class="admin-document-types-message">Document counts are unavailable. Please refresh or try again later.</li>';
      return;
    }
    target.innerHTML = types.map(type => {
      const label = type.name || 'Unspecified';
      const count = number(type.documents);
      const accessibleLabel = label + ': ' + count + (Number(type.documents) === 1 ? ' document' : ' documents');
      return '<li><button type="button" class="menu-link admin-document-type-link" data-admin-document-type="' + escapeHtml(type.name) + '" style="--document-type-color:' + getDocumentTypeColor(type.name) + '" aria-label="' + escapeHtml(accessibleLabel) + '"' + (type.name ? '' : ' disabled') + '>' + animatedIcon(getDocumentTypeIcon(type.name), '.admin-document-type-link') + '<span class="admin-document-type-name">' + escapeHtml(label) + '</span><span class="admin-document-type-count">' + count + '</span></button></li>';
    }).join('') || '<li class="admin-document-types-message">No document types have been configured.</li>';

  }
  function render(current = request) {
    if(current!==request)return;
    const data=model(); snapshot=new Date();
    renderDocumentTypes(state.admin.overview.document_types);
    const metrics={'admin-users-total':data.total,'admin-users-active':data.enabledTotal,'admin-offices-total':data.officeTotal,'admin-documents-total':data.documents};
    Object.entries(metrics).forEach(([id,value])=>{byId(id).textContent=value===null?'—':value;});
    byId('admin-accounts-detail').textContent=number(data.disabled.length)+' disabled';
    byId('admin-active-detail').textContent=number(data.waiting.length)+' awaiting first sign-in';
    byId('admin-offices-detail').textContent=number(state.admin.offices.length)+' offices in the directory';
    byId('admin-documents-detail').textContent='All registered documents';
    byId('admin-overview-status').textContent='Updated '+new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(snapshot)+' · Manila time';
    byId('admin-overview-refresh').disabled=false;
    byId('admin-overview-content').setAttribute('aria-busy','false');
    const checks=[
      {key:'assignment',count:data.needsAssignment.length,icon:'bx-user-x',title:'Accounts need office setup',copy:'Enabled accounts with a missing or unavailable role office.'},
      {key:'uncovered',count:data.uncovered.length,icon:'bx-buildings',title:'Offices without enabled accounts',copy:'Active receiving offices with no enabled account assigned.'},
      {key:'officials',count:data.noOfficials.length,icon:'bx-id-card',title:'Offices missing officials',copy:'Active offices with no official listed in the directory.'}
    ];
    const issues=checks.filter(check=>check.count);
    byId('admin-attention-count').textContent=issues.length?issues.length+' checks to review':'Setup checks clear';
    byId('admin-attention-list').innerHTML=issues.length?issues.map(check=>'<button type="button" class="admin-attention-row" data-admin-insight="'+check.key+'"><span class="admin-attention-symbol"><i class="bx '+check.icon+'" aria-hidden="true"></i></span><span class="admin-attention-copy"><strong>'+check.title+'</strong><small>'+check.copy+'</small></span><span class="admin-attention-number">'+number(check.count)+'</span><i class="bx bx-chevron-right" aria-hidden="true"></i></button>').join(''):'<div class="admin-clear-state"><i class="bx bx-check-shield" aria-hidden="true"></i><strong>No setup gaps in these checks</strong><p>Enabled accounts have their role offices, and active offices have assigned accounts and officials.</p></div>';
    const total=state.admin.accounts.length;
    const signedPercent=total?data.signedIn.length/total*100:0;
    const waitingPercent=total?data.waiting.length/total*100:0;
    byId('admin-access-chart').style.setProperty('--signed-end',signedPercent+'%');
    byId('admin-access-chart').style.setProperty('--waiting-end',(signedPercent+waitingPercent)+'%');
    byId('admin-access-chart').classList.toggle('is-empty',!total);
    byId('admin-access-percent').textContent=total?Math.round(data.signedIn.length/total*100)+'%':'—';
    byId('admin-access-legend').innerHTML=[['signed','Signed in before',data.signedIn.length],['waiting','Awaiting first sign-in',data.waiting.length],['disabled','Disabled accounts',data.disabled.length]].map(([key,label,value])=>'<div><span class="admin-legend-dot '+key+'"></span><span>'+label+'</span><strong>'+number(value)+'</strong></div>').join('');
    byId('admin-signins-week').textContent=number(data.signedInWeek)+' enabled '+(data.signedInWeek===1?'account':'accounts')+' signed in within the last 7 days.';
    byId('admin-campus-summary').textContent=number(data.covered)+' of '+number(data.activeOffices.length)+' active offices have enabled accounts';
    byId('admin-campus-list').innerHTML=data.campuses.map(campus=>'<button type="button" class="admin-campus-row" data-admin-campus="'+escapeHtml(campus.key)+'"><span class="admin-campus-label"><strong>'+escapeHtml(campus.label)+'</strong><small>'+number(campus.total)+' active '+(campus.total===1?'office':'offices')+' · '+number(campus.officials)+' officials</small></span><span class="admin-campus-bar"><span style="width:'+Math.round(campus.covered/campus.total*100)+'%"></span></span><span class="admin-campus-value">'+campus.covered+'/'+campus.total+'<small>covered</small></span><i class="bx bx-chevron-right" aria-hidden="true"></i></button>').join('')||'<p class="admin-empty">No active offices to display.</p>';
    byId('admin-role-list').innerHTML=data.roles.map(role=>'<div class="admin-role-row"><span><strong>'+role.label+'</strong><small>'+number(role.total)+' assigned accounts</small></span><span class="admin-role-value">'+number(role.enabled)+'<small>enabled</small></span></div>').join('');
    byId('admin-recent-list').innerHTML=data.recent.map(account=>'<button type="button" class="admin-recent-row" data-view-admin="account" data-record-id="'+safeId(account.id)+'"><span class="admin-recent-avatar" aria-hidden="true">'+escapeHtml((account.name||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase())+'</span><span class="admin-recent-person"><strong>'+escapeHtml(account.name||'Unnamed account')+'</strong><small>'+escapeHtml(String(account.email||'').toLowerCase())+'</small></span><span class="admin-recent-access '+(active(account)?'is-enabled':'')+'">'+(active(account)?'Enabled':'Disabled')+'</span><time>'+escapeHtml(formatDate(account.last_login_at))+'</time><i class="bx bx-chevron-right" aria-hidden="true"></i></button>').join('')||'<p class="admin-empty">No account sign-ins have been recorded yet.</p>';
  }
  function fail(message,current=request){
    if(current!==request)return;
    byId('admin-overview-refresh').disabled=false;
    byId('admin-overview-content').setAttribute('aria-busy','false');
    byId('admin-overview-status').textContent=snapshot?'Refresh failed. Showing the previous snapshot.':'Overview unavailable. Select Refresh to try again.';
  }
  function reset() {
    request++;
    snapshot = null;
    cached = null;
    byId('admin-document-types-list').innerHTML = '<li class="admin-document-types-message">Loading document types...</li>';
    ['admin-attention-list', 'admin-access-legend', 'admin-campus-list', 'admin-role-list', 'admin-recent-list'].forEach(id => { byId(id).innerHTML = ''; });
    ['admin-users-total', 'admin-users-active', 'admin-offices-total', 'admin-documents-total', 'admin-access-percent'].forEach(id => { byId(id).textContent = '—'; });
    ['admin-accounts-detail', 'admin-active-detail', 'admin-offices-detail', 'admin-documents-detail'].forEach(id => { byId(id).textContent = 'Loading...'; });
    byId('admin-overview-status').textContent = 'Loading administration data...';
    byId('admin-campus-summary').textContent = 'Loading active office coverage...';
    byId('admin-attention-count').textContent = 'Checking setup';
    byId('admin-signins-week').textContent = "Sign-in dates reflect each account's latest recorded login.";
    byId('admin-access-chart').classList.add('is-empty');
    byId('admin-access-chart').style.setProperty('--signed-end', '0%');
    byId('admin-access-chart').style.setProperty('--waiting-end', '0%');
    byId('admin-overview-refresh').disabled = false;
  }

  function matchesAccount(account,status){return status==='assignment'?accountAssignmentIssues(account,state.admin.offices,accountRoles).length>0:status==='awaiting'?active(account)&&!account.last_login_at:true;}
  function matchesOffice(office,filter){if(!filter)return true;const data=model();return (filter==='uncovered'?data.uncovered:data.noOfficials).some(item=>Number(item.id)===Number(office.id));}
  return {setLoading,render,fail,reset,matchesAccount,matchesOffice};
}
