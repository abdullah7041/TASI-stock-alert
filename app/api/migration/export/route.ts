import { exportPage } from '@/app/lib/migration-export.mjs';

export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const until = Date.parse(env.MIGRATION_EXPORT_UNTIL ?? '');
  if (!env.MIGRATION_EXPORT_TOKEN || !Number.isFinite(until) || until <= Date.now()) return new Response('Not found', { status: 404 });
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const digest = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [expected, actual] = await Promise.all([digest(env.MIGRATION_EXPORT_TOKEN), digest(supplied)]);
  const left = new Uint8Array(expected), right = new Uint8Array(actual);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  if (difference) return new Response('Unauthorized', { status: 401 });
  if (!env.DB) return new Response('Storage unavailable', { status: 503 });
  const url = new URL(request.url);
  const table = url.searchParams.get('table') ?? '';
  const offset = Number(url.searchParams.get('offset') ?? '0');
  if (!/^\d+$/.test(url.searchParams.get('offset') ?? '0')) return new Response('Invalid offset', { status: 400 });
  try { return Response.json(await exportPage(env.DB, table, offset), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return new Response('Export unavailable or invalid table', { status: 400 }); }
}
