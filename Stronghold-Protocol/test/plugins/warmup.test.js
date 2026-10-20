// The default plugin set is built in the background once the server listens (server/plugins/warmup.js): the first room
// that opens with the policy's defaults then hits the content-set cache instead of paying a SES preflight in front of a
// player's click. What is asserted here is the bookkeeping, not the seconds: a build happened without a room, it is
// cached for the room that follows, and a broken default set costs the boot nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warmDefaultPlugins } from '../../server/plugins/warmup.js';
import { startServer } from '../../server/index.js';
import { writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const quiet = { info() {}, warn() {}, error() {} };

test('nothing to warm: no defaults, no plugins, or disabled — a resolved promise and no work', async () => {
  assert.equal(await warmDefaultPlugins({ plugins: null }), null);
  assert.equal(await warmDefaultPlugins({ plugins: {}, log: quiet }), null);
  assert.equal(await warmDefaultPlugins({ plugins: { defaults: () => [], resolve: () => assert.fail('resolved') }, log: quiet }), null);
  assert.equal(await warmDefaultPlugins({ plugins: { defaults: () => ['a'], resolve: () => assert.fail('resolved') }, enabled: false }), null);
});

test('the set is resolved in the default room scope; a refusal is logged, not thrown', async () => {
  const calls = [];
  const lines = [];
  const log = { info: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) };
  const ok = await warmDefaultPlugins({
    plugins: { defaults: () => ['one'], resolve: (ids, opts) => { calls.push([ids, opts]); return { ok: true, set: { cs: 'a'.repeat(64) } }; } },
    log,
  });
  assert.deepEqual(calls, [[['one'], { scope: 'room' }]], 'resolved as a room would resolve it');
  assert.equal(ok.ok, true);
  assert.match(lines.join('\n'), /default set one built in \d+ ms/);

  const bad = await warmDefaultPlugins({ plugins: { defaults: () => ['gone'], resolve: () => ({ error: 'PLUGIN_UNKNOWN' }) }, log });
  assert.equal(bad, null, 'a default set that cannot be built is not a boot failure');
  assert.match(lines.join('\n'), /cannot be built: PLUGIN_UNKNOWN/);

  const boom = await warmDefaultPlugins({ plugins: { defaults: () => ['gone'], resolve: () => { throw new Error('nope'); } }, log });
  assert.equal(boom, null, 'a throw is reported the same way');
  assert.match(lines.join('\n'), /cannot be built: Error: nope/);

  const policyless = await warmDefaultPlugins({ plugins: { defaults: () => { throw new Error('policy'); }, resolve: () => ({ ok: true }) }, log });
  assert.equal(policyless, null);
  assert.match(lines.join('\n'), /cannot be read: Error: policy/);
});

test('a server that warms its default set has it cached before the first room.create', async (t) => {
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-warm-'));
  t.after(() => fs.rmSync(plugins, { recursive: true, force: true }));
  // a cosmetic plugin keeps the test fast (no script preflight) and still puts a set through composeContentSet
  writePlugin(path.join(plugins, 'skin'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': Buffer.from('89504e470d0a1a0a', 'hex') });
  fs.writeFileSync(path.join(plugins, 'config.json'), JSON.stringify({ rooms: 'host', default: ['skin'] }));

  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false, warm: true });
  t.after(() => srv.close());
  assert.ok(await srv.warming, 'the default set built');
  const before = srv.contents.stats().builds;
  const host = { playerId: 'p1', name: 'A', connected: true, roomCode: null, ws: null, addr: '127.0.0.1' };
  assert.deepEqual(await srv.lobby.create(host, { mode: 'solo', difficulty: 'NORMAL' }), { ok: true });
  const room = srv.lobby.getRoom(host.roomCode);
  assert.equal(srv.contents.stats().builds, before, 'the room reused the warmed set');
  assert.deepEqual(room.content.plugins.map((p) => p.id), ['skin']);
});
