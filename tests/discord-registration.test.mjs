import assert from 'node:assert/strict';
import test from 'node:test';
import { registerCommands } from '../discord-interactions/scripts/register-commands.mjs';

test('registering ask preserves unrelated commands at the selected guild scope', async () => {
  // Discord's bulk PUT replaces the registry; single-command POST upserts one.
  const registry = [{ name: 'portfolio', description: 'Existing portfolio' }];
  await registerCommands({ applicationId: 'app', token: 'test-token', guildId: 'guild',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://discord.com/api/v10/applications/app/guilds/guild/commands');
      const payload = JSON.parse(options.body);
      if (options.method === 'PUT') registry.splice(0, registry.length, ...payload);
      else if (options.method === 'POST') registry.push(payload);
      else throw new Error('Unexpected registration method');
      return Response.json(registry);
    },
  });
  assert.deepEqual(registry.map(command => command.name), ['portfolio', 'ask']);
  assert.equal(registry[0].description, 'Existing portfolio');
});

test('a rejected ask registration reports failure without exposing the bot token', async () => {
  await assert.rejects(registerCommands({ applicationId: 'app', token: 'test-token',
    fetchImpl: async () => Response.json({ code: 50001, message: 'Missing Access' }, { status: 403 }),
  }), /403 \(50001\) Missing Access/);
});
