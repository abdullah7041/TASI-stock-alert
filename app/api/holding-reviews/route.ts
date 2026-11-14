import { recommendationSummary } from '@/app/lib/recommendation-service';
import { PortfolioStore } from '@/app/lib/portfolio-store';
import { EvidenceStore } from '@/app/lib/evidence-store';
import { holdingReviewSummary, refreshHoldingReviews } from '@/app/lib/holding-secretary-service';
import { tokensEqual } from '@/app/lib/machine-relay.mjs';

async function context(request:Request){
  const {env}=await import('cloudflare:workers');
  if(!env.DB||!env.DASHBOARD_INGEST_TOKEN)throw new Response('Holding review storage is unavailable.',{status:503});
  if(!tokensEqual(request.headers.get('authorization'),`Bearer ${env.DASHBOARD_INGEST_TOKEN}`))throw new Response('Unauthorized.',{status:401});
  let ownerId:string|null;
  try{ownerId=await new PortfolioStore(env.DB).soleOwnerId();}catch{throw new Response('Holding reviews require an unambiguous portfolio owner.',{status:409});}
  return {ownerId,db:env.DB,apiKey:env.OPENROUTER_API_KEY,chatModel:env.AGENT_DEFAULT_MODEL??env.AGENT_CHAT_MODEL??'deepseek/deepseek-v4.1-flash',issuerHosts:(env.EVIDENCE_OFFICIAL_HOSTS??'').split(',').map(host=>host.trim()).filter(Boolean)};
}
async function respond(request:Request,refresh:boolean){
  try{
    const {env}=await import('cloudflare:workers');
    // Authenticate before processing a machine-supplied body or resolving owner data.
    if(!env.DASHBOARD_INGEST_TOKEN||!tokensEqual(request.headers.get('authorization'),`Bearer ${env.DASHBOARD_INGEST_TOKEN}`))throw new Response('Unauthorized.',{status:401});
    let runId:string|undefined;
    if(refresh){
      let body;try{body=await request.json();}catch{throw new Response('A JSON refresh request is required.',{status:400});}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='collectionRunId')||(body.collectionRunId!==undefined&&(typeof body.collectionRunId!=='string'||!body.collectionRunId.trim()||body.collectionRunId.length>200)))throw new Response('Only collectionRunId may be supplied; owner selection is not permitted.',{status:400});
      runId=body.collectionRunId;
    }
    const c=await context(request);
    if(runId&&(await new EvidenceStore(c.db).latestCollection())?.runId!==runId)throw new Response('The collection receipt is not the latest saved attempt.',{status:409});
    if(!c.ownerId)return Response.json({generatedAt:new Date().toISOString(),collection:await new EvidenceStore(c.db).latestCollection(),items:[],notices:[{id:'owner-setup',text:'No confirmed broker owner is available. Complete account setup.',kind:'setup'}]},{headers:{'Cache-Control':'no-store'}});
    const scoped={...c,ownerId:c.ownerId};
    const summary=refresh?await refreshHoldingReviews(scoped):await holdingReviewSummary(scoped);
    const evaluations=await recommendationSummary(scoped).then(
      result=>result.rows.flatMap(row=>row.current?[{id:row.current.id,symbol:row.symbol,status:row.current.status,
        createdAt:row.current.createdAt,evaluation:true}]:[]),
      ()=>null,
    );
    return Response.json({...summary,evaluations},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return error instanceof Response?error:Response.json({error:'Holding reviews could not be completed. Saved records remain available.'},{status:502});}
}
export const GET=(request:Request)=>respond(request,false);
export const POST=(request:Request)=>respond(request,true);
