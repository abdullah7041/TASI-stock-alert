import { getOwnerContext } from '@/app/lib/owner-context';
import { getPrivateResearchContext } from '@/app/lib/research-agent';
import { CopilotStore } from '@/app/lib/copilot-store';
import { parseDecision } from '@/app/lib/copilot-core';
import { answerPortfolioQuestion } from '@/app/lib/copilot-service';
import { HoldingSecretaryStore } from '@/app/lib/holding-secretary-store';
import { HoldingSecretaryConflict, heldCompanies, parseProfileInput, parseCaseInput } from '@/app/lib/holding-secretary-core';
import { secretaryConversation, draftHoldingCase, reviewHolding } from '@/app/lib/holding-secretary-service';
import { PortfolioStore } from '@/app/lib/portfolio-store';

async function context(request: Request) {
  const {ownerId} = await getOwnerContext(request);
  const {env} = await import('cloudflare:workers');
  if (!env.DB) throw new Response('Conversation storage is unavailable.', {status:503});
  return {ownerId, db:env.DB, store:new CopilotStore(env.DB)};
}
function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof HoldingSecretaryConflict) return Response.json({error:error.message},{status:409});
  return Response.json({error:'The assistant could not finish. Your saved conversation is still available.'}, {status:502});
}
export async function GET(request: Request) {
  try {
    const c = await context(request);
    return Response.json(await secretaryConversation(c), {headers:{'Cache-Control':'no-store'}});
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const c = await context(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new Response('Same-origin request required.', {status:403});
    let body;
    try { body = await request.json(); } catch { throw new Response('Invalid request.', {status:400}); }
    if(['save_profile','draft_case','confirm_case','review_holding','acknowledge_review'].includes(body?.operation)){
      const secretary=new HoldingSecretaryStore(c.db);
      if(['save_profile','confirm_case','acknowledge_review'].includes(body.operation)&&
        (typeof body.operationId!=='string'||!body.operationId.trim()||body.operationId.length>200))throw new Response('A stable operationId is required.',{status:400});
      if(['save_profile','confirm_case'].includes(body.operation)&&(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0))throw new Response('A nonnegative expectedRevision is required.',{status:400});
      if(body.operation==='save_profile'){
        let profile;try{profile=parseProfileInput(body.profile);}catch{throw new Response('Complete the profile fields.',{status:400});}
        await secretary.saveProfile(c.ownerId,profile,body.expectedRevision,body.operationId);
      }else if(body.operation==='confirm_case'){
        let holdingCase;try{holdingCase=parseCaseInput(body.case);}catch{throw new Response('Complete the company case and valid source references.',{status:400});}
        if(!heldCompanies(await new PortfolioStore(c.db).book(c.ownerId)).some(item=>item.symbol===holdingCase.symbol))throw new Response('Confirm this holding in a healthy broker account first.',{status:409});
        if(!Number.isSafeInteger(body.profileRevision)||body.profileRevision<1)throw new Response('A confirmed profile revision is required.',{status:400});
        await secretary.confirmCase(c.ownerId,holdingCase,body.expectedRevision,body.operationId,body.profileRevision);
      }else if(body.operation==='acknowledge_review'){
        if(typeof body.reviewId!=='string'||!body.reviewId.trim()||body.reviewId.length>200)throw new Response('A reviewId is required.',{status:400});
        try{await secretary.acknowledge(c.ownerId,body.reviewId,body.operationId);}catch(error){if(error instanceof HoldingSecretaryConflict)throw error;throw new Response('This review is unavailable.',{status:400});}
      }else{
        if(typeof body.symbol!=='string'||!/^\d{4}$/.test(body.symbol))throw new Response('Use a four-digit holding code.',{status:400});
        const {env}=await import('cloudflare:workers');
        const issuerHosts=(env.EVIDENCE_OFFICIAL_HOSTS??'').split(',').map(host=>host.trim()).filter(Boolean);
        const ai={...c,apiKey:env.OPENROUTER_API_KEY,chatModel:env.AGENT_DEFAULT_MODEL??env.AGENT_CHAT_MODEL??'deepseek/deepseek-v4.1-flash',issuerHosts};
        if(body.operation==='draft_case')return Response.json({...await secretaryConversation(c),caseDraft:await draftHoldingCase(ai,body.symbol)});
        await reviewHolding(ai,body.symbol);
      }
      return Response.json(await secretaryConversation(c));
    }
    if (body?.operation === 'confirm') {
      if (body.confirmed !== true || typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) throw new Response('Explicit confirmation and decision ID required.',{status:400});
      let draft;
      try { draft = parseDecision(body.draft); } catch (e) { throw new Response((e as Error).message,{status:400}); }
      await c.store.confirm(c.ownerId,{...draft,id:body.id,confirmedAt:new Date().toISOString()});
      return Response.json(await secretaryConversation(c));
    }
    if (body?.operation !== 'ask' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) throw new Response('Enter a question of up to 4000 characters.',{status:400});
    const ai = await getPrivateResearchContext(request);
    const result = await answerPortfolioQuestion({...ai, db:c.db, store:c.store}, body.text.trim(), body.language);
    return Response.json({...result.history,...await secretaryConversation(c)});
  } catch (error) { return failure(error); }
}
