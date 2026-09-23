import { getOwnerContext } from '@/app/lib/owner-context';
import { getPrivateResearchContext } from '@/app/lib/research-agent';
import { CopilotStore } from '@/app/lib/copilot-store';
import { parseDecision } from '@/app/lib/copilot-core';
import { answerPortfolioQuestion } from '@/app/lib/copilot-service';

async function context(request: Request) {
  const {ownerId} = await getOwnerContext(request);
  const {env} = await import('cloudflare:workers');
  if (!env.DB) throw new Response('Conversation storage is unavailable.', {status:503});
  return {ownerId, db:env.DB, store:new CopilotStore(env.DB)};
}
function failure(error: unknown) {
  if (error instanceof Response) return error;
  return Response.json({error:'The assistant could not finish. Your saved conversation is still available.'}, {status:502});
}
export async function GET(request: Request) {
  try {
    const c = await context(request);
    return Response.json(await c.store.history(c.ownerId), {headers:{'Cache-Control':'no-store'}});
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const c = await context(request);
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new Response('Same-origin request required.', {status:403});
    let body;
    try { body = await request.json(); } catch { throw new Response('Invalid request.', {status:400}); }
    if (body?.operation === 'confirm') {
      if (body.confirmed !== true || typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) throw new Response('Explicit confirmation and decision ID required.',{status:400});
      let draft;
      try { draft = parseDecision(body.draft); } catch (e) { throw new Response((e as Error).message,{status:400}); }
      await c.store.confirm(c.ownerId,{...draft,id:body.id,confirmedAt:new Date().toISOString()});
      return Response.json(await c.store.history(c.ownerId));
    }
    if (body?.operation !== 'ask' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) throw new Response('Enter a question of up to 4000 characters.',{status:400});
    const ai = await getPrivateResearchContext(request);
    const result = await answerPortfolioQuestion({...ai, db:c.db, store:c.store}, body.text.trim(), body.language);
    return Response.json(result.history);
  } catch (error) { return failure(error); }
}
