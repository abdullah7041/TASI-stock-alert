import { getPrivateOwnerContext } from '@/app/lib/research-agent';
import { generateRecommendation,recommendationSummary } from '@/app/lib/recommendation-service';

async function run(request:Request,generate:boolean){
  try{
    const owner=await getPrivateOwnerContext(request);
    const {env}=await import('cloudflare:workers');
    const c={...owner,apiKey:env.OPENROUTER_API_KEY,chatModel:env.AGENT_DEFAULT_MODEL??env.AGENT_CHAT_MODEL??'deepseek/deepseek-v4.1-flash',
      issuerHosts:(env.EVIDENCE_OFFICIAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean)};
    if(generate){
      if(request.headers.get('origin')!==new URL(request.url).origin)throw new Response('Same-origin request required.',{status:403});
      const body=await request.json().catch(()=>null);
      if(!body||Object.keys(body).some(k=>!['symbol','operationId'].includes(k))||
         typeof body.symbol!=='string'||!/^\d{4}$/.test(body.symbol)||
         typeof body.operationId!=='string'||!body.operationId.trim()||body.operationId.length>200)
        throw new Response('A company symbol and stable operation ID are required.',{status:400});
      await generateRecommendation(c,body.symbol);
    }
    return Response.json(await recommendationSummary(c),{headers:{'Cache-Control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof Response?await error.text():'Recommendation assessment could not be completed.'},
    {status:error instanceof Response?error.status:502,headers:{'Cache-Control':'no-store'}});}
}
export const GET=(request:Request)=>run(request,false);
export const POST=(request:Request)=>run(request,true);
