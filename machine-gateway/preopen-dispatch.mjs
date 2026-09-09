export const PREOPEN_CRON = "20 5 * * SUN-THU";

const WORKFLOW_URL = "https://api.github.com/repos/abdullah7041/TASI-stock-alert/actions/workflows/tasi.yml/dispatches";

export async function dispatchPreopenWorkflow(token, fetcher = fetch) {
  if (typeof token !== "string" || !token.trim()) throw new Error("GitHub Actions token is not configured.");
  const response = await fetcher(new Request(WORKFLOW_URL, {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "tasi-machine-gateway",
      "x-github-api-version": "2026-03-10",
    },
    body: JSON.stringify({ ref: "main", inputs: { mode: "digest-guard" } }),
  }));
  if (!response.ok) throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}.`);
  return response;
}
