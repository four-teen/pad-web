import test from 'node:test';
import assert from 'node:assert/strict';
import { accountAssignmentIssues, summarizeAdministration } from '../src/admin-overview.js';
const rolesFor = account => account.roles || [];
const offices = [
  {id:1,code:'RECORDS',campus:'ACCESS',is_active:1,officials:[{id:1}]},
  {id:2,code:'PAD',campus:'ACCESS',is_active:1,officials:[]},
  {id:3,code:'CCS',campus:'Isulan',is_active:1,officials:[{id:2}]},
  {id:4,code:'OP',campus:'',is_active:1,officials:[{id:3}]},
  {id:5,code:'OLD',campus:'Isulan',is_active:0,officials:[]},
  {id:6,code:'LAB',campus:'Isulan',is_active:1,officials:[]}
];
const accounts = [
  {id:1,name:'Administrator',is_active:1,roles:['admin'],last_login_at:'2026-11-05 00:00:00'},
  {id:2,name:'Multiple roles',is_active:1,roles:['ovp_pad','ovp_central_records'],ovp_pad_office_id:2,ovp_central_records_office_id:1,last_login_at:'2026-11-04T08:00:00+08:00'},
  {id:3,name:'Disabled',is_active:0,roles:['sksu_officials'],office_id:3,last_login_at:null},
  {id:4,name:'Missing office',is_active:1,roles:['sksu_officials'],office_id:null,last_login_at:null},
  {id:5,name:'Inactive office',is_active:1,roles:['sksu_officials'],office_id:5,last_login_at:null},
  {id:6,name:'President',is_active:1,roles:['university_president'],office_id:4,last_login_at:'2026-11-01 00:00:00'}
];
const summary = () => summarizeAdministration({accounts,offices,overview:{users:6,active_users:5,offices:5,documents:1482}},rolesFor,Date.parse('2026-11-06T00:00:00Z'));

test('uses the API all-time document total rather than summing overlapping office counts', () => {
  const data=summary();
  assert.equal(data.total,6);assert.equal(data.enabledTotal,5);assert.equal(data.officeTotal,5);assert.equal(data.documents,1482);
  assert.deepEqual([data.signedIn.length,data.waiting.length,data.disabled.length],[3,2,1]);
  assert.equal(data.signedIn.length+data.waiting.length+data.disabled.length,accounts.length);
});

test('counts each enabled account once per office and excludes disabled accounts from coverage', () => {
  const data=summary();
  assert.equal(data.covered,3);
  assert.equal(data.coverage.get(3).size,0);
  assert.deepEqual(data.uncovered.map(office=>office.code),['CCS','LAB']);
  assert.equal(data.uncovered.some(office=>office.code==='OP'),false);
  const duplicate = {...accounts[1],roles:['ovp_pad','ovp_central_records'],ovp_pad_office_id:1,ovp_central_records_office_id:1};
  assert.equal(summarizeAdministration({accounts:[duplicate],offices},rolesFor).coverage.get(1).size,1);
});

test('setup checks distinguish inactive offices, unassigned roles, monitoring, and official eligibility', () => {
  assert.deepEqual(summary().needsAssignment.map(account=>account.id),[4,5]);
  assert.deepEqual(summary().noOfficials.map(office=>office.code),['PAD','LAB']);
  assert.deepEqual(accountAssignmentIssues({is_active:1,roles:['sksu_officials'],office_id:6},offices,rolesFor),['sksu_officials']);
  assert.deepEqual(accountAssignmentIssues({is_active:1,roles:['ovp_pad'],ovp_pad_office_id:4},offices,rolesFor),['ovp_pad']);
  assert.deepEqual(accountAssignmentIssues(accounts[0],offices,rolesFor),[]);
  assert.deepEqual(accountAssignmentIssues(accounts[2],offices,rolesFor),[]);
  assert.deepEqual(accountAssignmentIssues(accounts[5],offices,rolesFor),[]);
});

test('campus coverage includes only active offices and retains unspecified campus as a real group', () => {
  const data=summary();
  assert.deepEqual(data.campuses.map(({label,total,covered})=>({label,total,covered})),[
    {label:'ACCESS',total:2,covered:2},{label:'Isulan',total:2,covered:0},{label:'Campus not specified',total:1,covered:1}
  ]);
});

test('role counts support multiple assignments without treating them as unique users', () => {
  const data=summary();
  assert.deepEqual(data.roles.find(role=>role.role==='sksu_officials'),{role:'sksu_officials',label:'SKSU Officials',total:3,enabled:2});
  assert.equal(data.roles.find(role=>role.role==='ovp_pad').enabled,1);
  assert.equal(data.roles.find(role=>role.role==='university_president').enabled,1);
});

test('recent sign-ins compare UTC and offset timestamps consistently and ignore invalid dates', () => {
  const data=summarizeAdministration({accounts:[...accounts,{id:7,is_active:1,roles:['admin'],last_login_at:'bad date'},{id:8,is_active:1,roles:['admin'],last_login_at:'2026-11-07T00:00:00Z'}],offices},rolesFor,Date.parse('2026-11-06T00:00:00Z'));
  assert.deepEqual(data.recent.map(account=>account.id),[8,1,2,6]);
  assert.equal(data.signedInWeek,3);
});

test('empty datasets produce honest zero coverage and retain an unknown document total', () => {
  const data=summarizeAdministration({},rolesFor);
  assert.equal(data.documents,null);assert.equal(data.total,0);assert.equal(data.covered,0);
  assert.deepEqual(data.recent,[]);assert.deepEqual(data.campuses,[]);assert.deepEqual(data.needsAssignment,[]);
});
