const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.TICKET_SIGNING_SECRET = 'test-only-'.repeat(10);
process.env.SUPABASE_URL = 'https://test.example.com';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const handler = require('../api/booking');
const { access } = require('../lib/tickets');
function response() { return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;},end(value){this.body=value;return this;}}; }
test('download requires valid access and verified payment; paid PDF has ticket pages', async () => {
 const original = global.fetch;
 try {
  const forbidden=response(); await handler({method:'POST',body:{access:'forged',action:'download'}},forbidden); assert.equal(forbidden.statusCode,401);
  let paid=false;
  global.fetch = async url => {
   const resource=new URL(url).pathname.split('/').pop();
   const rows={registrations:[{id:'RYF26-1234ABCD',visit:'both',quantity:1,amount_paise:40000,status:paid?'paid':'pending'}],festival_payments:paid?[{amount_paise:40000,transaction_id:'TEST-ONLY',verified_at:'2026-11-15T00:00:00Z'}]:[],festival_tickets:[{id:'12345678-1234-4321-8123-123456789012',position:1}],registration_participants:[{position:1,first_name:'Test',last_name:'Participant'}]};
   return {ok:true,json:async()=>rows[resource]};
  };
  const request={method:'POST',body:{access:access('RYF26-1234ABCD'),action:'download'}};
  const pending=response(); await handler(request,pending); assert.equal(pending.statusCode,409);
  paid=true; const result=response(); await handler(request,result);
  assert.equal(result.headers['Content-Type'],'application/pdf');
  assert.equal(result.body.subarray(0,4).toString(),'%PDF');
  assert.equal((result.body.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2);
 } finally {global.fetch=original;}
});
test('gateway endpoint remains disabled', async () => {
 const res=response(); require('../api/payment')({method:'POST'},res); assert.equal(res.statusCode,503);
});
