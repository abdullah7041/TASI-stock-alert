import { verifyDiscordSignature } from "../../app/lib/discord-interactions.mjs";

const UPSTREAM_TIMEOUT_MS = 2_500;

function unavailable(message, status) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store" } });
}

function upstreamUrl(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}/api/discord/interactions`;
  } catch {
    return null;
  }
}

export async function handleDiscordInteraction(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== "/interactions") return unavailable("Not found.", 404);
  if (request.method !== "POST") return unavailable("Method not allowed.", 405);

  const target = upstreamUrl(env?.COCKPIT_ORIGIN);
  const accessConfigured = env?.COCKPIT_ACCESS_CLIENT_ID && env?.COCKPIT_ACCESS_CLIENT_SECRET;
  const usingCloudflare = target && new URL(target).hostname.endsWith('.workers.dev');
  if (!env?.DISCORD_APP_PUBLIC_KEY || !target || (usingCloudflare ? !accessConfigured : !env?.COCKPIT_SITE_AUTHORIZATION)) return unavailable("Discord interactions are unavailable.", 503);

  const raw = await request.text();
  const signature = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  if (!await verifyDiscordSignature({ publicKey: env.DISCORD_APP_PUBLIC_KEY, signature, timestamp, raw })) return unavailable("Invalid request signature.", 401);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(target, {
      method: "POST",
      body: raw,
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
        ...(usingCloudflare ? {
          'CF-Access-Client-Id': env.COCKPIT_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': env.COCKPIT_ACCESS_CLIENT_SECRET,
        } : { 'oai-sites-authorization': env.COCKPIT_SITE_AUTHORIZATION }),
      },
      signal: controller.signal,
    });
  } catch {
    return unavailable("The private Cockpit is unavailable.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
