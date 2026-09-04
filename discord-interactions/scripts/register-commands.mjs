import { fileURLToPath } from "node:url";
import { commands, commandRegistrationUrl } from "../src/commands.mjs";

export async function registerCommands({ applicationId = process.env.DISCORD_APPLICATION_ID, token = process.env.DISCORD_BOT_TOKEN, guildId = process.env.DISCORD_GUILD_ID, fetchImpl = fetch } = {}) {
  if (!applicationId || !token) throw new Error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required.");
  const response = await fetchImpl(commandRegistrationUrl(applicationId, guildId), {
    method: "PUT",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.clone().json();
      if (Number.isInteger(payload?.code) && typeof payload?.message === "string") detail = ` (${payload.code}) ${payload.message}`;
    } catch {}
    throw new Error(`Discord command registration failed: ${response.status}${detail}`);
  }
  return response;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  registerCommands().then(() => console.log("Discord commands registered.")).catch((error) => {
    console.error(error instanceof Error ? error.message : "Discord command registration failed.");
    process.exitCode = 1;
  });
}
