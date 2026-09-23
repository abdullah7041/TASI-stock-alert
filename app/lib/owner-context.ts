import { authorizeAccess } from './access-auth.mjs';

/** Portfolio and evidence approval require identity, not a paid AI configuration. */
export async function getOwnerContext(request:Request) {
  const {env}=await import('cloudflare:workers');
  if(env.AUTH_MODE==='cloudflare'){
    const identity=await authorizeAccess(request,env);
    if(identity.kind!=='owner')throw new Response('Owner sign-in is required.',{status:403});
    return {ownerId:identity.ownerId,ownerEmail:identity.email};
  }
  // This branch is used only behind the existing private Sites dispatcher.
  const ownerId=request.headers.get('oai-authenticated-user-id');
  const ownerEmail=request.headers.get('oai-authenticated-user-email');
  if(!ownerId||!ownerEmail)throw new Response('Sign in is required.',{status:401});
  if(!env.AGENT_OWNER_EMAIL||ownerEmail.toLowerCase()!==env.AGENT_OWNER_EMAIL.toLowerCase())throw new Response('This account cannot access the cockpit.',{status:403});
  return {ownerId,ownerEmail};
}
