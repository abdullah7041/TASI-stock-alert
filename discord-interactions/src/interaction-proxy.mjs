import { verifyDiscordSignature } from "../../app/lib/discord-interactions.mjs";

const UPSTREAM_TIMEOUT_MS = 2_500;
const BACKGROUND_TIMEOUT_MS = 45_000;

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

/** @param {Request} request @param {Record<string, string|undefined>} env @param {typeof fetch} fetchImpl @param {((promise: Promise<unknown>) => void)|null} waitUntil */
export async function handleDiscordInteraction(request, env, fetchImpl = fetch, waitUntil = null) {
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

  let interaction;
  try { interaction = JSON.parse(raw); } catch { return unavailable("Invalid interaction payload.", 400); }
  if (interaction?.type === 2 && interaction?.data?.name === "ask" && typeof waitUntil === "function" && typeof interaction.application_id === "string" && typeof interaction.token === "string") {
    const targetRequest = {
      method: "POST", body: raw,
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
        "x-signature-ed25519": signature, "x-signature-timestamp": timestamp,
        ...(usingCloudflare ? { 'CF-Access-Client-Id': env.COCKPIT_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.COCKPIT_ACCESS_CLIENT_SECRET } : { 'oai-sites-authorization': env.COCKPIT_SITE_AUTHORIZATION }),
      }, signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS),
    };
    const followup = `https://discord.com/api/v10/webhooks/${encodeURIComponent(interaction.application_id)}/${encodeURIComponent(interaction.token)}`;
    waitUntil((async () => {
      try {
        const upstream = await fetchImpl(target, targetRequest);
        const payload = await upstream.json().catch(() => ({}));
        const content = typeof payload?.data?.content === "string" ? payload.data.content : "The assistant could not answer. Please retry.";
        await fetchImpl(followup, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, flags: 64 }) });
      } catch {
        await fetchImpl(followup, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "The private assistant timed out. Your question was not lost; please retry.", flags: 64 }) }).catch(() => undefined);
      }
    })());
    return Response.json({ type: 5, data: { flags: 64 } });
  }

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
