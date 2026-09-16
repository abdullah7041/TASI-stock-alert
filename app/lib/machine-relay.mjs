const machineRoutes = new Set([
  'GET /api/health', 'GET /api/dashboard', 'GET /api/portfolio/current', 'GET /api/top10/current',
  'POST /api/dashboard/ingest', 'POST /api/alerts/ingest', 'POST /api/deliveries/ingest',
  'POST /api/discord/interactions', 'POST /api/pulse/ingest',
]);

const same = (left, right) => {
  if (!left || !right) return false;
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
};

export const isMachineRoute = request => machineRoutes.has(`${request.method} ${new URL(request.url).pathname}`);
export const isMachineRelay = (request, env) => isMachineRoute(request) && same(request.headers.get('x-tasi-machine-relay'), env.MACHINE_RELAY_SECRET);
