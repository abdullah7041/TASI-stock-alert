const cache = new Map();
const encoder = new TextEncoder();
const forbidden = () => new Response('Sign in with the authorized cockpit account.', {status:403});
const decode = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const json = value => JSON.parse(new TextDecoder().decode(decode(value)));

/** Verify signature and registered claims; never trust identity headers alone. */
export async function authorizeAccess(request, env, {fetchImpl=fetch,now=Date.now()}={}) {
  if(!env.ACCESS_ISSUER || !env.ACCESS_AUD || !env.AGENT_OWNER_EMAIL || !env.PORTFOLIO_OWNER_ID)
    throw new Response('Private access is not configured.',{status:503});
  try {
    const issuer=env.ACCESS_ISSUER.replace(/\/$/,'');
    if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))throw forbidden();
    const raw=request.headers.get('Cf-Access-Jwt-Assertion');
    if(!raw)throw forbidden();
    if(raw.length>16384)throw forbidden();
    const pieces=raw.split('.');if(pieces.length!==3)throw forbidden();
    const [header64,payload64,signature]=pieces,header=json(header64),claims=json(payload64);
    if(header.alg!=='RS256'||typeof header.kid!=='string')throw forbidden();
    const seconds=Math.floor(now/1000);
    if(claims.iss!==issuer||claims.type!=='app'||!Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUD)
      ||!Number.isFinite(claims.exp)||claims.exp<=seconds||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds)))throw forbidden();
    let entry=cache.get(issuer);
    if(!entry||entry.expires<=now||!entry.keys.some(k=>k.kid===header.kid)){
      const response=await fetchImpl(`${issuer}/cdn-cgi/access/certs`,{signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw forbidden();const body=await response.json();
      if(!Array.isArray(body.keys))throw forbidden();
      entry={keys:body.keys,expires:now+300000};cache.set(issuer,entry);
    }
    const jwk=entry.keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)throw forbidden();
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(signature),encoder.encode(`${header64}.${payload64}`)))throw forbidden();
    if(claims.common_name)throw forbidden();
    if(!claims.sub||typeof claims.email!=='string'||claims.email.toLowerCase()!==env.AGENT_OWNER_EMAIL.toLowerCase())throw forbidden();
    if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers.get('origin')!==new URL(request.url).origin)throw forbidden();
    return {kind:'owner',ownerId:env.PORTFOLIO_OWNER_ID,email:claims.email.toLowerCase()};
  } catch(error) { if(error instanceof Response)throw error;throw forbidden(); }
}
