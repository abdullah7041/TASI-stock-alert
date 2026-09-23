import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeAccess } from '../app/lib/access-auth.mjs';
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test',alg:'RS256'};
const env={ACCESS_ISSUER:'https://unit.cloudflareaccess.com',ACCESS_AUD:'cockpit',AGENT_OWNER_EMAIL:'owner@example.com',PORTFOLIO_OWNER_ID:'original-ledger-id'};
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function token(overrides={}){const data=b64({alg:'RS256',kid:'test'})+'.'+b64({iss:env.ACCESS_ISSUER,aud:['cockpit'],exp:2000,nbf:900,type:'app',email:'owner@example.com',sub:'new-access-id',...overrides});return data+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))).toString('base64url');}
async function request(path='/',overrides={},method='GET'){return new Request('https://cockpit.example'+path,{method,headers:{'Cf-Access-Jwt-Assertion':await token(overrides),origin:'https://cockpit.example'}});}
const options={now:1000000,fetchImpl:async()=>Response.json({keys:[jwk]})};
test('verified owner maps to original ledger identity without any AI key',async()=>{assert.deepEqual(await authorizeAccess(await request(),env,options),{kind:'owner',ownerId:'original-ledger-id',email:'owner@example.com'});});
test('forged headers and tampered signatures are rejected',async()=>{
  await assert.rejects(authorizeAccess(new Request('https://cockpit.example',{headers:{'oai-authenticated-user-id':'original-ledger-id','oai-authenticated-user-email':'owner@example.com'}}),env,options));
  const req=await request();req.headers.set('Cf-Access-Jwt-Assertion',(await token()).split('.').slice(0,2).join('.')+'.AAAA');await assert.rejects(authorizeAccess(req,env,options));
});
for(const [name,claims] of [['wrong audience',{aud:['other']}],['wrong issuer',{iss:'https://other.cloudflareaccess.com'}],['expired',{exp:999}],['future',{nbf:1001}],['other owner',{email:'other@example.com'}]])test(`rejects ${name}`,async()=>{await assert.rejects(authorizeAccess(await request('/',claims),env,options));});
test('service identity cannot invoke the static-assets cockpit directly',async()=>{
  const claims={email:undefined,sub:'',common_name:'producer.access'};
  for(const path of ['/api/health','/api/dashboard/ingest','/api/portfolio/events'])await assert.rejects(authorizeAccess(await request(path,claims,'POST'),env,options));
});
test('cross-origin owner writes fail closed',async()=>{const req=await request('/api/portfolio/events',{},'POST');req.headers.set('origin','https://other.example');await assert.rejects(authorizeAccess(req,env,options));});
