import { handleDiscordInteraction } from "./interaction-proxy.mjs";

type Env = {
  DISCORD_APP_PUBLIC_KEY?: string;
  COCKPIT_ORIGIN?: string;
  COCKPIT_SITE_AUTHORIZATION?: string;
  COCKPIT_ACCESS_CLIENT_ID?: string;
  COCKPIT_ACCESS_CLIENT_SECRET?: string;
};

const worker = {
  fetch(request: Request, env: Env) {
    return handleDiscordInteraction(request, env);
  },
};

export default worker;
