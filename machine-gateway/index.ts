import { isMachineRoute } from '../app/lib/machine-relay.mjs';

interface Env {
  COCKPIT: Fetcher;
  MACHINE_RELAY_SECRET: string;
}

const gateway = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!ctx.access || !isMachineRoute(request)) return new Response('Not found.', { status: 404 });
    const headers = new Headers(request.headers);
    headers.delete('CF-Access-Client-Id');
    headers.delete('CF-Access-Client-Secret');
    headers.set('x-tasi-machine-relay', env.MACHINE_RELAY_SECRET);
    return env.COCKPIT.fetch(new Request(request, { headers }));
  },
};

export default gateway;
