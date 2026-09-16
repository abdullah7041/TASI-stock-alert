import { handleDiscordInteraction } from "./interaction-proxy.mjs";

type Env = {
  DISCORD_APP_PUBLIC_KEY?: string;
  DISCORD_OWNER_USER_ID?: string;
  COCKPIT_ORIGIN?: string;
  COCKPIT_SITE_AUTHORIZATION?: string;
  COCKPIT_ACCESS_CLIENT_ID?: string;
  COCKPIT_ACCESS_CLIENT_SECRET?: string;
};

const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handleDiscordInteraction(request, env, fetch, (promise: Promise<unknown>) => ctx.waitUntil(promise));
  },
};

export default worker;
