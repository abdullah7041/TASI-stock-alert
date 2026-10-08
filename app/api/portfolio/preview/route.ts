import {getOwnerContext} from '@/app/lib/owner-context';
import {PortfolioStore} from '@/app/lib/portfolio-store';
import {parseAccountEnvelope,PortfolioConflict} from '@/app/lib/portfolio-core.mjs';

export async function POST(request: Request) {
  try {
    const {ownerId}=await getOwnerContext(request);
    const {accountId,record,expectedRevision}=parseAccountEnvelope(await request.json());
    const {env}=await import('cloudflare:workers');
    if(!env.DB)throw new Response('Portfolio storage is unavailable.',{status:503});
    return Response.json(await new PortfolioStore(env.DB).preview(ownerId,accountId,record,expectedRevision));
  } catch(error) {
    if(error instanceof Response)return Response.json({error:await error.text()},{status:error.status});
    return Response.json({error:error instanceof Error?error.message:'Invalid account record.'},{status:error instanceof PortfolioConflict?409:400});
  }
}
