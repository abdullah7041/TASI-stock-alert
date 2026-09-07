import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['vinext', 'build'], {
  env: { ...process.env, COCKPIT_HOSTING: 'cloudflare' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
