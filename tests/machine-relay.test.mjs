import assert from 'node:assert/strict';
import test from 'node:test';
import { isMachineRelay } from '../app/lib/machine-relay.mjs';

const env = { MACHINE_RELAY_SECRET: 'relay-secret' };
const request = (path, method = 'GET', secret = 'relay-secret') => new Request(`https://cockpit.example${path}`, { method, headers: { 'x-tasi-machine-relay': secret } });

test('allows only an authenticated relay to use documented machine routes', async () => {
  assert.equal(await isMachineRelay(request('/api/health'), env), true);
  assert.equal(await isMachineRelay(request('/api/dashboard'), env), true);
  assert.equal(await isMachineRelay(request('/api/pulse/ingest', 'POST'), env), true);
  assert.equal(await isMachineRelay(request('/api/copilot', 'POST'), env), false);
  assert.equal(await isMachineRelay(request('/api/dashboard/ingest', 'POST'), env), true);
  assert.equal(await isMachineRelay(request('/api/dashboard/ingest', 'POST', 'wrong'), env), false);
});
