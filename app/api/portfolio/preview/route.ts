import {getOwnerContext} from '@/app/lib/owner-context';
import {PortfolioStore} from '@/app/lib/portfolio-store';
import {parseAccountEnvelope,PortfolioConflict,PortfolioValidationError} from '@/app/lib/portfolio-core.mjs';

export async function POST(request: Request) {
  try {
    const {ownerId}=await getOwnerContext(request);
    const {accountId,record,expectedRevision}=parseAccountEnvelope(await request.json());
    const {env}=await import('cloudflare:workers');
    if(!env.DB)throw new Response('Portfolio storage is unavailable.',{status:503});
    return Response.json(await new PortfolioStore(env.DB).preview(ownerId,accountId,record,expectedRevision));
  } catch(error) {
    if(error instanceof Response)return Response.json({error:await error.text()},{status:error.status});
    if(error instanceof PortfolioConflict||error instanceof PortfolioValidationError)return Response.json({error:error.message},{status:error instanceof PortfolioConflict?409:400});
    if(error instanceof SyntaxError)return Response.json({error:'Invalid request JSON.'},{status:400});
    return Response.json({error:'Portfolio preview is unavailable. Try again.'},{status:503});
  }
}
